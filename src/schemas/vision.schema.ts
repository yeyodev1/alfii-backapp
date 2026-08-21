import { z } from "zod";
import { PLATFORMS } from "./enums";

/**
 * Salida de la llamada de vision (gemini flash). Extrae el hilo de la
 * conversacion con atribucion de hablante y el nombre del encabezado.
 */
export const visionExtractionSchema = z.object({
  readable: z.boolean(),
  issue: z.string().nullable(),
  detectedName: z.string().nullable(),
  platform: z.enum(PLATFORMS),
  confidence: z.preprocess((v) => (typeof v === "number" && v > 1 && v <= 100 ? v / 100 : v), z.number().min(0).max(1)),
  thread: z
    .array(
      z.object({
        speaker: z.enum(["her", "him"]),
        text: z.string(),
        timestamp: z.string().nullable(),
        /** Separador de dia visible ENCIMA de este mensaje ("Hoy", "Ayer",
         *  "12 de agosto", "lun"). null si no hay cambio de dia. */
        dateLabel: z.string().nullable().optional(),
      })
    )
    .max(80),
  timeline: z
    .object({
      hasTimes: z.boolean(),
      daySeparators: z.array(z.string()).max(20).default([]),
      spansMultipleDays: z.boolean().nullable().optional(),
      note: z.string().nullable().optional(),
    })
    .nullish(),
});

export type VisionExtraction = z.infer<typeof visionExtractionSchema>;

/**
 * Schema en el formato que espera la API de Gemini (responseSchema).
 * Se escribe a mano a proposito: el generador automatico desde zod produce
 * construcciones que Gemini rechaza (anyOf, $ref, additionalProperties).
 */
export const visionResponseSchema = {
  type: "object",
  properties: {
    readable: {
      type: "boolean",
      description: "false si la captura esta cortada, borrosa o no es un chat",
    },
    issue: {
      type: "string",
      nullable: true,
      description: "Si readable es false, explica el problema en una frase en espanol",
    },
    detectedName: {
      type: "string",
      nullable: true,
      description: "Nombre o alias que aparece en el encabezado del chat. null si no se ve",
    },
    platform: {
      type: "string",
      enum: [...PLATFORMS],
    },
    confidence: {
      type: "number",
      description: "0 a 1. Confianza en la extraccion del hilo",
    },
    thread: {
      type: "array",
      description: "Mensajes en orden cronologico, del mas antiguo al mas reciente",
      items: {
        type: "object",
        properties: {
          speaker: {
            type: "string",
            enum: ["her", "him"],
            description: "her = la otra persona (burbujas de la izquierda). him = el usuario (burbujas de la derecha)",
          },
          text: {
            type: "string",
            description:
              "Texto literal del mensaje. Si no es texto, un marcador como [foto] o [audio 0:14]. Nunca vacio",
          },
          timestamp: {
            type: "string",
            nullable: true,
            description: "Hora visible del mensaje, tal cual aparece (ej. '21:14', '9:05 p. m.'). Si la hora solo se ve en el ultimo mensaje de un grupo, repitela en los del grupo. null si no se ve",
          },
          dateLabel: {
            type: "string",
            nullable: true,
            description: "Separador de dia que aparece ENCIMA de este mensaje, tal cual ('Hoy', 'Ayer', '12 de agosto', 'lunes', '14/08/25'). Solo en el primer mensaje despues del separador; null en el resto",
          },
        },
        required: ["speaker", "text"],
      },
    },
    timeline: {
      type: "object",
      description: "Lectura temporal de la captura",
      properties: {
        hasTimes: { type: "boolean", description: "true si se ven horas en los mensajes" },
        daySeparators: { type: "array", items: { type: "string" }, description: "Todos los separadores de dia visibles, en orden" },
        spansMultipleDays: { type: "boolean", nullable: true, description: "true si la captura abarca mas de un dia (por separadores o por horas que saltan). null si no se puede saber" },
        note: { type: "string", nullable: true, description: "Cualquier ambiguedad temporal: horas que no se ven, salto grande sin separador, etc. null si todo es claro" },
      },
      required: ["hasTimes", "daySeparators"],
    },
  },
  required: ["readable", "platform", "confidence", "thread", "timeline"],
} as const;
