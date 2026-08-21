import { z } from "zod";
import sharp from "sharp";
import { generateStructured } from "./ai/structured";
import { BUNKER_SYSTEM } from "../prompts/bunker.system";
import { personaDirective } from "../prompts/personas";
import { assembleContext } from "./context.service";
import { TargetModel, type ITarget } from "../models/target.model";
import { PowerProfileModel } from "../models/powerProfile.model";
import type { IUser } from "../models/user.model";
import { CustomError } from "../errors/customError.error";
import { logMetrics } from "../utils/redact";

/**
 * "Nosotros": la lectura de la relacion como pareja-en-construccion, no de un
 * mensaje. Que dinamica tienen, que hace bien EL, que debe mejorar, que
 * senales da ELLA, y — clave — como cambio respecto a la lectura anterior.
 *
 * Cada lectura se guarda en target.usReadings (historial, tope 30). Al pedir
 * una nueva, la anterior viaja al modelo para que marque cada mejora como
 * NUEVO / MEJORO / IGUAL / EMPEORO: asi el usuario ve progreso real, no una
 * foto suelta cada vez.
 */

const STATUS = ["NUEVO", "MEJORO", "IGUAL", "EMPEORO", "LOGRADO"] as const;

export const usReadingSchema = z.object({
  score: z.number().min(0).max(100),
  headline: z.string().min(1).max(160),
  dynamic: z.string().min(1).max(800),
  hisStrengths: z.array(z.string().max(140)).max(3),
  improvements: z
    .array(
      z.object({
        area: z.string().min(1).max(60),
        advice: z.string().min(1).max(220),
        status: z.enum(STATUS),
      })
    )
    .max(5),
  herSignals: z.array(z.string().max(160)).max(4),
  nextStep: z.string().min(1).max(220),
  confidence: z.number().min(0).max(1),
});
export type UsReading = z.infer<typeof usReadingSchema>;

const usResponseSchema = {
  type: "object",
  properties: {
    score: { type: "number", description: "0-100: que tan bien va esto como vinculo, hoy." },
    headline: { type: "string", description: "Una frase sobre ustedes dos. Max 160 chars." },
    dynamic: {
      type: "string",
      description: "La dinamica entre ambos en 3-5 frases de prosa: quien lleva el ritmo, como se tratan, que patron se repite. Max 800.",
    },
    hisStrengths: { type: "array", items: { type: "string" }, description: "Lo que EL esta haciendo bien (max 3)." },
    improvements: {
      type: "array",
      description: "Areas de mejora de EL (max 5). Si hubo lectura anterior, conserva las mismas areas y marca status; puedes anadir NUEVO o cerrar con LOGRADO.",
      items: {
        type: "object",
        properties: {
          area: { type: "string", description: "Nombre corto del area, ej. 'Iniciativa', 'Tiempo de respuesta'." },
          advice: { type: "string", description: "Que hacer concretamente." },
          status: { type: "string", enum: [...STATUS] },
        },
        required: ["area", "advice", "status"],
      },
    },
    herSignals: { type: "array", items: { type: "string" }, description: "Senales concretas de ELLA con cita literal si la hay (max 4)." },
    nextStep: { type: "string", description: "La siguiente jugada de EL para que esto avance. Una frase." },
    confidence: { type: "number" },
  },
  required: ["score", "headline", "dynamic", "hisStrengths", "improvements", "herSignals", "nextStep", "confidence"],
} as const;

const US_MODE = `MODO NOSOTROS.
No analizas un mensaje: analizas el VINCULO entre EL (tu cliente) y ELLA como
un todo, usando todo el expediente: dossier, historial importado, capturas,
conversacion con el usuario, hitos y fotos. Responde en el schema.

Reglas:
- El score es del vinculo hoy (0 = muerto, 100 = relacion consolidada y sana).
- "improvements" son areas de EL, no de ella. Si recibes LECTURA ANTERIOR,
  conserva sus areas con el mismo nombre y marca status comparando con la
  evidencia nueva: MEJORO si hay pruebas de cambio, EMPEORO si retrocedio,
  IGUAL si no hay evidencia nueva, LOGRADO si ya no es un problema. Areas
  nuevas van como NUEVO. Sin lectura anterior, todo es NUEVO.
- Cita frases literales de ella cuando sostengan una senal.
- Sin markdown, sin listas dentro de los textos. Español directo, tono del
  asesor, consejos sanos: nunca manipulacion.`;

function previousToText(prev: UsReading | null): string {
  if (!prev) return "(sin lectura anterior: primera vez)";
  return (
    `score ${prev.score} · "${prev.headline}"\n` +
    prev.improvements.map((i) => `- ${i.area} [${i.status}]: ${i.advice}`).join("\n")
  );
}

export interface UsHistoryItem {
  generatedAt: Date;
  analysisCount: number;
  score: number;
  headline: string;
}

function historyOf(target: ITarget): { items: UsHistoryItem[]; last: UsReading | null; lastAt: Date | null } {
  const raw: any[] = Array.isArray((target as any).usReadings) ? (target as any).usReadings : [];
  const items = raw.map((r) => ({
    generatedAt: r.generatedAt,
    analysisCount: r.analysisCount,
    score: r.reading?.score ?? 0,
    headline: r.reading?.headline ?? "",
  }));
  const lastRaw = raw[raw.length - 1];
  return { items, last: lastRaw?.reading ?? null, lastAt: lastRaw?.generatedAt ?? null };
}

export async function getUs(target: ITarget) {
  const h = historyOf(target);
  return { reading: h.last, generatedAt: h.lastAt, history: h.items, analysisCount: target.analysisCount };
}

export async function readUs(input: { user: IUser; target: ITarget; force?: boolean }) {
  const { target } = input;
  const h = historyOf(target);

  // Sin evidencia nueva y lectura reciente: se devuelve la ultima. Con
  // force=1 se regenera aunque no haya cambiado nada.
  const lastAt = h.lastAt ? new Date(h.lastAt).getTime() : 0;
  const fresh = Date.now() - lastAt < 12 * 3600 * 1000;
  const lastCount = (target as any).usReadings?.at?.(-1)?.analysisCount ?? -1;
  if (!input.force && h.last && fresh && lastCount === target.analysisCount) {
    return { reading: h.last, previous: h.items.length > 1 ? (target as any).usReadings.at(-2).reading : null, generatedAt: h.lastAt, history: h.items, cached: true };
  }

  const profile = await PowerProfileModel.findOne({ userId: input.user._id });
  const context = await assembleContext({
    user: input.user,
    profile,
    target,
    includeThreads: true,
    includeHistory: true,
  });

  const result = await generateStructured({
    task: "analysis",
    system: `${BUNKER_SYSTEM}\n\n${US_MODE}${personaDirective(input.user.alfiiPersona)}`,
    parts: [
      {
        text:
          `${context.text}\n\n=== LECTURA ANTERIOR DE NOSOTROS ===\n${previousToText(h.last)}\n\n` +
          `Lee el vinculo completo y responde en el schema.`,
      },
    ],
    jsonSchema: usResponseSchema,
    validator: usReadingSchema,
    temperature: 0.6,
    maxOutputTokens: 1800,
    attribution: { userId: String(input.user._id) },
  });

  const generatedAt = new Date();
  const entry = { reading: result.data, generatedAt, analysisCount: target.analysisCount };
  await TargetModel.findByIdAndUpdate(target._id, {
    $push: { usReadings: { $each: [entry], $slice: -30 } },
  });

  logMetrics("us.read", {
    provider: result.provider,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
  });

  return {
    reading: result.data,
    previous: h.last,
    generatedAt,
    history: [...h.items, { generatedAt, analysisCount: target.analysisCount, score: result.data.score, headline: result.data.headline }],
    cached: false,
  };
}

// ---------------------------------------------------------------------------
// Foto de ustedes / de la salida
// ---------------------------------------------------------------------------

export const photoReadingSchema = z.object({
  summary: z.string().min(1).max(300),
  chemistry: z.number().min(0).max(100),
  observations: z.array(z.string().max(200)).max(5),
  wentWell: z.array(z.string().max(160)).max(3),
  improve: z.array(z.string().max(160)).max(3),
  herRead: z.string().max(300),
  nextStep: z.string().min(1).max(200),
});
export type PhotoReading = z.infer<typeof photoReadingSchema>;

const photoResponseSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Que se ve y como les fue, en 2 frases." },
    chemistry: { type: "number", description: "0-100 quimica/cercania que transmite la imagen." },
    observations: { type: "array", items: { type: "string" }, description: "Lenguaje corporal, distancia, quien se inclina, expresiones, contexto (max 5)." },
    wentWell: { type: "array", items: { type: "string" } },
    improve: { type: "array", items: { type: "string" } },
    herRead: { type: "string", description: "Como se la ve a ELLA: comoda, distante, divertida... con la evidencia visual." },
    nextStep: { type: "string" },
  },
  required: ["summary", "chemistry", "observations", "wentWell", "improve", "herRead", "nextStep"],
} as const;

const PHOTO_SYSTEM = `Eres Alfii. Recibes una FOTO que el usuario (EL) subio de una salida, una cita
o de ellos dos juntos. Tu trabajo: leer como les fue a partir de lo visible —
lenguaje corporal, distancia, contacto, hacia donde se inclinan, expresiones,
quien sostiene a quien, energia del momento, contexto del lugar.

Reglas: describe solo lo que se ve, no inventes identidades ni datos. Nada de
juicios sobre el fisico de nadie. Si la foto no muestra a dos personas (solo
un lugar, comida, un selfie de el), leelo igual: que dice de la salida y que
aprovechar. Español directo, concreto, consejos sanos. Responde en el schema.`;

export async function readPhoto(input: {
  user: IUser;
  target: ITarget;
  buffer: Buffer;
  note?: string;
}): Promise<{ reading: PhotoReading; processed: Buffer }> {
  let processed: Buffer;
  try {
    processed = await sharp(input.buffer)
      .rotate()
      .resize({ width: 1400, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    throw new CustomError("No pude leer esa imagen. Prueba con un PNG o JPG.", 400);
  }

  const dossier = `Expediente: ella se llama ${input.target.displayName}. Etapa: ${input.target.stage}.`;
  const result = await generateStructured({
    task: "vision",
    system: `${PHOTO_SYSTEM}${personaDirective(input.user.alfiiPersona)}`,
    parts: [
      { image: { mimeType: "image/jpeg", base64: processed.toString("base64") } },
      {
        text:
          `${dossier}\n` +
          (input.note ? `Lo que dice el usuario de esta foto: ${input.note}\n` : "") +
          `Lee la foto y responde en el schema.`,
      },
    ],
    jsonSchema: photoResponseSchema,
    validator: photoReadingSchema,
    temperature: 0.5,
    maxOutputTokens: 1400,
    attribution: { userId: String(input.user._id) },
  });

  logMetrics("photo.read", {
    provider: result.provider,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
  });

  return { reading: result.data, processed };
}

/** La lectura de la foto como texto con el marcado que pinta AlfiiRichText. */
export function photoReadingToText(r: PhotoReading): string {
  const lines = [
    `**Química ${Math.round(r.chemistry)}/100** · ${r.summary}`,
    r.observations.length ? r.observations.map((o) => `• ${o}`).join("\n") : "",
    r.herRead ? `**Cómo se la ve a ella:** ${r.herRead}` : "",
    r.wentWell.length ? `**Lo que salió bien**\n${r.wentWell.map((o) => `• ${o}`).join("\n")}` : "",
    r.improve.length ? `**Para la próxima**\n${r.improve.map((o) => `• ${o}`).join("\n")}` : "",
    `➜ ${r.nextStep}`,
  ].filter(Boolean);
  return lines.join("\n\n");
}
