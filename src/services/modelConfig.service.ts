import { env } from "../config/env";
import { AppConfigModel } from "../models/appConfig.model";
import {
  isEligible,
  type CatalogProvider,
} from "./ai/catalog";
import type { AiTask } from "./ai/types";
import { CustomError } from "../errors/customError.error";

/**
 * Que modelo atiende cada tarea, cambiable desde el portal sin redeploy.
 *
 * Los overrides viven en AppConfig (clave "modelOverrides") y se cachean en
 * memoria con TTL corto: `activeModel` tiene que ser SINCRONO porque lo
 * consulta `modelFor` en el camino caliente de cada llamada. En serverless
 * multi-instancia, la instancia que no recibio el PATCH se pone al dia sola
 * en <=30s via el refresco perezoso. El env queda siempre como fallback.
 */

const CONFIG_KEY = "modelOverrides";
const CACHE_TTL_MS = 30_000;

export type ModelOverrides = Partial<Record<CatalogProvider, Partial<Record<AiTask, string>>>>;

const ENV_DEFAULTS: Record<CatalogProvider, Record<AiTask, string>> = {
  gemini: {
    vision: env.GEMINI_MODEL_VISION,
    chat: env.GEMINI_MODEL_CHAT,
    analysis: env.GEMINI_MODEL_ANALYSIS,
  },
  openai: {
    vision: env.OPENAI_MODEL_VISION,
    chat: env.OPENAI_MODEL_CHAT,
    analysis: env.OPENAI_MODEL_ANALYSIS,
  },
  deepseek: {
    // DeepSeek no lee imagenes: vision alias de analysis, igual que su provider.
    vision: env.DEEPSEEK_MODEL_ANALYSIS,
    chat: env.DEEPSEEK_MODEL_CHAT,
    analysis: env.DEEPSEEK_MODEL_ANALYSIS,
  },
};

let overrides: ModelOverrides = {};
let loadedAt = 0;
let refreshing = false;

async function fetchOverrides(): Promise<void> {
  try {
    const doc = await AppConfigModel.findOne({ key: CONFIG_KEY }).lean();
    overrides = (doc?.value as ModelOverrides) ?? {};
    loadedAt = Date.now();
  } catch (error: any) {
    // Sin DB se sigue con env: el chat no puede depender de la configuracion.
    console.warn(`[alfii:models] no se pudo leer overrides: ${error?.message}`);
    loadedAt = Date.now();
  } finally {
    refreshing = false;
  }
}

/** Carga inicial al arrancar. */
export async function loadModelOverrides(): Promise<void> {
  await fetchOverrides();
  console.log(
    `[alfii:models] overrides activos: ${JSON.stringify(overrides) === "{}" ? "(ninguno, env manda)" : JSON.stringify(overrides)}`
  );
}

/**
 * Modelo activo para proveedor+tarea. SINCRONO: lee la cache y, si esta
 * vencida, dispara un refresco en segundo plano sin bloquear la llamada.
 */
export function activeModel(provider: CatalogProvider, task: AiTask): string {
  if (Date.now() - loadedAt > CACHE_TTL_MS && !refreshing) {
    refreshing = true;
    void fetchOverrides();
  }

  return overrides[provider]?.[task] ?? ENV_DEFAULTS[provider][task];
}

/** Vista completa para el portal: modelo activo y de donde sale cada uno. */
export function activeConfig(): Record<
  CatalogProvider,
  Record<AiTask, { model: string; source: "override" | "env" }>
> {
  const tasks: AiTask[] = ["chat", "analysis", "vision"];
  const providers = Object.keys(ENV_DEFAULTS) as CatalogProvider[];

  return Object.fromEntries(
    providers.map((provider) => [
      provider,
      Object.fromEntries(
        tasks.map((task) => {
          const override = overrides[provider]?.[task];
          return [
            task,
            override
              ? { model: override, source: "override" as const }
              : { model: ENV_DEFAULTS[provider][task], source: "env" as const },
          ];
        })
      ),
    ])
  ) as ReturnType<typeof activeConfig>;
}

/** Fija (o limpia con null) el override de un proveedor+tarea. */
export async function setModelOverride(
  provider: CatalogProvider,
  task: AiTask,
  modelId: string | null
): Promise<void> {
  if (modelId && !isEligible(provider, task, modelId)) {
    throw new CustomError(
      `El modelo ${modelId} no esta en el catalogo de ${provider} para ${task}.`,
      400,
      { reason: "model_not_in_catalog" }
    );
  }

  const next: ModelOverrides = JSON.parse(JSON.stringify(overrides));
  if (modelId) {
    next[provider] = { ...(next[provider] ?? {}), [task]: modelId };
  } else if (next[provider]) {
    delete next[provider]![task];
    if (!Object.keys(next[provider]!).length) delete next[provider];
  }

  await AppConfigModel.updateOne(
    { key: CONFIG_KEY },
    { $set: { value: next } },
    { upsert: true }
  );

  // La instancia que hizo el cambio lo ve al instante; las demas, via TTL.
  overrides = next;
  loadedAt = Date.now();
}
