import OpenAI from "openai";
import { env } from "../../../config/env";
import {
  ProviderError,
  isImagePart,
  type AiPart,
  type AiProvider,
  type AiTask,
  type JsonCall,
  type RawCompletion,
  type StreamCall,
} from "../types";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return client;
}

const OPENAI_MODELS: Record<AiTask, string> = {
  vision: env.OPENAI_MODEL_VISION,
  chat: env.OPENAI_MODEL_CHAT,
  analysis: env.OPENAI_MODEL_ANALYSIS,
};

function toOpenAiContent(parts: AiPart[]) {
  return parts.map((part) =>
    isImagePart(part)
      ? {
          type: "input_image" as const,
          image_url: `data:${part.image.mimeType};base64,${part.image.base64}`,
          detail: "high" as const,
        }
      : { type: "input_text" as const, text: part.text }
  );
}

/**
 * La familia gpt-5.5 en adelante rechaza `temperature` con 400. Enviarlo
 * "por si acaso" rompe la llamada entera, asi que se omite para esos modelos en
 * vez de descubrirlo en produccion el dia que Gemini se caiga.
 */
function supportsTemperature(model: string): boolean {
  const match = /^gpt-(\d+)(?:\.(\d+))?/.exec(model);
  if (!match) return true;

  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  if (major > 5) return false;
  return !(major === 5 && minor >= 5);
}

function classify(error: any): "auth" | "network" | "unknown" {
  const status = error?.status ?? error?.response?.status;
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || (typeof status === "number" && status >= 500)) return "network";
  return "unknown";
}

/**
 * Proveedor de respaldo (Responses API con SSE).
 *
 * Se usa JSON mode en vez de structured outputs estrictos a proposito: los
 * schemas de este proyecto vienen en forma Gemini (con `nullable`), que el modo
 * estricto de OpenAI rechaza. Traducirlos duplicaria la fuente de verdad del
 * contrato. La validacion real la hace zod en el gateway, que ademas ya tiene
 * un ciclo de reparacion.
 */
export const openaiProvider: AiProvider = {
  name: "openai",
  supportsVision: true,

  isConfigured() {
    return !!env.OPENAI_API_KEY;
  },

  modelFor(task: AiTask): string {
    return OPENAI_MODELS[task];
  },

  async completeJson(call: JsonCall): Promise<RawCompletion> {
    const model = this.modelFor(call.task);

    try {
      const response = await getClient().responses.create({
        model,
        instructions: call.system,
        input: [
          {
            role: "user",
            content: [
              ...toOpenAiContent(call.parts),
              {
                // El modo json_object exige literalmente la palabra "json" en el
                // INPUT, no basta con tenerla en instructions: si falta, la API
                // responde 400. Por eso el schema viaja aqui y no arriba.
                type: "input_text" as const,
                text:
                  `Responde EXCLUSIVAMENTE con un objeto JSON valido, sin texto ` +
                  `adicional, que cumpla este schema JSON:\n${JSON.stringify(call.jsonSchema)}`,
              },
            ],
          },
        ],
        text: { format: { type: "json_object" } },
        ...(supportsTemperature(model) ? { temperature: call.temperature ?? 0.85 } : {}),
        max_output_tokens: call.maxOutputTokens ?? 4096,
      });

      const text = response.output_text;
      if (!text) {
        throw new ProviderError("openai", "respuesta vacia", "blocked", {
          status: response.status,
        });
      }

      return {
        text,
        model,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      };
    } catch (error: any) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("openai", error?.message ?? "fallo de red", classify(error), error);
    }
  },

  async *streamText(call: StreamCall): AsyncGenerator<string> {
    const model = this.modelFor(call.task);

    let stream;
    try {
      stream = await getClient().responses.create({
        model,
        instructions: call.system,
        input: [{ role: "user", content: toOpenAiContent(call.parts) }],
        ...(supportsTemperature(model) ? { temperature: call.temperature ?? 0.9 } : {}),
        max_output_tokens: call.maxOutputTokens ?? 1600,
        stream: true,
      });
    } catch (error: any) {
      throw new ProviderError("openai", error?.message ?? "fallo de red", classify(error), error);
    }

    for await (const event of stream as any) {
      // El stream trae eventos de ciclo de vida ademas de texto; solo interesan
      // los deltas de salida.
      if (event.type === "response.output_text.delta" && event.delta) {
        yield event.delta as string;
      }
      if (event.type === "response.failed" || event.type === "error") {
        throw new ProviderError(
          "openai",
          event.response?.error?.message ?? "stream interrumpido",
          "unknown",
          event
        );
      }
    }
  },
};
