import type { AiTask } from "./types";

/**
 * Catalogo de modelos elegibles desde el portal de administracion.
 *
 * UNICA fuente de verdad de precios (USD por MILLON de tokens): pricing.ts
 * resuelve contra esto y el portal lo muestra tal cual. Los precios son los
 * mismos documentados en config/env.ts al elegir cada modelo. Cuando un
 * proveedor cambie tarifas o saque un modelo nuevo, se edita AQUI.
 */

export type CatalogProvider = "gemini" | "openai" | "deepseek";

export interface CatalogModel {
  id: string;
  label: string;
  /** USD por 1M de tokens de entrada / salida. */
  inPerM: number;
  outPerM: number;
  /** Tareas para las que este modelo es elegible. */
  tasks: AiTask[];
}

export const MODEL_CATALOG: Record<CatalogProvider, CatalogModel[]> = {
  // ai.google.dev/gemini-api/docs/pricing
  gemini: [
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", inPerM: 0.1, outPerM: 0.4, tasks: ["chat"] },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", inPerM: 0.3, outPerM: 2.5, tasks: ["chat", "analysis", "vision"] },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", inPerM: 0.5, outPerM: 3.0, tasks: ["chat", "analysis", "vision"] },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", inPerM: 1.5, outPerM: 7.5, tasks: ["analysis", "vision"] },
  ],
  // platform.openai.com/docs/pricing
  openai: [
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", inPerM: 0.2, outPerM: 1.2, tasks: ["chat"] },
    { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", inPerM: 0.2, outPerM: 1.25, tasks: ["chat"] },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", inPerM: 0.75, outPerM: 4.5, tasks: ["chat", "analysis"] },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", inPerM: 2.5, outPerM: 10.0, tasks: ["analysis", "vision"] },
  ],
  // api-docs.deepseek.com/quick_start/pricing — precio de cache MISS (techo)
  deepseek: [
    { id: "deepseek-v4-flash", label: "DeepSeek v4 Flash", inPerM: 0.14, outPerM: 0.28, tasks: ["chat"] },
    { id: "deepseek-v4-pro", label: "DeepSeek v4 Pro", inPerM: 0.435, outPerM: 0.87, tasks: ["chat", "analysis"] },
  ],
};

export const CATALOG_PROVIDERS = Object.keys(MODEL_CATALOG) as CatalogProvider[];

/** Busca un modelo por id en todo el catalogo (para precios). */
export function findCatalogModel(id: string): CatalogModel | null {
  for (const models of Object.values(MODEL_CATALOG)) {
    const found = models.find((m) => id.startsWith(m.id));
    if (found) return found;
  }
  return null;
}

/** ¿Este modelo es elegible para este proveedor y tarea? */
export function isEligible(provider: CatalogProvider, task: AiTask, modelId: string): boolean {
  return (MODEL_CATALOG[provider] ?? []).some((m) => m.id === modelId && m.tasks.includes(task));
}
