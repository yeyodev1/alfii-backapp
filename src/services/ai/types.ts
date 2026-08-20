import type { ZodType } from "zod";

/**
 * Contrato comun de proveedores de modelo.
 *
 * El resto del sistema (chat, analisis, vision, onboarding) no sabe que
 * proveedor lo esta atendiendo: pide una TAREA y el gateway decide. Eso es lo
 * que permite alternar Gemini <-> OpenAI sin que el usuario lo note y sin
 * tocar la memoria del agente.
 */

export type AiTask = "vision" | "chat" | "analysis";

/** Parte de entrada, independiente de proveedor. */
export type AiPart =
  | { text: string }
  | { image: { mimeType: string; base64: string } };

export function isImagePart(part: AiPart): part is { image: { mimeType: string; base64: string } } {
  return "image" in part;
}

export interface JsonCall {
  task: AiTask;
  system: string;
  parts: AiPart[];
  /** Schema en forma Gemini (type/properties/nullable). El proveedor lo adapta
   *  a su propio formato o lo inyecta como instruccion. */
  jsonSchema: unknown;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
}

export interface StreamCall {
  task: AiTask;
  system: string;
  parts: AiPart[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Presupuesto de razonamiento interno (Gemini). Comparte limite con
   *  maxOutputTokens: sin tope, el modelo se lo gasta pensando y la respuesta
   *  visible sale cortada a mitad de frase. */
  thinkingBudget?: number;
}

export interface RawCompletion {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AiProvider {
  readonly name: ProviderName;
  readonly supportsVision: boolean;
  isConfigured(): boolean;
  modelFor(task: AiTask): string;
  completeJson(call: JsonCall): Promise<RawCompletion>;
  streamText(call: StreamCall): AsyncGenerator<string>;
}

export type ProviderName = "gemini" | "openai" | "deepseek";

/** Error de proveedor recuperable: el gateway lo captura y pasa al siguiente. */
export class ProviderError extends Error {
  constructor(
    public provider: ProviderName,
    message: string,
    public reason: "blocked" | "network" | "auth" | "unknown" = "unknown",
    public cause?: unknown
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface StructuredRequest<T> extends Omit<JsonCall, "jsonSchema"> {
  jsonSchema: unknown;
  validator: ZodType<T>;
  /** A quien se le atribuye el gasto de esta llamada. Sin esto la llamada se
   *  registra igual, pero sin usuario: aparece en el total y no en su ficha. */
  attribution?: { userId?: string | null };
}

export interface StructuredResult<T> {
  data: T;
  provider: ProviderName;
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  repaired: boolean;
  /** Proveedores que fallaron antes de este. Sirve para detectar degradacion
   *  silenciosa: si Gemini falla el 40% de los turnos, esto lo hace visible. */
  failedOver: ProviderName[];
}
