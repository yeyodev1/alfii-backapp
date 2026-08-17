import { genai, geminiModelFor, SAFETY_SETTINGS } from "../gemini.client";
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

function toGeminiParts(parts: AiPart[]) {
  return parts.map((part) =>
    isImagePart(part)
      ? { inlineData: { mimeType: part.image.mimeType, data: part.image.base64 } }
      : { text: part.text }
  );
}

/**
 * Proveedor primario por costo. Conserva los dos ajustes que este dominio
 * necesita y que no son negociables: umbrales de seguridad relajados en las
 * categorias que producen falsos positivos, y presupuesto de razonamiento
 * acotado para que el analisis no tarde 48 segundos en un movil.
 */
export const geminiProvider: AiProvider = {
  name: "gemini",
  supportsVision: true,

  isConfigured() {
    return !!env.GEMINI_API_KEY;
  },

  modelFor(task: AiTask): string {
    return geminiModelFor(task);
  },

  async completeJson(call: JsonCall): Promise<RawCompletion> {
    const model = this.modelFor(call.task);

    let response;
    try {
      response = await genai.models.generateContent({
        model,
        contents: [{ role: "user", parts: toGeminiParts(call.parts) }],
        config: {
          systemInstruction: call.system,
          responseMimeType: "application/json",
          responseSchema: call.jsonSchema as any,
          temperature: call.temperature ?? 0.85,
          maxOutputTokens: call.maxOutputTokens ?? 4096,
          safetySettings: SAFETY_SETTINGS,
          thinkingConfig: { thinkingBudget: call.thinkingBudget ?? 256 },
        },
      });
    } catch (error: any) {
      throw new ProviderError("gemini", error?.message ?? "fallo de red", "network", error);
    }

    if (!response.text) {
      // Respuesta vacia = filtro de seguridad. Es recuperable: el gateway
      // reintenta con reencuadre clinico y, si insiste, cambia de proveedor.
      throw new ProviderError("gemini", "respuesta bloqueada por safety", "blocked", {
        feedback: response.promptFeedback,
      });
    }

    return {
      text: response.text,
      model,
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    };
  },

  async *streamText(call: StreamCall): AsyncGenerator<string> {
    const model = this.modelFor(call.task);

    let stream;
    try {
      stream = await genai.models.generateContentStream({
        model,
        contents: [{ role: "user", parts: toGeminiParts(call.parts) }],
        config: {
          systemInstruction: call.system,
          temperature: call.temperature ?? 0.9,
          maxOutputTokens: call.maxOutputTokens ?? 1600,
          safetySettings: SAFETY_SETTINGS,
        },
      });
    } catch (error: any) {
      throw new ProviderError("gemini", error?.message ?? "fallo de red", "network", error);
    }

    for await (const chunk of stream) {
      if (chunk.text) yield chunk.text;
    }
  },
};
