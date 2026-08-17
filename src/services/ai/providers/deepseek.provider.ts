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
  if (!client) {
    client = new OpenAI({ apiKey: env.DEEPSEEK_API_KEY, baseURL: env.DEEPSEEK_BASE_URL });
  }
  return client;
}

import { activeModel } from "../../modelConfig.service";

function toMessages(system: string, parts: AiPart[]) {
  const text = parts
    .filter((p) => !isImagePart(p))
    .map((p) => (p as { text: string }).text)
    .join("\n\n");

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: text },
  ];
}

/**
 * Razonamiento interno: APAGADO por defecto.
 *
 * DeepSeek v4 razona por defecto y ese razonamiento consume del mismo
 * presupuesto que `max_tokens`. Con los limites ajustados de este proyecto (el
 * extractor de estado usa 700, el saludo 400) el modelo gastaria el presupuesto
 * pensando y devolveria contenido VACIO. Medido: con thinking activo el primer
 * token de texto tarda ~2.6s; apagado, ~0.9s.
 *
 * Se puede reactivar con DEEPSEEK_THINKING=true, pero entonces hay que subir los
 * maxOutputTokens de cada llamada.
 */
const THINKING_EXTRA = env.DEEPSEEK_THINKING
  ? { thinking: { type: "enabled" } }
  : { thinking: { type: "disabled" } };

/**
 * DeepSeek via API compatible con OpenAI. Solo texto: util para conversacion y
 * para analisis sobre hilos ya extraidos, no para leer capturas.
 */
export const deepseekProvider: AiProvider = {
  name: "deepseek",
  supportsVision: false,

  isConfigured() {
    return !!env.DEEPSEEK_API_KEY;
  },

  modelFor(task: AiTask): string {
    // Runtime (portal admin) con env de fallback. El alias vision->analysis
    // vive en modelConfig.service: DeepSeek nunca recibe tareas de vision.
    return activeModel("deepseek", task);
  },

  async completeJson(call: JsonCall): Promise<RawCompletion> {
    const model = this.modelFor(call.task);

    try {
      const messages = toMessages(
        `${call.system}\n\n` +
          `Responde EXCLUSIVAMENTE con un objeto JSON valido que cumpla este schema:\n` +
          `${JSON.stringify(call.jsonSchema)}`,
        call.parts
      );

      const response = await getClient().chat.completions.create({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature: call.temperature ?? 0.85,
        max_tokens: call.maxOutputTokens ?? 4096,
        ...THINKING_EXTRA,
      } as any);

      const text = response.choices[0]?.message?.content;
      if (!text) throw new ProviderError("deepseek", "respuesta vacia", "blocked");

      return {
        text,
        model,
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
      };
    } catch (error: any) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("deepseek", error?.message ?? "fallo de red", "network", error);
    }
  },

  async *streamText(call: StreamCall): AsyncGenerator<string> {
    const model = this.modelFor(call.task);

    let stream: AsyncIterable<any>;
    try {
      // `thinking` no esta en los tipos del SDK de OpenAI (es extension de
      // DeepSeek), de ahi el cast del parametro.
      stream = (await getClient().chat.completions.create({
        model,
        messages: toMessages(call.system, call.parts),
        temperature: call.temperature ?? 0.9,
        max_tokens: call.maxOutputTokens ?? 1600,
        stream: true,
        ...THINKING_EXTRA,
      } as any)) as unknown as AsyncIterable<any>;
    } catch (error: any) {
      throw new ProviderError("deepseek", error?.message ?? "fallo de red", "network", error);
    }

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  },
};
