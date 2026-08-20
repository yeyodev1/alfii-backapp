import OpenAI, { toFile } from "openai";
import { env } from "../config/env";
import { genai, SAFETY_SETTINGS } from "./ai/gemini.client";
import { AiUsageModel } from "../models/aiUsage.model";
import { CustomError } from "../errors/customError.error";
import { logMetrics } from "../utils/redact";

/**
 * Transcripcion de notas de voz (WhatsApp .opus/.ogg, m4a, mp3, wav, webm).
 *
 * Solo transcribe: no analiza ni opina. El audio vive en memoria y muere con
 * la peticion (misma promesa que las capturas). Lo que se persiste es el
 * texto, como mensaje del usuario en el hilo, para que Alfii lo tenga en
 * contexto cuando el usuario pregunte por el.
 *
 * Proveedor: OpenAI (gpt-4o-mini-transcribe) si hay key; si no, Gemini con el
 * audio inline. El texto literal es lo unico que importa: temperatura 0.
 */

export interface TranscriptionResult {
  text: string;
  provider: "openai" | "gemini";
  model: string;
  latencyMs: number;
}

const OPENAI_MODEL = "gpt-4o-mini-transcribe";
const GEMINI_MODEL = "gemini-2.5-flash";

/** Precio aproximado por minuto de audio (USD). Solo para el panel de gasto. */
const USD_PER_MINUTE: Record<string, number> = {
  [OPENAI_MODEL]: 0.003,
  [GEMINI_MODEL]: 0.001,
};

/** Estimacion de duracion por tamaño: opus de WhatsApp ~ 1.6 KB/s. */
function estimateMinutes(bytes: number, mimetype: string): number {
  const kbps = /ogg|opus/.test(mimetype) ? 1.6 : /m4a|mp4|aac/.test(mimetype) ? 8 : /wav/.test(mimetype) ? 176 : 16;
  return bytes / 1024 / kbps / 60;
}

function normalizeMime(mimetype: string, filename: string): string {
  if (mimetype && mimetype !== "application/octet-stream") return mimetype;
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    opus: "audio/ogg",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    aac: "audio/aac",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    webm: "audio/webm",
    flac: "audio/flac",
  };
  return map[ext] || "audio/ogg";
}

async function withOpenAI(buffer: Buffer, mimetype: string, filename: string): Promise<TranscriptionResult> {
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  // OpenAI decide el decoder por la extension del nombre: un .opus de WhatsApp
  // es un contenedor ogg, y asi se le presenta.
  const safeName = /\.opus$/i.test(filename) ? filename.replace(/\.opus$/i, ".ogg") : filename || "audio.ogg";
  const started = Date.now();
  const res = await client.audio.transcriptions.create({
    file: await toFile(buffer, safeName, { type: mimetype }),
    model: OPENAI_MODEL,
    language: "es",
    temperature: 0,
    response_format: "json",
  });
  return { text: (res.text || "").trim(), provider: "openai", model: OPENAI_MODEL, latencyMs: Date.now() - started };
}

async function withGemini(buffer: Buffer, mimetype: string): Promise<TranscriptionResult> {
  const started = Date.now();
  const res = await genai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: mimetype, data: buffer.toString("base64") } },
          {
            text:
              "Transcribe este audio de forma LITERAL, en el idioma en que se habla. " +
              "Devuelve solo la transcripcion, sin comillas, sin comentarios, sin etiquetas. " +
              "Si hay partes inaudibles escribe [inaudible].",
          },
        ],
      },
    ],
    config: { temperature: 0, safetySettings: SAFETY_SETTINGS },
  });
  return { text: (res.text || "").trim(), provider: "gemini", model: GEMINI_MODEL, latencyMs: Date.now() - started };
}

export async function transcribeAudio(input: {
  buffer: Buffer;
  mimetype: string;
  filename: string;
  userId?: string;
}): Promise<TranscriptionResult> {
  const mimetype = normalizeMime(input.mimetype, input.filename);
  const canOpenAI = !!env.OPENAI_API_KEY && !env.OPENAI_API_KEY.startsWith("sk-admin-");
  const canGemini = !!env.GEMINI_API_KEY;
  if (!canOpenAI && !canGemini) {
    throw new CustomError("La transcripcion no esta configurada en este entorno.", 503);
  }

  let result: TranscriptionResult;
  try {
    result = canOpenAI ? await withOpenAI(input.buffer, mimetype, input.filename) : await withGemini(input.buffer, mimetype);
  } catch (err) {
    if (canOpenAI && canGemini) {
      logMetrics("transcribe.failover", { provider: "openai", failedOver: [(err as Error).message?.slice(0, 120) || "error"] });
      result = await withGemini(input.buffer, mimetype);
    } else {
      throw new CustomError("No pude transcribir ese audio. Prueba con otro formato (opus, m4a, mp3).", 502);
    }
  }

  if (!result.text) {
    throw new CustomError("El audio no tiene voz reconocible o esta vacio.", 422);
  }

  const minutes = estimateMinutes(input.buffer.length, mimetype);
  void AiUsageModel.create({
    userId: input.userId,
    provider: result.provider,
    aiModel: result.model,
    task: "transcribe",
    inputTokens: 0,
    outputTokens: Math.ceil(result.text.length / 4),
    costUsd: minutes * (USD_PER_MINUTE[result.model] ?? 0.003),
    latencyMs: result.latencyMs,
    estimated: true,
  }).catch(() => null);

  logMetrics("transcribe.done", {
    provider: result.provider,
    model: result.model,
    outputTokens: Math.ceil(result.text.length / 4),
    latencyMs: result.latencyMs,
  });

  return result;
}
