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
  /**
   * La frase que demuestra que Alfii escucho.
   *
   * PORQUE existe como campo aparte y no dentro de `reply`: el frontend la pinta
   * fija junto a la pregunta, donde el usuario la ve mientras elige. Dentro del
   * texto del chat se pierde en cuanto entra el mensaje siguiente, y es
   * justamente lo que hace que la plataforma se sienta viva y no un formulario
   * que va soltando preguntas sueltas.
   */
  contextNote: z.string().max(140).catch("").default(""),

  /**
   * Titulo corto de LA PREGUNTA DE ESTE TURNO.
   *
   * PORQUE: el titulo de la tarjeta era estatico por bloque ("¿A que te
   * dedicas?") mientras el bloque encadena sub-preguntas. El usuario veia ese
   * titulo con la pregunta de la escala 1-5 debajo: dos preguntas distintas en
   * la misma tarjeta. Solo el modelo sabe que pregunto en este turno.
   */
  question: z.string().max(90).catch("").default(""),

  /**
   * Opciones tocables PARA LA PREGUNTA QUE ACABAS DE HACER.
   *
   * PORQUE llevan hint y las manda el modelo: el catalogo canonico esta atado al
   * bloque, no al turno, y varios bloques encadenan sub-preguntas. En PHILOSOPHY
   * el usuario veia "Algo serio / Algo casual" mientras Alfii le preguntaba por
   * sus lineas rojas; tocaba una y Alfii le respondia que no era eso. El modelo
   * es el unico que sabe que pregunto en este turno concreto.
   */
  chipOptions: z
    .array(
      z.object({
        label: z.string().min(1).max(40),
        hint: z.string().max(90).catch(""),
      })
    )
    .max(8)
    .catch([])
    .default([]),
  extracted: z
    .object({
      preferredName: z.string().max(40).nullish().catch(null),
      // Solo si el usuario lo confirmo o lo dijo: la pista de IP nunca se
      // extrae sola, porque VPNs y proxies mienten.
      country: z.string().max(60).nullish().catch(null),
      city: z.string().max(80).nullish().catch(null),
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
    contextNote: {
      type: "string",
      description:
        "Una frase corta (max 140 caracteres) que conecte esta pregunta con algo CONCRETO que " +
        "el usuario ya te dijo, citandolo. Ejemplos: 'Dijiste que tu fuerte es la presencia, " +
        "asi que esto te va a encajar' o 'Buscas algo serio: entonces esto pesa mas de lo " +
        "normal'. Nunca generica ('para conocerte mejor'). Cadena vacia solo si todavia no " +
        "sabes nada de el.",
    },
    question: {
      type: "string",
      description:
        "La pregunta con la que TERMINA tu reply, como titulo corto (max 80 caracteres) para " +
        "encabezar la tarjeta. Tiene que ser LA MISMA pregunta que tu reply realmente hace: " +
        "si tu reply cierra con '¿Te suena?', question resume ESA confirmacion, no la que " +
        "planeas hacer despues ni la del bloque. JAMAS pongas aqui una pregunta que tu reply " +
        "no contiene. Cadena vacia si tu reply no pregunta nada.",
    },
    chipOptions: {
      type: "array",
      description:
        "Entre 3 y 6 respuestas tocables para LA PREGUNTA QUE ACABAS DE HACER EN ESTE TURNO, " +
        "no para el bloque en general. Si en tu reply preguntaste por lineas rojas, las opciones " +
        "son lineas rojas. Cada una: label corta en castellano natural (jamas el identificador " +
        "interno tipo CABALLERO_CLASICO o MENOS_500) y hint de una linea que explique que implica " +
        "elegirla. Array vacio si la pregunta es abierta y no admite opciones cerradas.",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Texto del boton. Corto, en castellano natural." },
          hint: {
            type: "string",
            description: "Una linea explicando que significa elegir esta opcion.",
          },
        },
        required: ["label", "hint"],
      },
    },
    extracted: {
      type: "object",
      nullable: true,
      properties: {
        preferredName: { type: "string", nullable: true },
        country: {
          type: "string",
          nullable: true,
          description:
            "Pais del usuario, SOLO si el lo confirmo o lo dijo en la conversacion. Nunca lo deduzcas tu de la pista de conexion.",
        },
        city: {
          type: "string",
          nullable: true,
          description: "Ciudad del usuario, SOLO si el la confirmo o la dijo.",
        },
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
