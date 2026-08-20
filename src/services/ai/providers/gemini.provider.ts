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
          maxOutputTokens: call.maxOutputTokens ?? 2400,
          safetySettings: SAFETY_SETTINGS,
          // Los tokens de razonamiento descuentan de maxOutputTokens. Sin este
          // tope el modelo pensaba ~1000 tokens y el texto visible se cortaba
          // a mitad de palabra por MAX_TOKENS (sin error, solo finishReason).
          thinkingConfig: { thinkingBudget: call.thinkingBudget ?? 256 },
        },
      });
    } catch (error: any) {
      throw new ProviderError("gemini", error?.message ?? "fallo de red", "network", error);
    }

    let emitted = false;
    let finishReason: string | undefined;
    let blockReason: string | undefined;
    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) finishReason = String(candidate.finishReason);
      if (chunk.promptFeedback?.blockReason) blockReason = String(chunk.promptFeedback.blockReason);
      if (chunk.text) {
        emitted = true;
        yield chunk.text;
      }
    }

    // El stream de Gemini termina "limpio" aunque haya cortado por safety o
    // por limite: solo lo dice en finishReason. Hay que hacerlo explicito.
    if (!emitted) {
      throw new ProviderError(
        "gemini",
        `stream vacio (${blockReason ?? finishReason ?? "sin motivo"})`,
        "blocked",
        { finishReason, blockReason }
      );
    }
    if (finishReason && finishReason !== "STOP") {
      if (finishReason === "MAX_TOKENS") {
        console.warn(`[alfii:ai] gemini/${model} corto por MAX_TOKENS en stream ${call.task}`);
      } else {
        throw new ProviderError("gemini", `stream cortado por ${finishReason}`, "blocked", { finishReason });
      }
    }
  },
};
