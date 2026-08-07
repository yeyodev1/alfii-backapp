import { z } from "zod";
import { ARCHETYPES, RISK_LEVELS, SCRIPT_STYLES, STAGES } from "./enums";

/**
 * Confianza normalizada a 0..1.
 *
 * El modelo devuelve indistintamente 0.85 o 85 por mas que el schema diga
 * 0 a 1. Antes eso disparaba el reintento de reparacion en CADA analisis:
 * dos llamadas en vez de una, el doble de latencia y de costo. Normalizar aqui
 * es infinitamente mas barato que pedirselo al modelo.
 */
const confidence01 = z.preprocess((value) => {
  if (typeof value !== "number") return value;
  if (value > 1 && value <= 100) return value / 100;
  return value;
}, z.number().min(0).max(1));

/**
 * El "Protocolo de Respuesta Obligatorio" de 6 bloques como contrato de datos.
 * El modelo no devuelve markdown: devuelve esto, y el frontend lo renderiza
 * nativo. Asi la tarjeta de analisis nunca depende de parsear texto.
 */

export const stateUpdateSchema = z.object({
  stage: z.enum(STAGES).nullish(),
  meters: z
    .object({
      kiss: z.number().min(0).max(100).nullish(),
      firstDate: z.number().min(0).max(100).nullish(),
      firstNight: z.number().min(0).max(100).nullish(),
    })
    .nullish(),
  archetypeShift: z
    .object({
      primary: z.enum(ARCHETYPES),
      hybrid: z.array(z.enum(ARCHETYPES)).max(2).default([]),
      confidence: confidence01,
    })
    .nullish(),
  newRiskFlags: z
    .array(
      z.object({
        code: z.string().max(48),
        description: z.string().max(240),
        severity: z.number().int().min(1).max(5),
      })
    )
    .max(4)
    .nullish(),
  riskLevel: z.enum(RISK_LEVELS).nullish(),
  timingObserved: z
    .object({
      herReplyMinutes: z.number().min(0).max(100000).nullish(),
      herActiveHours: z.array(z.number().int().min(0).max(23)).max(24).nullish(),
    })
    .nullish(),
  summaryPatch: z.string().max(900).nullish(),
});

export type StateUpdate = z.infer<typeof stateUpdateSchema>;

export const analysisPayloadSchema = z.object({
  subtext: z.object({
    reading: z.string().min(1).max(1400),
    frameDetected: z.string().max(240),
    shitTestDetected: z.boolean(),
    shitTestType: z.string().max(120).nullish(),
  }),
  archetypeDiagnosis: z.object({
    primary: z.enum(ARCHETYPES),
    hybrid: z.array(z.enum(ARCHETYPES)).max(2).default([]),
    confidence: confidence01,
    reasoning: z.string().max(700),
  }),
  riskRadar: z.object({
    level: z.enum(RISK_LEVELS),
    transactionalRisk: z.number().min(0).max(100),
    flags: z
      .array(
        z.object({
          code: z.string().max(48),
          description: z.string().max(240),
          severity: z.number().int().min(1).max(5),
        })
      )
      .max(5)
      .default([]),
    userPostureCorrection: z.string().max(600).nullish(),
  }),
  timing: z.object({
    waitMinutes: z.number().int().min(0).max(20160),
    recommendedReadAt: z.string().max(60).nullish(),
    rationale: z.string().max(500),
  }),
  scripts: z
    .array(
      z.object({
        style: z.enum(SCRIPT_STYLES),
        text: z.string().min(1).max(600),
        rationale: z.string().max(600),
      })
    )
    .length(3),
  meters: z.object({
    kiss: z.number().min(0).max(100),
    firstDate: z.number().min(0).max(100),
    firstNight: z.number().min(0).max(100),
  }),
  lead: z.string().max(400),
  stateUpdate: stateUpdateSchema.nullish(),
  lessonHints: z.array(z.string().max(40)).max(3).default([]),
});

export type AnalysisPayload = z.infer<typeof analysisPayloadSchema>;

/** Schema en formato Gemini. */
export const analysisResponseSchema = {
  type: "object",
  properties: {
    lead: {
      type: "string",
      description:
        "Una o dos frases de entrada conversacional, dirigidas al usuario por su nombre si lo conoces. Es lo primero que lee antes de la tarjeta.",
    },
    subtext: {
      type: "object",
      properties: {
        reading: {
          type: "string",
          description:
            "Desglose de la psicologia oculta detras del mensaje. Concreto, sin generalidades. Cita fragmentos reales del hilo.",
        },
        frameDetected: {
          type: "string",
          description: "Que marco esta operando en la conversacion, en una frase",
        },
        shitTestDetected: { type: "boolean" },
        shitTestType: { type: "string", nullable: true },
      },
      required: ["reading", "frameDetected", "shitTestDetected"],
    },
    archetypeDiagnosis: {
      type: "object",
      properties: {
        primary: { type: "string", enum: [...ARCHETYPES] },
        hybrid: { type: "array", items: { type: "string", enum: [...ARCHETYPES] } },
        confidence: { type: "number", description: "Decimal entre 0 y 1. Ejemplo: 0.85 para 85 por ciento" },
        reasoning: { type: "string" },
      },
      required: ["primary", "hybrid", "confidence", "reasoning"],
    },
    riskRadar: {
      type: "object",
      properties: {
        level: { type: "string", enum: [...RISK_LEVELS] },
        transactionalRisk: { type: "number", description: "0 a 100" },
        flags: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string", description: "SCREAMING_SNAKE_CASE, ej INTERES_INSTRUMENTAL" },
              description: { type: "string" },
              severity: { type: "integer", description: "1 a 5" },
            },
            required: ["code", "description", "severity"],
          },
        },
        userPostureCorrection: {
          type: "string",
          nullable: true,
          description:
            "Si el usuario muestra desesperacion, sobre-inversion o marco de baja valia, corrigelo con firmeza aqui. null si su postura es solida.",
        },
      },
      required: ["level", "transactionalRisk", "flags"],
    },
    timing: {
      type: "object",
      properties: {
        waitMinutes: { type: "integer", description: "Minutos a esperar antes de responder" },
        recommendedReadAt: { type: "string", nullable: true },
        rationale: { type: "string" },
      },
      required: ["waitMinutes", "rationale"],
    },
    scripts: {
      type: "array",
      description: "Exactamente 3 opciones, una por estilo, en el orden PODER, CABALLERO, PICARO",
      items: {
        type: "object",
        properties: {
          style: { type: "string", enum: [...SCRIPT_STYLES] },
          text: { type: "string", description: "El mensaje literal, listo para copiar y enviar" },
          rationale: { type: "string", description: "Por que funciona" },
        },
        required: ["style", "text", "rationale"],
      },
    },
    meters: {
      type: "object",
      properties: {
        kiss: { type: "number" },
        firstDate: { type: "number" },
        firstNight: { type: "number" },
      },
      required: ["kiss", "firstDate", "firstNight"],
    },
    stateUpdate: {
      type: "object",
      nullable: true,
      properties: {
        stage: { type: "string", enum: [...STAGES], nullable: true },
        riskLevel: { type: "string", enum: [...RISK_LEVELS], nullable: true },
        summaryPatch: {
          type: "string",
          nullable: true,
          description: "Resumen rodante actualizado de la relacion, maximo 900 caracteres",
        },
        timingObserved: {
          type: "object",
          nullable: true,
          properties: {
            herReplyMinutes: { type: "number", nullable: true },
          },
        },
      },
    },
    lessonHints: {
      type: "array",
      description:
        "Ids de conceptos que aparecieron y el usuario quizas no conoce. Valores posibles: shit-test, marco, riesgo-transaccional, timing, activos-reales, lineas-rojas",
      items: { type: "string" },
    },
  },
  required: [
    "lead",
    "subtext",
    "archetypeDiagnosis",
    "riskRadar",
    "timing",
    "scripts",
    "meters",
  ],
} as const;
