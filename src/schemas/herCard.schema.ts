import { z } from "zod";

/**
 * Ficha tecnica de ella: la "carta de personaje" del expediente.
 *
 * Es un resumen operativo de todo lo que el dossier sabe de la chica,
 * escrito para leerse de un vistazo como una carta de videojuego: nivel,
 * clase, seis stats, que le gusta, que evitar, que odia y su jugada tipica.
 * Todo debe salir de evidencia del hilo: si no hay datos, el campo va vacio.
 */

export const HER_STAT_KEYS = ["AFE", "EXI", "INI", "JUE", "RIE", "RIT"] as const;
export type HerStatKey = (typeof HER_STAT_KEYS)[number];

export const HER_STAT_LABELS: Record<HerStatKey, string> = {
  AFE: "Afecto",
  EXI: "Exigencia",
  INI: "Iniciativa",
  JUE: "Juego",
  RIE: "Riesgo",
  RIT: "Ritmo",
};

const shortList = (max: number) => z.array(z.string().trim().min(1).max(70)).max(max).default([]);

export const herCardSchema = z.object({
  level: z.number().int().min(1).max(99),
  tagline: z.string().trim().min(1).max(110),
  stats: z
    .array(
      z.object({
        key: z.enum(HER_STAT_KEYS),
        value: z.number().int().min(0).max(100),
        hint: z.string().trim().max(140).default(""),
      })
    )
    .min(6)
    .max(6),
  likes: shortList(5),
  avoid: shortList(5),
  hates: shortList(5),
  winConditions: shortList(4),
  specialMove: z
    .object({
      name: z.string().trim().min(1).max(40),
      description: z.string().trim().min(1).max(220),
    })
    .nullable()
    .default(null),
  confidence: z.number().min(0).max(1),
});

export type HerCardData = z.infer<typeof herCardSchema>;

export const herCardResponseSchema = {
  type: "object",
  properties: {
    level: {
      type: "integer",
      description:
        "Dificultad de la chica de 1 a 99 como nivel de personaje. Combina exigencia, " +
        "juego, riesgo y lo lejos que esta la escalada. 40 es normal, 80+ es muy dificil.",
    },
    tagline: {
      type: "string",
      description: "Frase de una linea que la describe como personaje. Concreta, sacada del hilo.",
    },
    stats: {
      type: "array",
      description:
        "Exactamente 6 stats, una por clave en este orden: AFE (afecto: cuanta calidez y " +
        "receptividad muestra), EXI (exigencia: cuanto pide y cuanto espera que se resuelva), " +
        "INI (iniciativa: cuanto propone y escribe primero), JUE (juego: shit tests, coqueteo, " +
        "retirarse), RIE (riesgo transaccional: uso instrumental, dinero, favores), RIT (ritmo: " +
        "velocidad y constancia de respuesta). 0-100.",
      items: {
        type: "object",
        properties: {
          key: { type: "string", enum: ["AFE", "EXI", "INI", "JUE", "RIE", "RIT"] },
          value: { type: "integer" },
          hint: { type: "string", description: "Una frase con la evidencia que sostiene el valor." },
        },
        required: ["key", "value", "hint"],
      },
    },
    likes: {
      type: "array",
      items: { type: "string" },
      description:
        "Que le gusta: temas, gestos, tonos y planes a los que responde bien. Maximo 5, " +
        "cada uno de pocas palabras. Solo con evidencia; si no hay, lista vacia.",
    },
    avoid: {
      type: "array",
      items: { type: "string" },
      description:
        "Que evitar con ella: movimientos del usuario que la enfrian o le dan poder. " +
        "Maximo 5, pocas palabras.",
    },
    hates: {
      type: "array",
      items: { type: "string" },
      description: "Que odia o le molesta abiertamente segun el hilo. Maximo 5, pocas palabras.",
    },
    winConditions: {
      type: "array",
      items: { type: "string" },
      description:
        "Como se gana con ella: 2-4 condiciones de victoria concretas (marco, ritmo, plan). " +
        "Ordenadas por impacto.",
    },
    specialMove: {
      type: "object",
      nullable: true,
      description:
        "Su jugada tipica: el patron con el que testea o tira del usuario (ej. silencio " +
        "estrategico, pedir favores, celos). Nombre corto en mayusculas y descripcion.",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
      },
      required: ["name", "description"],
    },
    confidence: {
      type: "number",
      description: "0-1. Cuanta evidencia real hay detras de esta ficha.",
    },
  },
  required: ["level", "tagline", "stats", "likes", "avoid", "hates", "winConditions", "specialMove", "confidence"],
} as const;
