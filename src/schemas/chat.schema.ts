import { z } from "zod";
import { stateUpdateSchema } from "./analysis.schema";

/**
 * Modo conversacion: Alfii responde en prosa y puede proponer una mutacion
 * del dossier. El texto se emite por streaming; el stateUpdate llega al final.
 */
export const chatReplySchema = z.object({
  reply: z.string().min(1).max(2600),
  stateUpdate: stateUpdateSchema.nullish(),
  lessonHints: z.array(z.string().max(40)).max(2).default([]),
  crisisDetected: z.boolean().default(false),
});

export type ChatReply = z.infer<typeof chatReplySchema>;

export const chatResponseSchema = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "Tu respuesta al usuario. Prosa directa, sin markdown de encabezados.",
    },
    crisisDetected: {
      type: "boolean",
      description:
        "true si el usuario o la persona analizada muestra riesgo de autolesion, violencia o crisis de salud mental",
    },
    stateUpdate: {
      type: "object",
      nullable: true,
      properties: {
        stage: { type: "string", nullable: true },
        riskLevel: { type: "string", nullable: true },
        summaryPatch: { type: "string", nullable: true },
        meters: {
          type: "object",
          nullable: true,
          properties: {
            kiss: { type: "number", nullable: true },
            firstDate: { type: "number", nullable: true },
            firstNight: { type: "number", nullable: true },
          },
        },
      },
    },
    lessonHints: { type: "array", items: { type: "string" } },
  },
  required: ["reply", "crisisDetected"],
} as const;

/** Saludo proactivo de reingreso. */
export const greetingResponseSchema = {
  type: "object",
  properties: {
    greeting: {
      type: "string",
      description:
        "Una o dos frases. Retoma el hilo con un dato concreto del dossier y termina con una pregunta.",
    },
  },
  required: ["greeting"],
} as const;

export const greetingSchema = z.object({ greeting: z.string().min(1).max(600) });

/** Resumen de compactacion. */
export const compactionResponseSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "Resumen rodante de la relacion, maximo 1200 caracteres. Reescribelo completo, no lo concatenes.",
    },
  },
  required: ["summary"],
} as const;

export const compactionSchema = z.object({ summary: z.string().min(1).max(1400) });
