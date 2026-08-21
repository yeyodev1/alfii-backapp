import { z } from "zod";
import { generateStructured } from "./ai/structured";
import { BUNKER_SYSTEM } from "../prompts/bunker.system";
import { personaDirective } from "../prompts/personas";
import { assembleContext } from "./context.service";
import { PowerProfileModel } from "../models/powerProfile.model";
import type { ITarget } from "../models/target.model";
import type { IUser } from "../models/user.model";
import type { VisionExtraction } from "../schemas/vision.schema";
import { threadToText, timelineBrief } from "./vision.service";
import { logMetrics } from "../utils/redact";

/**
 * Triaje de una captura dentro de un expediente.
 *
 * Antes, cada captura disparaba el estudio completo de 6 bloques. Eso cansa:
 * la mayoria de las capturas son "mira lo que me dijo, ¿que le respondo?" y
 * piden una respuesta de chat, no un expediente. Aqui el modelo decide en
 * una llamada barata: ¿esto es un HITO (algo que cambia el expediente) o un
 * turno normal? Si es turno normal, ya devuelve la respuesta conversacional;
 * si es hito, el controlador corre el analisis completo.
 */

export const MILESTONE_KINDS = [
  "FIRST_DATE_SET",
  "DATE_HAPPENED",
  "KISS",
  "NIGHT",
  "WENT_COLD",
  "GHOSTING",
  "CONFLICT",
  "SHIT_TEST_STRONG",
  "RISK_FLAG",
  "RECONNECT",
  "RELATIONSHIP_SHIFT",
  "NONE",
] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const MILESTONE_LABELS: Record<MilestoneKind, string> = {
  FIRST_DATE_SET: "Cita pactada",
  DATE_HAPPENED: "Se vieron",
  KISS: "Beso",
  NIGHT: "Noche",
  WENT_COLD: "Se enfrió",
  GHOSTING: "Dejó de responder",
  CONFLICT: "Conflicto",
  SHIT_TEST_STRONG: "Prueba fuerte",
  RISK_FLAG: "Bandera roja",
  RECONNECT: "Reconexión",
  RELATIONSHIP_SHIFT: "Cambio de etapa",
  NONE: "",
};

const triageSchema = z.object({
  milestone: z.boolean(),
  milestoneKind: z.enum(MILESTONE_KINDS),
  milestoneLabel: z.string().max(60).nullish(),
  reason: z.string().max(240),
  reply: z.string().min(1).max(1600),
});
export type ScreenshotTriage = z.infer<typeof triageSchema>;

const triageResponseSchema = {
  type: "object",
  properties: {
    milestone: {
      type: "boolean",
      description: "true SOLO si la captura muestra un hito que cambia el expediente (ver reglas). false para un intercambio normal.",
    },
    milestoneKind: { type: "string", enum: [...MILESTONE_KINDS] },
    milestoneLabel: { type: "string", nullable: true, description: "Etiqueta corta del hito en español, ej. 'Cita pactada para el sabado'. null si no hay hito." },
    reason: { type: "string", description: "Por que es o no es hito, una frase." },
    reply: {
      type: "string",
      description:
        "Respuesta conversacional de Alfii a esta captura, en el FORMATO de chat: parrafos cortos, mensaje para ella en linea '> ', tiempo en linea '⏱ ', cierre '➜ '. Aunque sea hito, escribela igual (se usa como saludo antes del analisis).",
    },
  },
  required: ["milestone", "milestoneKind", "reason", "reply"],
} as const;

const TRIAGE_MODE = `MODO CAPTURA EN EXPEDIENTE.
El usuario te manda una captura nueva de un chat que YA conoces (tienes el
dossier). No hagas un estudio completo por defecto: responde como en el chat,
como un asesor que ya esta al tanto.

¿ES HITO? Marca milestone=true SOLO si la captura muestra algo que cambia el
expediente de verdad:
- Se pacta o se concreta una cita / un plan con dia (FIRST_DATE_SET) o ya se
  vieron (DATE_HAPPENED).
- Hubo beso (KISS) o pasaron la noche (NIGHT), explicito o inequivoco.
- Ella se enfrio claramente respecto al patron del dossier (WENT_COLD) o
  dejo de responder varios dias (GHOSTING).
- Conflicto, reclamo o discusion real (CONFLICT).
- Una prueba de marco fuerte que exige cirugia (SHIT_TEST_STRONG).
- Bandera roja: dinero, manipulacion, terceros, mentira (RISK_FLAG).
- Reconexion tras silencio largo (RECONNECT) o cambio de etapa claro
  (RELATIONSHIP_SHIFT: "somos algo", exclusividad, ruptura).
Un "jaja", un plan vago, un "ando ocupada", una foto, coqueteo normal o una
pregunta suelta NO son hito: milestone=false, milestoneKind=NONE.

REPLY (siempre): lee el reloj (horas, dias, saltos) y el ultimo mensaje de
ella en el contexto del dossier. Di en 2-4 frases que esta pasando, propone
UN mensaje para ella en una linea que empiece con "> " (maximo 2 si hay dos
caminos claros), el tiempo en una linea "⏱ " si aplica, y cierra con una
linea "➜ " con la accion. Si el usuario escribio una nota o pregunta con la
captura, respondele a eso primero. Sin encabezados ni listas numeradas.`;

export async function triageScreenshot(input: {
  user: IUser;
  target: ITarget;
  extraction: VisionExtraction;
  userNote?: string;
}): Promise<ScreenshotTriage> {
  const profile = await PowerProfileModel.findOne({ userId: input.user._id });
  const context = await assembleContext({
    user: input.user,
    profile,
    target: input.target,
    includeThreads: true,
    includeHistory: true,
  });

  const threadText = threadToText(input.extraction.thread);
  const text =
    `${context.text}\n\n=== CAPTURA NUEVA ===\n` +
    `Tiempo: ${timelineBrief(input.extraction)}\n\n${threadText}\n\n` +
    (input.userNote ? `=== LO QUE DICE EL USUARIO CON LA CAPTURA ===\n${input.userNote}\n\n` : "") +
    `Decide si es hito y escribe la respuesta de chat.`;

  const result = await generateStructured({
    task: "chat",
    system: `${BUNKER_SYSTEM}\n\n${TRIAGE_MODE}${personaDirective(input.user.alfiiPersona)}`,
    parts: [{ text }],
    jsonSchema: triageResponseSchema,
    validator: triageSchema,
    temperature: 0.7,
    maxOutputTokens: 1400,
    attribution: { userId: String(input.user._id) },
  });

  logMetrics("screenshot.triage", {
    provider: result.provider,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
  });

  const data = result.data;
  if (!data.milestone) data.milestoneKind = "NONE";
  if (data.milestone && data.milestoneKind === "NONE") data.milestoneKind = "RELATIONSHIP_SHIFT";
  return data;
}
