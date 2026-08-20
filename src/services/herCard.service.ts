import { generateStructured } from "./ai/structured";
import { assembleContext } from "./context.service";
import { BUNKER_SYSTEM } from "../prompts/bunker.system";
import {
  herCardResponseSchema,
  herCardSchema,
  HER_STAT_KEYS,
  HER_STAT_LABELS,
  type HerCardData,
} from "../schemas/herCard.schema";
import { TargetModel, type IHerCardSnapshot, type ITarget } from "../models/target.model";
import { PowerProfileModel } from "../models/powerProfile.model";
import { ARCHETYPE_LABELS, MILESTONE_KEYS, MILESTONE_LABELS } from "../schemas/enums";
import type { IUser } from "../models/user.model";
import { logMetrics } from "../utils/redact";

/**
 * Ficha tecnica de ella, con historial.
 *
 * La ficha NO se regenera en cada visita: cuesta un analisis entero. Se
 * regenera solo cuando hay novedad real en el expediente (ver `needsRefresh`)
 * o cuando el usuario lo pide. Cada generacion guarda una foto en
 * `herCardHistory` con el contexto del momento (etapa, riesgo, medidores,
 * numero de analisis), para que la linea de tiempo muestre como ha ido
 * cambiando ella con fechas.
 */

const HISTORY_CAP = 24;
/** Horas minimas entre regeneraciones automaticas aunque haya cambios. */
const MIN_HOURS_BETWEEN_AUTO = 12;
/** Mensajes nuevos que por si solos justifican una ficha nueva. */
const MESSAGES_DELTA = 12;

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
  snapshot: {
    analysisCount: number;
    messageCount: number;
    stage: string;
    riskLevel: string;
    meters: { kiss: number; firstDate: number; firstNight: number };
  };
}

export interface HerCardHistoryItem {
  index: number;
  generatedAt: Date;
  level: number;
  tagline: string;
  confidence: number;
  stats: { key: string; value: number }[];
  stage: string;
  riskLevel: string;
  meters: { kiss: number; firstDate: number; firstNight: number };
  analysisCount: number;
  messageCount: number;
  /** Carta completa de esa version, para abrirla en la vista. */
  card: HerCardView;
}

export interface HerCardResponse {
  card: HerCardView | null;
  reason: "not_enough_evidence" | "generation_failed" | null;
  /** De la mas reciente a la mas antigua. */
  history: HerCardHistoryItem[];
  milestones: { key: string; label: string; achieved: boolean; at: Date | null }[];
  metersHistory: { kiss: number; firstDate: number; firstNight: number; at: Date }[];
  /** Hay novedad en el expediente que aun no esta reflejada en la ficha. */
  hasNews: boolean;
  createdAt: Date;
}

/** Sin datos no hay ficha: una carta alucinada es peor que ninguna. */
export function hasEnoughEvidence(target: ITarget): boolean {
  return target.analysisCount > 0 || target.messageCount >= 6 || !!target.importedHistory;
}

function snapshotOf(target: ITarget, data: HerCardData, model?: string): IHerCardSnapshot {
  return {
    data,
    version: target.version,
    generatedAt: new Date(),
    model,
    analysisCount: target.analysisCount,
    messageCount: target.messageCount,
    stage: target.stage,
    riskLevel: target.riskProfile.level,
    meters: { ...target.meters.current },
  };
}

function toView(target: ITarget, snap: IHerCardSnapshot): HerCardView {
  const data = snap.data as HerCardData;
  const byKey = new Map((data.stats ?? []).map((s) => [s.key, s]));
  return {
    ...data,
    stats: HER_STAT_KEYS.map((key) => {
      const s = byKey.get(key);
      return { key, label: HER_STAT_LABELS[key], value: s?.value ?? 0, hint: s?.hint ?? "" };
    }),
    archetype: target.archetype.primary
      ? { primary: target.archetype.primary, label: ARCHETYPE_LABELS[target.archetype.primary] }
      : null,
    generatedAt: snap.generatedAt,
    version: snap.version,
    stale: snap.version !== target.version,
    snapshot: {
      analysisCount: snap.analysisCount ?? 0,
      messageCount: snap.messageCount ?? 0,
      stage: snap.stage ?? target.stage,
      riskLevel: snap.riskLevel ?? target.riskProfile.level,
      meters: snap.meters ?? target.meters.current,
    },
  };
}

/**
 * Hay novedad suficiente para gastar una generacion?
 *  - nunca si no cambio la version del dossier
 *  - si hubo un analisis nuevo (captura o import): siempre
 *  - si no, solo con bastantes mensajes nuevos Y tiempo desde la ultima
 */
export function needsRefresh(target: ITarget, current?: IHerCardSnapshot | null): boolean {
  if (!current) return true;
  if (current.version === target.version) return false;
  if (target.analysisCount > (current.analysisCount ?? 0)) return true;

  const hours = (Date.now() - new Date(current.generatedAt).getTime()) / 3_600_000;
  const newMessages = target.messageCount - (current.messageCount ?? 0);
  return newMessages >= MESSAGES_DELTA && hours >= MIN_HOURS_BETWEEN_AUTO;
}

function buildResponse(target: ITarget, current: IHerCardSnapshot | null, reason: HerCardResponse["reason"]): HerCardResponse {
  const all: IHerCardSnapshot[] = [...(target.herCardHistory ?? [])];
  if (current && !all.some((h) => +new Date(h.generatedAt) === +new Date(current.generatedAt))) {
    all.push(current);
  }
  all.sort((a, b) => +new Date(b.generatedAt) - +new Date(a.generatedAt));

  const history: HerCardHistoryItem[] = all.map((snap, i) => {
    const view = toView(target, snap);
    return {
      index: all.length - i,
      generatedAt: snap.generatedAt,
      level: view.level,
      tagline: view.tagline,
      confidence: view.confidence,
      stats: view.stats.map((s) => ({ key: s.key, value: s.value })),
      stage: view.snapshot.stage,
      riskLevel: view.snapshot.riskLevel,
      meters: view.snapshot.meters,
      analysisCount: view.snapshot.analysisCount,
      messageCount: view.snapshot.messageCount,
      card: view,
    };
  });

  return {
    card: current ? toView(target, current) : null,
    reason,
    history,
    milestones: MILESTONE_KEYS.map((key) => ({
      key,
      label: MILESTONE_LABELS[key],
      achieved: !!target.milestones?.[key]?.achieved,
      at: target.milestones?.[key]?.at ?? null,
    })),
    metersHistory: (target.meters.history ?? []).map((m) => ({
      kiss: m.kiss,
      firstDate: m.firstDate,
      firstNight: m.firstNight,
      at: m.at,
    })),
    hasNews: !!current && current.version !== target.version,
    createdAt: target.createdAt,
  };
}

export async function getHerCard(input: {
  user: IUser;
  target: ITarget;
  refresh?: boolean;
}): Promise<HerCardResponse> {
  const { target } = input;
  const current = target.herCard ?? null;

  const shouldGenerate = input.refresh || needsRefresh(target, current);
  if (!shouldGenerate) return buildResponse(target, current, null);

  if (!hasEnoughEvidence(target)) {
    return buildResponse(target, current, current ? null : "not_enough_evidence");
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
            (current
              ? `Ficha anterior (${new Date(current.generatedAt).toISOString().slice(0, 10)}): ` +
                `nivel ${(current.data as HerCardData).level}, "${(current.data as HerCardData).tagline}". ` +
                `Si algo cambio desde entonces, reflejalo; si no, manten la coherencia.\n`
              : "") +
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

    const snap = snapshotOf(target, result.data, result.model);
    const history = [...(target.herCardHistory ?? [])];
    if (current) history.push(current);
    while (history.length > HISTORY_CAP) history.shift();

    await TargetModel.findByIdAndUpdate(target._id, {
      $set: { herCard: snap, herCardHistory: history },
    });
    target.herCard = snap;
    target.herCardHistory = history;

    logMetrics("herCard.generate", {
      model: result.model,
      latencyMs: Date.now() - started,
      contextTokens: context.tokens,
    });

    return buildResponse(target, snap, null);
  } catch (error: any) {
    console.warn(`[alfii:ai] herCard fallo para ${target._id}: ${error?.message}`);
    // Mejor una carta desactualizada que un error en pantalla.
    return buildResponse(target, current, current ? null : "generation_failed");
  }
}
