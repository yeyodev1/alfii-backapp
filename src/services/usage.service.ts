import { AiUsageModel } from "../models/aiUsage.model";
import { costUsd } from "./ai/pricing";

/**
 * Registro de consumo de IA. Fire-and-forget SIEMPRE: la contabilidad jamas
 * puede tumbar ni retrasar la respuesta que el usuario esta esperando. Si
 * falla, se pierde un registro y se loguea; el turno sigue.
 */
export function recordAiUsage(input: {
  userId?: string | null;
  provider: string;
  model: string;
  task: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number;
  estimated?: boolean;
}): void {
  const inputTokens = Math.max(0, Math.round(input.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.round(input.outputTokens ?? 0));

  void AiUsageModel.create({
    userId: input.userId || undefined,
    provider: input.provider,
    aiModel: input.model,
    task: input.task,
    inputTokens,
    outputTokens,
    costUsd: costUsd(input.model, inputTokens, outputTokens),
    latencyMs: input.latencyMs,
    estimated: input.estimated ?? false,
  }).catch((error) => {
    console.warn(`[alfii:usage] no se pudo registrar consumo: ${error?.message}`);
  });
}
