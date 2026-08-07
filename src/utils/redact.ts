import { isProduction } from "../config/env";

/**
 * Logging que nunca imprime contenido de conversaciones.
 *
 * Esto no es higiene opcional: el descargo legal declara que no leemos el
 * contenido del usuario. Si los logs lo imprimen, el documento se vuelve
 * prueba en contra. Solo se registran metricas y forma, jamas texto.
 */
const SENSITIVE_KEYS = new Set([
  "content",
  "text",
  "reply",
  "message",
  "thread",
  "extractedThread",
  "reading",
  "scripts",
  "payload",
  "summary",
  "contextSummary",
  "transcript",
  "password",
  "passwordHash",
  "email",
  "displayName",
  "preferredName",
  "detectedName",
  "raw",
]);

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return `[str:${value.length}]`;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return `[array:${value.length}]`;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key) ? "[redacted]" : redact(val, depth + 1);
    }
    return out;
  }

  return "[unknown]";
}

export function logEvent(event: string, meta: Record<string, unknown> = {}) {
  const safe = isProduction ? redact(meta) : meta;
  console.log(`[alfii] ${event}`, JSON.stringify(safe));
}

export function logMetrics(
  event: string,
  meta: {
    model?: string;
    /** Quien atendio la llamada y desde donde se hizo failover. Sin esto, una
     *  degradacion silenciosa de Gemini a OpenAI no aparece en ningun lado. */
    provider?: string;
    failedOver?: string[];
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
    repaired?: boolean;
    contextTokens?: number;
    dropped?: string[];
  }
) {
  // Sin medicion por turno, en dos semanas no sabes por que subio la factura.
  console.log(`[alfii:ai] ${event}`, JSON.stringify(meta));
}
