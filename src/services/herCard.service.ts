import { generateStructured } from "./ai/structured";
import { assembleContext } from "./context.service";
import { BUNKER_SYSTEM } from "../prompts/bunker.system";
import { herCardResponseSchema, herCardSchema, HER_STAT_KEYS, HER_STAT_LABELS, type HerCardData } from "../schemas/herCard.schema";
import { TargetModel, type ITarget } from "../models/target.model";
import { PowerProfileModel } from "../models/powerProfile.model";
import { ARCHETYPE_LABELS } from "../schemas/enums";
import type { IUser } from "../models/user.model";
import { logMetrics } from "../utils/redact";

/**
 * Ficha tecnica de ella.
 *
 * Se genera con el dossier completo y se cachea en el propio expediente con
 * la `version` con la que se calculo: mientras no cambie nada del dossier
 * (analisis, chat que actualiza estado, edicion de perfil) se sirve la misma
 * carta sin gastar un token. Cualquier cambio de version la invalida.
 */

const CARD_MODE = `MODO FICHA TECNICA
Vas a resumir TODO lo que el expediente sabe de ella en una carta de personaje
de videojuego. No es un analisis nuevo: es la sintesis de lo que ya hay.
Reglas:
- Todo sale de evidencia del dossier, el resumen, el historial importado y
  los hilos. Nada inventado. Si un campo no tiene evidencia, va vacio o null.
- Las listas (le gusta, evitar, odia, como se gana) son de pocas palabras
  cada una, accionables, sin repetirse entre si.
- Las stats son relativas: 50 es lo normal, 80+ es extremo. Cada hint cita
  un hecho concreto, no una generalidad.
- Tono Alfii: directo, sin adornos, sin moralina. Espanol neutro.
- Solo JSON valido segun el schema.`;

export interface HerCardView extends HerCardData {
  stats: { key: (typeof HER_STAT_KEYS)[number]; label: string; value: number; hint: string }[];
  archetype: { primary: string; label: string } | null;
  generatedAt: Date;
  version: number;
  stale: boolean;
}

/** Sin datos no hay ficha: una carta alucinada es peor que ninguna. */
export function hasEnoughEvidence(target: ITarget): boolean {
  return target.analysisCount > 0 || target.messageCount >= 6 || !!target.importedHistory;
}

function toView(target: ITarget, data: HerCardData, meta: { generatedAt: Date; version: number }): HerCardView {
  const byKey = new Map(data.stats.map((s) => [s.key, s]));
  return {
    ...data,
    stats: HER_STAT_KEYS.map((key) => {
      const s = byKey.get(key);
      return { key, label: HER_STAT_LABELS[key], value: s?.value ?? 0, hint: s?.hint ?? "" };
    }),
    archetype: target.archetype.primary
      ? { primary: target.archetype.primary, label: ARCHETYPE_LABELS[target.archetype.primary] }
      : null,
    generatedAt: meta.generatedAt,
    version: meta.version,
    stale: meta.version !== target.version,
  };
}

export async function getHerCard(input: {
  user: IUser;
  target: ITarget;
  refresh?: boolean;
}): Promise<HerCardView | null> {
  const { target } = input;
  const cached = target.herCard;

  if (!input.refresh && cached?.data && cached.version === target.version) {
    return toView(target, cached.data, cached);
  }

  if (!hasEnoughEvidence(target)) {
    // Si hay una carta vieja se sirve marcada como stale antes que nada.
    return cached?.data ? toView(target, cached.data, cached) : null;
  }

  const profile = await PowerProfileModel.findOne({ userId: input.user._id });
  const context = await assembleContext({
    user: input.user,
    profile,
    target,
    includeThreads: true,
    includeHistory: true,
  });

  const started = Date.now();
  try {
    const result = await generateStructured({
      task: "analysis",
      system: `${BUNKER_SYSTEM}\n\n${CARD_MODE}`,
      parts: [
        {
          text:
            `${context.text}\n\n` +
            `Riesgo transaccional actual: ${target.riskProfile.transactionalRisk}/100 ` +
            `(${target.riskProfile.flags.length} red flags).\n` +
            `Genera la ficha tecnica de ${target.displayName}.`,
        },
      ],
      jsonSchema: herCardResponseSchema,
      validator: herCardSchema,
      temperature: 0.4,
      maxOutputTokens: 1800,
      thinkingBudget: 512,
      attribution: { userId: String(input.user._id) },
    });

    const generatedAt = new Date();
    await TargetModel.findByIdAndUpdate(target._id, {
      $set: {
        herCard: { data: result.data, version: target.version, generatedAt, model: result.model },
      },
    });

    logMetrics("herCard.generate", {
      model: result.model,
      latencyMs: Date.now() - started,
      contextTokens: context.tokens,
    });

    return toView(target, result.data, { generatedAt, version: target.version });
  } catch (error: any) {
    console.warn(`[alfii:ai] herCard fallo para ${target._id}: ${error?.message}`);
    // Mejor una carta desactualizada que un error en pantalla.
    return cached?.data ? toView(target, cached.data, cached) : null;
  }
}
