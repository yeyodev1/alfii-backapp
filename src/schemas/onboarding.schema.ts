import { z } from "zod";
import { FINANCE_STANCES, INCOME_RANGES, PERSONALITY_STYLES, SEEKING } from "./enums";

/**
 * La Auditoria. Alfii conversa, extrae campos estructurados y entrega una
 * micro-leccion al cerrar cada bloque.
 */
/**
 * Los campos extraidos son TOLERANTES a proposito (`.catch(null)`).
 *
 * PORQUE: `reply` es lo unico que el usuario ve. Si un solo campo secundario
 * viene mal tipado, el turno entero devolvia 502 y la conversacion se rompia
 * aunque la respuesta de Alfii fuera perfecta. Paso de verdad: el usuario dijo
 * "fluidez verbal" sin puntuarla, el modelo mando selfRating null porque no
 * habia nota que dar, y la Auditoria murio ahi.
 *
 * Con `.catch(null)` un valor invalido se descarta y el turno continua. Lo
 * estricto se mantiene donde importa: `reply` sigue siendo obligatorio, y los
 * rangos duros (estatura, peso) siguen filtrando valores absurdos, solo que
 * ahora los tiran en vez de tumbar la peticion.
 */
const optionalInt = (min: number, max: number) =>
  z.number().int().min(min).max(max).nullish().catch(null);

export const onboardingReplySchema = z.object({
  reply: z.string().min(1).max(1400),
  blockComplete: z.boolean(),
  framePenalty: z.number().int().min(0).max(15).catch(0).default(0),
  microLessonId: z.string().max(40).nullish().catch(null),
  suggestedChips: z.array(z.string().max(40)).max(8).catch([]).default([]),
  extracted: z
    .object({
      preferredName: z.string().max(40).nullish().catch(null),
      profession: z.string().max(120).nullish().catch(null),
      successLevel: optionalInt(1, 5),
      socioeconomic: z.string().max(80).nullish().catch(null),
      assets: z
        .array(
          z.object({
            asset: z.string().max(60),
            // Nullable: el usuario nombra un activo sin puntuarlo casi siempre.
            // Al persistir se omite y Mongoose aplica su default de 3.
            selfRating: optionalInt(1, 5),
          })
        )
        .max(10)
        .nullish()
        .catch(null),
      seeking: z.enum(SEEKING).nullish().catch(null),
      redLines: z.array(z.string().max(140)).max(8).nullish().catch(null),
      financeStance: z.enum(FINANCE_STANCES).nullish().catch(null),
      personalityStyle: z.enum(PERSONALITY_STYLES).nullish().catch(null),
      // Rangos duros: si el modelo inventa una estatura de 12 o de 900 se
      // descarta aqui y no llega a contaminar la carta del usuario.
      incomeMonthlyRange: z.enum(INCOME_RANGES).nullish().catch(null),
      incomeCurrency: z.string().max(8).nullish().catch(null),
      heightCm: optionalInt(120, 250),
      weightKg: optionalInt(35, 300),
      buildSelfRating: optionalInt(1, 5),
    })
    .nullish()
    .catch(null),
});

export type OnboardingReply = z.infer<typeof onboardingReplySchema>;

export const onboardingResponseSchema = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description:
        "Tu mensaje al usuario. Si detectas marco de baja valia, corrigelo con firmeza antes de continuar.",
    },
    blockComplete: {
      type: "boolean",
      description: "true solo si ya extrajiste todos los campos de este bloque",
    },
    framePenalty: {
      type: "integer",
      description:
        "0 normalmente. 5 a 15 si el usuario respondio con marco de baja valia, desesperacion o auto-desprecio",
    },
    microLessonId: {
      type: "string",
      nullable: true,
      description:
        "Solo cuando blockComplete es true. Uno de: marco, activos-reales, lineas-rojas, timing",
    },
    suggestedChips: {
      type: "array",
      description: "Respuestas tocables sugeridas para bajar la friccion. Maximo 6, cortas.",
      items: { type: "string" },
    },
    extracted: {
      type: "object",
      nullable: true,
      properties: {
        preferredName: { type: "string", nullable: true },
        profession: { type: "string", nullable: true },
        successLevel: { type: "integer", nullable: true, description: "1 a 5" },
        socioeconomic: { type: "string", nullable: true },
        assets: {
          type: "array",
          nullable: true,
          items: {
            type: "object",
            properties: {
              asset: { type: "string" },
              selfRating: {
                type: "integer",
                nullable: true,
                description:
                  "1 a 5, SOLO si el usuario puntuo ese activo. Si lo nombro sin darle nota, null. No inventes la nota.",
              },
            },
            required: ["asset"],
          },
        },
        seeking: { type: "string", enum: [...SEEKING], nullable: true },
        redLines: { type: "array", nullable: true, items: { type: "string" } },
        financeStance: { type: "string", enum: [...FINANCE_STANCES], nullable: true },
        personalityStyle: { type: "string", enum: [...PERSONALITY_STYLES], nullable: true },
        incomeMonthlyRange: {
          type: "string",
          enum: [...INCOME_RANGES],
          nullable: true,
          description: "Rango de ingreso mensual. Nunca lo infieras: solo si el usuario lo dice.",
        },
        incomeCurrency: {
          type: "string",
          nullable: true,
          description: "Codigo de moneda del ingreso, por ejemplo USD o EUR",
        },
        heightCm: { type: "integer", nullable: true, description: "Estatura en centimetros" },
        weightKg: { type: "integer", nullable: true, description: "Peso en kilogramos" },
        buildSelfRating: {
          type: "integer",
          nullable: true,
          description: "1 a 5. Como califica el usuario su propio estado fisico.",
        },
      },
    },
  },
  required: ["reply", "blockComplete", "framePenalty"],
} as const;
