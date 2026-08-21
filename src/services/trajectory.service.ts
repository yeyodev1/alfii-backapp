import { clockLayer } from "../utils/clock";
import { z } from "zod";
import { Types } from "mongoose";
import { AnalysisModel } from "../models/analysis.model";
import { TargetModel, type ITarget } from "../models/target.model";
import { generateStructured } from "./ai/structured";
import { BUNKER_SYSTEM } from "../prompts/bunker.system";
import { personaDirective } from "../prompts/personas";
import { buildDossierLayer, buildImportedHistoryLayer } from "./context.service";
import type { IUser } from "../models/user.model";

/**
 * Trayectoria del expediente: la serie de analisis como grafo + una lectura
 * global del modelo sobre esa serie.
 *
 * El chat responde "al ultimo mensaje"; esto responde "a donde va esto". Los
 * puntos salen de los analisis guardados (medidores, riesgo, arquetipo, lead,
 * espera recomendada). La lectura se cachea en el target y se invalida cuando
 * entra un analisis nuevo o pasan 24 h.
 */

export interface TimelinePoint {
  analysisId: string;
  at: Date;
  sourceType: "screenshot" | "text";
  meters: { kiss: number; firstDate: number; firstNight: number };
  riskLevel: string;
  archetype: string | null;
  lead: string;
  waitMinutes: number | null;
  messages: number;
  stage: string | null;
}

export async function buildTimeline(target: ITarget): Promise<TimelinePoint[]> {
  const analyses = await AnalysisModel.find({ targetId: target._id })
    .sort({ createdAt: 1 })
    .limit(120)
    .select("createdAt sourceType payload extractedThread")
    .lean();

  return analyses.map((a) => {
    const p: any = a.payload ?? {};
    return {
      analysisId: String(a._id),
      at: a.createdAt,
      sourceType: (a.sourceType as "screenshot" | "text") ?? "screenshot",
      meters: {
        kiss: Number(p.meters?.kiss ?? 0),
        firstDate: Number(p.meters?.firstDate ?? 0),
        firstNight: Number(p.meters?.firstNight ?? 0),
      },
      riskLevel: String(p.riskRadar?.level ?? "LIMPIO"),
      archetype: p.archetypeDiagnosis?.primary ?? null,
      lead: String(p.lead ?? p.subtext?.reading ?? "").slice(0, 240),
      waitMinutes: typeof p.timing?.waitMinutes === "number" ? p.timing.waitMinutes : null,
      messages: Array.isArray(a.extractedThread) ? a.extractedThread.length : 0,
      stage: p.stateUpdate?.stage ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Lectura global
// ---------------------------------------------------------------------------

const trajectorySchema = z.object({
  trend: z.enum(["SUBE", "ESTABLE", "BAJA", "VOLATIL"]),
  headline: z.string().min(1).max(160),
  reading: z.string().min(1).max(900),
  turningPoints: z
    .array(z.object({ index: z.number().int().min(1), label: z.string().max(140) }))
    .max(4),
  strengths: z.array(z.string().max(120)).max(3),
  risks: z.array(z.string().max(120)).max(3),
  nextMove: z.string().min(1).max(220),
  confidence: z.number().min(0).max(1),
});
export type TrajectoryReading = z.infer<typeof trajectorySchema>;

const trajectoryResponseSchema = {
  type: "object",
  properties: {
    trend: { type: "string", enum: ["SUBE", "ESTABLE", "BAJA", "VOLATIL"] },
    headline: { type: "string", description: "Una frase: a donde va esto. Max 160 chars." },
    reading: {
      type: "string",
      description: "Lectura de la trayectoria completa en 3-5 frases de prosa. Max 900 chars.",
    },
    turningPoints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Numero del analisis (1 = el primero)" },
          label: { type: "string" },
        },
        required: ["index", "label"],
      },
    },
    strengths: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    nextMove: { type: "string", description: "La jugada concreta ahora, una frase." },
    confidence: { type: "number" },
  },
  required: ["trend", "headline", "reading", "turningPoints", "strengths", "risks", "nextMove", "confidence"],
} as const;

const TRAJECTORY_MODE = `MODO TRAYECTORIA.
No analizas un mensaje: analizas la SERIE COMPLETA de analisis de este
expediente, en orden, como un grafo. Te interesa la pendiente, no el punto:
si los medidores suben o bajan, donde cambio el riesgo, donde cambio el
arquetipo, que paso entre un analisis y el siguiente segun los leads.

Reglas: se concreto y cita numeros (de X a Y). Los turningPoints referencian
el numero de analisis. Si solo hay 1 o 2 puntos, dilo y lee tendencia con
cautela (confidence baja). Sin markdown, sin encabezados, sin listas dentro
de los textos. Español directo, tono del asesor.`;

function pointsToText(points: TimelinePoint[]): string {
  return points
    .map((p, i) => {
      const when = new Date(p.at).toISOString().slice(0, 16).replace("T", " ");
      return (
        `#${i + 1} ${when} [${p.sourceType === "text" ? "chat importado" : "captura"}, ${p.messages} msgs] ` +
        `beso ${p.meters.kiss} / cita ${p.meters.firstDate} / noche ${p.meters.firstNight} · ` +
        `riesgo ${p.riskLevel}` +
        (p.archetype ? ` · arquetipo ${p.archetype}` : "") +
        (p.waitMinutes != null ? ` · espera ${p.waitMinutes} min` : "") +
        `\n   lead: ${p.lead}`
      );
    })
    .join("\n");
}

const CACHE_TTL_MS = 24 * 3600 * 1000;

export async function readTrajectory(input: {
  user: IUser;
  target: ITarget;
  force?: boolean;
}): Promise<{ reading: TrajectoryReading; cached: boolean; generatedAt: Date; points: TimelinePoint[] }> {
  const { target } = input;
  const points = await buildTimeline(target);

  const cached: any = (target as any).trajectory;
  if (
    !input.force &&
    cached?.reading &&
    cached.analysisCount === target.analysisCount &&
    Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL_MS
  ) {
    return { reading: cached.reading, cached: true, generatedAt: cached.generatedAt, points };
  }

  const context =
    clockLayer(input.user.timezone) +
    "\n\n" +
    buildDossierLayer(target) +
    "\n\n" +
    buildImportedHistoryLayer(target) +
    `\n\n=== SERIE DE ANALISIS (${points.length}) ===\n` +
    (points.length ? pointsToText(points) : "(sin analisis todavia)");

  const result = await generateStructured({
    task: "chat",
    system: `${BUNKER_SYSTEM}\n\n${TRAJECTORY_MODE}${personaDirective(input.user.alfiiPersona)}`,
    parts: [{ text: `${context}\n\nLee la trayectoria completa y responde en el schema.` }],
    jsonSchema: trajectoryResponseSchema,
    validator: trajectorySchema,
    temperature: 0.6,
    maxOutputTokens: 1400,
    attribution: { userId: String(input.user._id) },
  });

  const generatedAt = new Date();
  await TargetModel.findByIdAndUpdate(target._id, {
    $set: {
      trajectory: { reading: result.data, generatedAt, analysisCount: target.analysisCount },
    },
  });

  return { reading: result.data, cached: false, generatedAt, points };
}

export function isObjectId(id: string): boolean {
  return Types.ObjectId.isValid(id);
}
