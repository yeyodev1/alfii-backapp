import { Types } from "mongoose";
import { generateStructured } from "./ai/structured";
import { BUNKER_SYSTEM, PROMPT_VERSION } from "../prompts/bunker.system";
import {
  analysisPayloadSchema,
  analysisResponseSchema,
  type AnalysisPayload,
} from "../schemas/analysis.schema";
import { assembleContext } from "./context.service";
import { applyStateUpdate } from "./state.service";
import { maybeCompact } from "./compaction.service";
import { detectCrisis } from "./crisis.service";
import { AnalysisModel, IAnalysis } from "../models/analysis.model";
import { MessageModel, type IMessageImage } from "../models/message.model";
import { TargetModel, ITarget } from "../models/target.model";
import { UserModel, IUser } from "../models/user.model";
import { PowerProfileModel } from "../models/powerProfile.model";
import { threadToText, timelineBrief } from "./vision.service";
import { personaDirective } from "../prompts/personas";
import type { VisionExtraction } from "../schemas/vision.schema";
import { logMetrics } from "../utils/redact";
import { CustomError } from "../errors/customError.error";

export interface RunAnalysisInput {
  user: IUser;
  target?: ITarget | null;
  extraction: VisionExtraction;
  sourceType?: "screenshot" | "text";
  /** Referencia a la captura ya subida. Si viene, se ancla al hilo como mensaje
   *  del usuario para que el expediente conserve la conversacion original. */
  image?: IMessageImage | null;
  /** Brief del chat completo (import de WhatsApp). Si viene, el analisis deja
   *  de ser "el ultimo mensaje de una captura" y pasa a leer la dinamica
   *  global: estadisticas + resumen de lo viejo + ventana literal. */
  importBrief?: string | null;
  /** Pregunta o contexto que el usuario escribio al subir la captura. */
  userNote?: string | null;
}

export interface RunAnalysisResult {
  analysis: IAnalysis;
  payload: AnalysisPayload;
  crisis?: ReturnType<typeof detectCrisis>;
}

/**
 * Ejecuta el analisis de los 6 bloques.
 *
 * El contexto se ensambla con las 7 capas; si hay expediente, el analisis
 * numero 12 es sustancialmente mejor que el numero 1 porque el dossier ya
 * contiene arquetipo, patron de timing y que scripts fallaron.
 */
export async function runAnalysis(input: RunAnalysisInput): Promise<RunAnalysisResult> {
  const threadText = threadToText(input.extraction.thread);

  // Capa local de crisis: corta ANTES de gastar una llamada al modelo.
  const crisis = detectCrisis(threadText);
  if (crisis.detected && crisis.blocksAdvice) {
    throw new CustomError(crisis.response, 451, {
      reason: "crisis",
      kind: crisis.kind,
      resources: crisis.resources,
    });
  }

  const profile = await PowerProfileModel.findOne({ userId: input.user._id });

  const context = await assembleContext({
    user: input.user,
    profile,
    target: input.target,
    includeThreads: !!input.target,
    includeHistory: !!input.target,
  });

  const header = input.importBrief
    ? `${input.importBrief}\n\n` +
      `=== ULTIMOS MENSAJES (LITERALES) ===\n` +
      `Plataforma: ${input.extraction.platform}\n` +
      (input.extraction.detectedName ? `Ella: ${input.extraction.detectedName}\n` : "") +
      `\n${threadText}\n\n` +
      `Tienes la conversacion COMPLETA, no una captura. Analiza la dinamica global: ` +
      `quien inicia y quien cierra, como evoluciono el interes de ella desde el principio ` +
      `hasta hoy, patrones que se repiten, el punto de inflexion si lo hubo, y recien ` +
      `entonces el ultimo mensaje de ELLA como sintoma de todo eso. El arquetipo y los ` +
      `medidores deben salir del historial entero, no de los ultimos tres mensajes. ` +
      `Cita fragmentos literales (de la ventana o del resumen) para sostener cada lectura.`
    : `=== CAPTURA A ANALIZAR ===\n` +
      `Plataforma: ${input.extraction.platform}\n` +
      (input.extraction.detectedName
        ? `Nombre en el encabezado: ${input.extraction.detectedName}\n`
        : "") +
      `Confianza de la extraccion: ${Math.round(input.extraction.confidence * 100)}%\n` +
      `Tiempo: ${timelineBrief(input.extraction)}\n\n` +
      `${threadText}\n\n` +
      `Primero lee el reloj (horas, dias, saltos) y despues el ultimo mensaje de ELLA ` +
      `en el contexto de todo el hilo. Cita fragmentos literales y horas para sostener tu lectura.`;

  const noteBlock = input.userNote?.trim()
    ? `\n\n=== LO QUE EL USUARIO PREGUNTA O ACLARA SOBRE ESTA CAPTURA ===\n${input.userNote.trim().slice(0, 600)}\n` +
      `Responde a eso dentro del analisis (en lead y subtext) ademas de la lectura normal.`
    : "";
  const promptParts = [{ text: `${context.text}\n\n${header}${noteBlock}` }];

  const result = await generateStructured({
    task: "analysis",
    system: `${BUNKER_SYSTEM}${personaDirective(input.user.alfiiPersona)}`,
    parts: promptParts,
    jsonSchema: analysisResponseSchema,
    validator: analysisPayloadSchema,
    temperature: 0.85,
    maxOutputTokens: 5000,
    attribution: { userId: String(input.user._id) },
  });

  logMetrics("analysis.run", {
    provider: result.provider,
    failedOver: result.failedOver,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
    repaired: result.repaired,
    contextTokens: context.tokens,
    dropped: context.dropped,
  });

  const analysis = await AnalysisModel.create({
    userId: input.user._id,
    targetId: input.target?._id,
    sourceType: input.sourceType ?? "screenshot",
    platform: input.extraction.platform,
    detectedName: input.extraction.detectedName ?? undefined,
    image: input.image ?? undefined,
    extractedThread: input.extraction.thread.map((m) => ({
      speaker: m.speaker,
      text: m.text,
      timestamp: m.timestamp ?? undefined,
      dateLabel: m.dateLabel ?? undefined,
    })),
    payload: result.data,
    aiModel: result.model,
    promptVersion: PROMPT_VERSION,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  await UserModel.findByIdAndUpdate(input.user._id, {
    $inc: { analysisCount: 1 },
    $set: { lastActiveAt: new Date() },
  });

  if (input.target) {
    await persistAnalysisIntoTarget(input.target, analysis, result.data, input.image ?? null);
    // Compactacion asincrona: el usuario nunca espera por esto.
    void maybeCompact(input.target._id);
  }

  return { analysis, payload: result.data };
}

async function persistAnalysisIntoTarget(
  target: ITarget,
  analysis: IAnalysis,
  payload: AnalysisPayload,
  image: IMessageImage | null
) {
  // El stateUpdate del modelo se combina con lo que el propio analisis ya
  // afirma en sus bloques: el diagnostico de arquetipo, el nivel de riesgo y
  // los medidores son parte del contrato, no una propuesta suelta.
  await applyStateUpdate(
    target._id,
    {
      ...(payload.stateUpdate ?? {}),
      archetypeShift: {
        primary: payload.archetypeDiagnosis.primary,
        hybrid: payload.archetypeDiagnosis.hybrid,
        confidence: payload.archetypeDiagnosis.confidence,
      },
      riskLevel: payload.riskRadar.level,
      newRiskFlags: payload.riskRadar.flags,
      meters: payload.meters,
      timingObserved: payload.stateUpdate?.timingObserved ?? null,
      stage: payload.stateUpdate?.stage ?? null,
      summaryPatch: payload.stateUpdate?.summaryPatch ?? null,
    },
    analysis._id
  );

  await TargetModel.findByIdAndUpdate(target._id, {
    $inc: { analysisCount: 1, messageCount: image ? 2 : 1 },
    $set: {
      lastAnalysisAt: new Date(),
      lastMessageAt: new Date(),
      "timingPattern.recommendedDelayMinutes": payload.timing.waitMinutes,
      "timingPattern.lastRecommendedAt": new Date(),
    },
  });

  // La captura entra al hilo ANTES del analisis: el usuario debe ver primero
  // lo que subio y despues la lectura, igual que en la conversacion real.
  if (image) {
    await MessageModel.create({
      userId: target.userId,
      targetId: target._id,
      role: "user",
      kind: "screenshot",
      content: "",
      image,
    });
  }

  // La pregunta aclaratoria va al hilo como mensaje de Alfii: el usuario la
  // responde en el chat y la capa de historial la lleva al siguiente turno.
  if (payload.clarifyingQuestion?.trim()) {
    await MessageModel.create({
      userId: target.userId,
      targetId: target._id,
      role: "alfii",
      kind: "text",
      content: payload.clarifyingQuestion.trim(),
    });
  }

  await MessageModel.create({
    userId: target.userId,
    targetId: target._id,
    role: "alfii",
    kind: "analysis",
    content: payload.lead || payload.subtext.reading.slice(0, 300),
    analysisId: analysis._id,
    meta: {
      model: analysis.aiModel,
      promptVersion: analysis.promptVersion,
      inputTokens: analysis.inputTokens,
      outputTokens: analysis.outputTokens,
      latencyMs: analysis.latencyMs,
    },
  });
}

/**
 * Re-analisis calibrado: la MISMA captura, ahora con la Matriz de Identidad
 * aplicada. El usuario ve el antes y el despues y entiende por que sus datos
 * importaban, en lugar de que se lo expliquemos.
 */
export async function recalibrateAnalysis(
  userId: Types.ObjectId,
  analysisId: string
): Promise<RunAnalysisResult> {
  const previous = await AnalysisModel.findOne({ _id: analysisId, userId });
  if (!previous) throw new CustomError("Analisis no encontrado", 404);

  const user = await UserModel.findById(userId);
  if (!user) throw new CustomError("Usuario no encontrado", 404);

  const target = previous.targetId ? await TargetModel.findById(previous.targetId) : null;

  // Sin `image` a proposito: es la MISMA captura ya presente en el hilo. Volver
  // a anclarla duplicaria la imagen en la conversacion.
  return runAnalysis({
    user,
    target,
    sourceType: previous.sourceType,
    extraction: {
      readable: true,
      issue: null,
      detectedName: previous.detectedName ?? null,
      platform: (previous.platform as any) ?? "other",
      confidence: 1,
      thread: previous.extractedThread.map((m) => ({
        speaker: m.speaker,
        text: m.text,
        timestamp: m.timestamp ?? null,
      })),
    },
  });
}
