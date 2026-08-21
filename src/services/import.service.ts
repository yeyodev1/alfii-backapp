import { z } from "zod";
import { generateStructured } from "./ai/structured";
import { parseWhatsAppExport, type ParsedChat, type ParsedMessage } from "../utils/whatsappParser";
import type { VisionExtraction } from "../schemas/vision.schema";
import { CustomError } from "../errors/customError.error";

/**
 * Import del export .txt de WhatsApp.
 *
 * Flujo stateless: el texto crudo viaja, se parsea y muere en la request.
 * Solo persisten dos cosas: los ultimos RECENT_WINDOW mensajes como hilo del
 * analisis, y un resumen (map-reduce) de todo lo anterior. Es la misma
 * promesa de privacidad que memoryStorage en las capturas.
 */

/** Cuantos mensajes recientes entran literales al analisis (mismo tope que el
 *  schema de vision: .max(80)). */
export const RECENT_WINDOW = 80;
/** Tamano de cada chunk que se resume por separado. */
const CHUNK_SIZE = 300;
/** Tope de chunks a resumir: 6 x ~300 mensajes. Mas alla, lo mas viejo se
 *  descarta para no chocar con los timeouts de serverless. */
const MAX_CHUNKS = 6;
/** El resumen final debe caber comodo dentro del presupuesto de 12k tokens. */
const SUMMARY_MAX_CHARS = 4000;

const summarySchema = z.object({ summary: z.string().min(1).max(6000) });

const summaryResponseSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "El resumen pedido, en espanol, sin encabezados ni markdown.",
    },
  },
  required: ["summary"],
} as const;

const CHUNK_SUMMARIZER = `Resumes un tramo de una conversacion real de WhatsApp entre EL (el usuario) y ELLA.

Conserva SOLO lo que sirve para asesorar la relacion: hechos concretos (citas,
encuentros, conflictos, promesas), cambios de tono o interes de ELLA, patrones
de quien inicia y quien persigue, senales de alerta, temas recurrentes y fechas
aproximadas si se deducen. Cita alguna frase literal corta si es reveladora.

Prosa compacta en espanol, sin listas ni encabezados. Maximo 900 caracteres.
No inventes nada que no este en el texto. No des consejos: solo resume.`;

const FINAL_SUMMARIZER = `Recibes resumenes parciales y cronologicos de la MISMA conversacion de WhatsApp entre EL (el usuario) y ELLA.

Fusionalos en UN solo resumen cronologico coherente: como empezo, como
evoluciono el interes de ella, hechos clave (citas, encuentros, conflictos),
patrones de conducta de ambos y estado actual del vinculo. Conserva fechas
aproximadas y alguna cita literal si la hay.

Prosa compacta en espanol, sin listas ni encabezados. Maximo 3800 caracteres.
No inventes ni des consejos: solo el resumen fusionado.`;

export interface ImportedHistory {
  summary: string;
  messageCount: number;
  firstMessageAt?: Date;
  lastMessageAt?: Date;
}

/** Parsea y valida el export. Corta con 422 si no es un chat 1 a 1 legible. */
export function parseExportOrThrow(rawText: string): ParsedChat {
  const parsed = parseWhatsAppExport(rawText);

  if (parsed.messages.length < 2) {
    throw new CustomError(
      "No pude leer esa conversacion. Exporta el chat desde WhatsApp con " +
        "\"Exportar chat > Sin archivos\" o pega el texto tal cual.",
      422,
      { reason: "unreadable_export" }
    );
  }

  if (parsed.participants.length > 2) {
    throw new CustomError(
      "Ese archivo es de un grupo. Solo puedo analizar chats de dos personas.",
      422,
      { reason: "group_chat", participants: parsed.participants }
    );
  }

  return parsed;
}

/** Valida que el nombre elegido este en el chat y devuelve el mapeo listo. */
export function requireHer(parsed: ParsedChat, herName: string): string {
  const match = parsed.participants.find(
    (p) => p.trim().toLowerCase() === herName.trim().toLowerCase()
  );
  if (!match) {
    throw new CustomError("Ese nombre no aparece en la conversacion.", 400, {
      reason: "unknown_participant",
      participants: parsed.participants,
    });
  }
  return match;
}

/**
 * Convierte los ultimos RECENT_WINDOW mensajes al mismo contrato que produce
 * el extractor de vision: runAnalysis no distingue de donde vino el hilo.
 */
export function buildExtractionFromParsed(parsed: ParsedChat, herName: string): VisionExtraction {
  const her = requireHer(parsed, herName);
  const recent = parsed.messages.slice(-RECENT_WINDOW);

  const fmtTime = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const fmtDay = (d: Date) => d.toISOString().slice(0, 10);
  let lastDay = "";
  const days = new Set<string>();
  const thread = recent.map((m) => {
    const day = m.at ? fmtDay(m.at) : "";
    const dateLabel = day && day !== lastDay ? day : null;
    if (day) { lastDay = day; days.add(day); }
    return {
      speaker: m.sender === her ? ("her" as const) : ("him" as const),
      text: m.text.slice(0, 1200),
      timestamp: m.at ? fmtTime(m.at) : null,
      dateLabel,
    };
  });
  return {
    readable: true,
    issue: null,
    detectedName: her,
    platform: "whatsapp",
    confidence: 1,
    thread,
    timeline: {
      hasTimes: thread.some((t) => !!t.timestamp),
      daySeparators: [...days],
      spansMultipleDays: days.size > 1,
      note: null,
    },
  };
}

function chunkToText(chunk: ParsedMessage[], her: string): string {
  return chunk
    .map((m) => `${m.sender === her ? "ELLA" : "EL"}: ${m.text.replace(/\n/g, " ").slice(0, 500)}`)
    .join("\n");
}

async function summarizeChunk(text: string, userId?: string): Promise<string> {
  const result = await generateStructured({
    task: "chat",
    system: CHUNK_SUMMARIZER,
    parts: [{ text }],
    jsonSchema: summaryResponseSchema,
    validator: summarySchema,
    temperature: 0.3,
    maxOutputTokens: 800,
    attribution: { userId },
  });
  return result.data.summary;
}

/**
 * Resume todo lo anterior a la ventana reciente. Devuelve null si el chat
 * entero cabe en la ventana (no hay nada que resumir).
 *
 * Map-reduce: chunks en paralelo con la task barata, un reduce final. Si un
 * chunk falla, se omite y el resto sigue: un resumen con un hueco es mejor que
 * ningun resumen despues de que el usuario espero el analisis.
 */
export async function summarizeHistory(
  parsed: ParsedChat,
  herName: string,
  userId?: string
): Promise<ImportedHistory | null> {
  const her = requireHer(parsed, herName);
  const older = parsed.messages.slice(0, -RECENT_WINDOW);
  if (!older.length) return null;

  const chunks: ParsedMessage[][] = [];
  for (let i = 0; i < older.length; i += CHUNK_SIZE) {
    chunks.push(older.slice(i, i + CHUNK_SIZE));
  }
  // Se conservan los chunks MAS RECIENTES: si el chat es enorme, lo que se
  // pierde es el pasado remoto, no el contexto que explica el presente.
  const kept = chunks.slice(-MAX_CHUNKS);
  const droppedMessages = older.length - kept.reduce((sum, c) => sum + c.length, 0);

  const partials = (
    await Promise.all(
      kept.map((chunk) =>
        summarizeChunk(chunkToText(chunk, her), userId).catch(() => null)
      )
    )
  ).filter((s): s is string => !!s);

  if (!partials.length) return null;

  let summary: string;
  if (partials.length === 1) {
    summary = partials[0]!;
  } else {
    try {
      const result = await generateStructured({
        task: "chat",
        system: FINAL_SUMMARIZER,
        parts: [{ text: partials.map((p, i) => `--- Tramo ${i + 1} ---\n${p}`).join("\n\n") }],
        jsonSchema: summaryResponseSchema,
        validator: summarySchema,
        temperature: 0.3,
        maxOutputTokens: 1600,
        attribution: { userId },
      });
      summary = result.data.summary;
    } catch {
      // El reduce fallo: concatenar los parciales conserva la informacion
      summary = partials.join(" ");
    }
  }

  if (droppedMessages > 0) {
    summary = `(Los ${droppedMessages} mensajes mas antiguos no entraron al resumen.) ${summary}`;
  }

  const timestamps = parsed.messages.map((m) => m.at).filter((d): d is Date => !!d);

  return {
    summary: summary.slice(0, SUMMARY_MAX_CHARS),
    messageCount: parsed.messages.length,
    firstMessageAt: timestamps[0],
    lastMessageAt: timestamps[timestamps.length - 1],
  };
}

/**
 * Brief del chat completo para el prompt de analisis.
 *
 * Un export entero no es una captura: el modelo tiene que leer la dinamica
 * global (quien inicia, como se movio el interes, que paso antes de la ventana
 * reciente) y no solo el ultimo mensaje. Este bloque se antepone a los ultimos
 * RECENT_WINDOW mensajes literales y cambia la consigna.
 */
export function buildImportBrief(
  parsed: ParsedChat,
  herName: string,
  imported: ImportedHistory | null
): string {
  const her = requireHer(parsed, herName);
  const total = parsed.stats.total;
  const herCount = parsed.stats.byParticipant[her] ?? 0;
  const hisCount = total - herCount;
  const first = parsed.messages[0]?.at;
  const last = parsed.messages[parsed.messages.length - 1]?.at;
  const fmt = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : "?");

  // Quien abre conversacion tras un silencio largo (> 12h): señal barata y
  // muy informativa de quien persigue a quien.
  let herOpens = 0;
  let hisOpens = 0;
  for (let i = 1; i < parsed.messages.length; i++) {
    const prev = parsed.messages[i - 1]!;
    const cur = parsed.messages[i]!;
    if (!prev.at || !cur.at) continue;
    if (cur.at.getTime() - prev.at.getTime() > 12 * 3600 * 1000) {
      if (cur.sender === her) herOpens++;
      else hisOpens++;
    }
  }

  const recent = Math.min(RECENT_WINDOW, total);
  const lines = [
    `=== CONVERSACION COMPLETA DE WHATSAPP IMPORTADA ===`,
    `Total: ${total} mensajes (ELLA ${herCount} / EL ${hisCount}) entre ${fmt(first)} y ${fmt(last)}.`,
    `Reinicios de conversacion tras >12h de silencio: ELLA ${herOpens} / EL ${hisOpens}.`,
    `Abajo van los ultimos ${recent} mensajes LITERALES.`,
  ];
  if (imported) {
    lines.push(
      ``,
      `--- RESUMEN DE LO ANTERIOR (${imported.messageCount} mensajes previos a la ventana literal) ---`,
      imported.summary
    );
  }
  return lines.join("\n");
}
