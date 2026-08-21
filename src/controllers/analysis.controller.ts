import { Response, NextFunction } from "express";
import { param } from "../utils/params";
import { z } from "zod";
import type { AuthRequest } from "../types/AuthRequest";
import { extractFromScreenshot } from "../services/vision.service";
import { runAnalysis, recalibrateAnalysis } from "../services/analysis.service";
import {
  screenshotStorageEnabled,
  signedScreenshotUrl,
  storeScreenshot,
} from "../services/media/cloudinary.service";
import type { IMessageImage } from "../models/message.model";
import { requireOwnedTarget, createTargetFromAnalysis, targetSummary } from "../services/target.service";
import {
  parseExportOrThrow,
  buildExtractionFromParsed,
  buildImportBrief,
  summarizeHistory,
  RECENT_WINDOW,
} from "../services/import.service";
import { TargetModel } from "../models/target.model";
import { AnalysisModel } from "../models/analysis.model";
import { recordScriptOutcome } from "../services/state.service";
import { PowerProfileModel } from "../models/powerProfile.model";
import { MAX_AUTO_LESSONS_PER_SESSION } from "../schemas/enums";
import { CustomError } from "../errors/customError.error";
import { gateScriptsForAnonymous } from "../utils/scriptGating";
import { transcribeAudio } from "../services/transcription.service";
import { buildTimeline, readTrajectory } from "../services/trajectory.service";
import { MessageModel } from "../models/message.model";

export const confirmTargetSchema = z.object({
  analysisId: z.string().min(1),
  displayName: z.string().trim().min(1).max(60),
  // Solo se manda cuando el usuario ya resolvio un choque de nombres:
  // "merge" = es la misma chica, "separate" = es otra que se llama igual.
  mode: z.enum(["merge", "separate"]).optional(),
});

export const scriptFeedbackSchema = z.object({
  style: z.enum(["PODER", "CABALLERO", "PICARO"]),
  outcome: z.enum([
    "RESPONDIO_POSITIVO",
    "RESPONDIO_NEUTRO",
    "RESPONDIO_FRIO",
    "NO_RESPONDIO",
  ]),
});

/**
 * Decide que lecciones se auto-abren. El limite existe porque sin el, el primer
 * analisis dispara cinco sheets seguidos y el usuario abandona. El resto queda
 * disponible por el icono de informacion permanente.
 */
async function resolveLessons(userId: string, hints: string[]) {
  if (!hints.length) return [];

  const profile = await PowerProfileModel.findOne({ userId });
  const seen = new Set(profile?.education.seenLessons ?? []);
  const fresh = hints.filter((h) => !seen.has(h)).slice(0, MAX_AUTO_LESSONS_PER_SESSION);

  if (fresh.length && profile) {
    profile.education.seenLessons.push(...fresh);
    profile.education.lastLessonAt = new Date();
    await profile.save();
  }

  return fresh;
}

/**
 * Sube la captura si la persistencia esta activa.
 *
 * Un fallo de Cloudinary NO puede tumbar el analisis: el usuario ya espero por
 * la lectura del modelo y perderla porque el almacenamiento fallo seria
 * inaceptable. Se degrada a modo efimero y queda registrado.
 */
async function maybeStore(input: {
  buffer: Buffer;
  userId: string;
  targetId?: string;
}): Promise<IMessageImage | null> {
  if (!screenshotStorageEnabled()) return null;

  try {
    const stored = await storeScreenshot(input);
    return { provider: "cloudinary", ...stored };
  } catch (error: any) {
    console.error(`[alfii:media] no se pudo guardar la captura: ${error?.message}`);
    return null;
  }
}

/** Primera captura: sin expediente todavia. Devuelve el analisis y el nombre
 *  detectado para que el usuario lo confirme. */
export async function analyzeFirst(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new CustomError("Necesito una captura.", 400);

    const extraction = await extractFromScreenshot(
      req.file.buffer,
      req.file.mimetype,
      String(req.currentUser!._id)
    );
    const image = await maybeStore({
      buffer: req.file.buffer,
      userId: String(req.currentUser!._id),
    });

    const { analysis, payload } = await runAnalysis({
      user: req.currentUser!,
      target: null,
      extraction,
      image,
    });

    // El analisis ya quedo guardado completo en Mongo por runAnalysis. Lo que
    // se recorta aqui es solo lo que viaja por el cable: cuando el anonimo se
    // registre y pida GET /analyses/:id vera los tres scripts sin re-analizar.
    const gated = gateScriptsForAnonymous(payload, req.currentUser!.isAnonymous === true);

    res.status(201).json({
      analysisId: String(analysis._id),
      detectedName: extraction.detectedName,
      platform: extraction.platform,
      thread: analysis.extractedThread,
      imageUrl: image ? signedScreenshotUrl(image.publicId) : null,
      analysis: gated,
      lessons: await resolveLessons(String(req.currentUser!._id), payload.lessonHints ?? []),
      needsNameConfirmation: true,
    });
  } catch (error) {
    next(error);
  }
}

/** Confirmacion del nombre y creacion del expediente. */
export async function confirmTarget(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await createTargetFromAnalysis({
      userId: req.currentUser!._id,
      analysisId: req.body.analysisId,
      displayName: req.body.displayName,
      mode: req.body.mode,
    });
    res.status(201).json({ target: targetSummary(target) });
  } catch (error) {
    next(error);
  }
}

/** Captura sobre un expediente existente: aqui entra la memoria acumulada. */
export async function analyzeForTarget(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new CustomError("Necesito una captura.", 400);

    const target = await requireOwnedTarget(req.currentUser!._id, param(req, "id"));
    const extraction = await extractFromScreenshot(
      req.file.buffer,
      req.file.mimetype,
      String(req.currentUser!._id)
    );
    const image = await maybeStore({
      buffer: req.file.buffer,
      userId: String(req.currentUser!._id),
      targetId: String(target._id),
    });

    // Nota opcional del usuario ("mira el tono de la ultima", "que le digo
    // aqui"): entra al prompt y queda en el hilo ANTES de la captura, como en
    // una conversacion real.
    const userNote = String(req.body?.note ?? "").trim().slice(0, 600);
    if (userNote) {
      await MessageModel.create({
        userId: req.currentUser!._id,
        targetId: target._id,
        role: "user",
        kind: "text",
        content: userNote,
      });
    }

    const { analysis, payload } = await runAnalysis({
      user: req.currentUser!,
      target,
      extraction,
      image,
      userNote,
    });

    const fresh = await requireOwnedTarget(req.currentUser!._id, param(req, "id"));

    // Tambien aqui: un anonimo puede confirmar expediente y seguir analizando.
    // Si este handler no aplicara el gate, seria la puerta trasera del bloqueo.
    res.status(201).json({
      analysisId: String(analysis._id),
      analysis: gateScriptsForAnonymous(payload, req.currentUser!.isAnonymous === true),
      thread: analysis.extractedThread,
      imageUrl: image ? signedScreenshotUrl(image.publicId) : null,
      target: targetSummary(fresh),
      lessons: await resolveLessons(String(req.currentUser!._id), payload.lessonHints ?? []),
    });
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Import de conversacion completa (.txt de WhatsApp o texto pegado)
// ---------------------------------------------------------------------------

/** Lee el archivo del request y corta si falta. El texto pegado llega igual:
 *  el cliente lo envuelve en un Blob y usa el mismo campo multipart. */
function requireExportText(req: AuthRequest): string {
  if (!req.file) throw new CustomError("Necesito el archivo .txt o el texto del chat.", 400);
  return req.file.buffer.toString("utf8");
}

function requireHerName(req: AuthRequest): string {
  const herName = String(req.body?.herName ?? "").trim();
  if (!herName) throw new CustomError("Dime cual de los dos es ella.", 400);
  return herName;
}

/**
 * Preview sin LLM: parsea y devuelve participantes y conteos para que el
 * usuario elija quien es ella. El cliente conserva el texto en memoria y lo
 * re-envia al analizar: mantener el serverless stateless sale mas barato que
 * persistir un archivo temporal que ademas prometimos no guardar.
 */
export async function previewImport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const parsed = parseExportOrThrow(requireExportText(req));

    res.json({
      participants: parsed.participants.map((name) => ({
        name,
        messageCount: parsed.stats.byParticipant[name] ?? 0,
      })),
      messageCount: parsed.stats.total,
      mediaFiltered: parsed.stats.mediaFiltered,
      systemDropped: parsed.stats.systemDropped,
      // true = el chat supera la ventana literal y lo viejo se resumira
      willSummarize: parsed.stats.total > RECENT_WINDOW,
      recentWindow: RECENT_WINDOW,
    });
  } catch (error) {
    next(error);
  }
}

/** Primer analisis desde texto: sin expediente todavia. Espejo de analyzeFirst. */
export async function analyzeFirstText(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const parsed = parseExportOrThrow(requireExportText(req));
    const herName = requireHerName(req);
    const extraction = buildExtractionFromParsed(parsed, herName);

    // El resumen del historial viejo se calcula ANTES del analisis: con el chat
    // completo la lectura debe salir de toda la historia, no de la ventana.
    const imported = await summarizeHistory(parsed, herName, String(req.currentUser!._id));

    const { analysis, payload } = await runAnalysis({
      user: req.currentUser!,
      target: null,
      extraction,
      sourceType: "text",
      importBrief: buildImportBrief(parsed, herName, imported),
    });

    if (imported) {
      analysis.importedHistory = imported;
      await analysis.save();
    }

    const gated = gateScriptsForAnonymous(payload, req.currentUser!.isAnonymous === true);

    res.status(201).json({
      analysisId: String(analysis._id),
      detectedName: extraction.detectedName,
      platform: extraction.platform,
      thread: analysis.extractedThread,
      imageUrl: null,
      analysis: gated,
      imported: imported
        ? { messageCount: imported.messageCount, summarized: true }
        : { messageCount: parsed.stats.total, summarized: false },
      lessons: await resolveLessons(String(req.currentUser!._id), payload.lessonHints ?? []),
      needsNameConfirmation: true,
    });
  } catch (error) {
    next(error);
  }
}

/** Import sobre un expediente existente. Espejo de analyzeForTarget. */
export async function analyzeTextForTarget(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await requireOwnedTarget(req.currentUser!._id, param(req, "id"));
    const parsed = parseExportOrThrow(requireExportText(req));
    const herName = requireHerName(req);
    const extraction = buildExtractionFromParsed(parsed, herName);

    const imported = await summarizeHistory(parsed, herName, String(req.currentUser!._id));

    const { analysis, payload } = await runAnalysis({
      user: req.currentUser!,
      target,
      extraction,
      sourceType: "text",
      importBrief: buildImportBrief(parsed, herName, imported),
    });

    if (imported) {
      // Un import nuevo reemplaza al anterior entero: es la foto mas completa
      await TargetModel.findByIdAndUpdate(target._id, {
        $set: { importedHistory: { ...imported, importedAt: new Date() } },
      });
    }

    const fresh = await requireOwnedTarget(req.currentUser!._id, param(req, "id"));

    res.status(201).json({
      analysisId: String(analysis._id),
      analysis: gateScriptsForAnonymous(payload, req.currentUser!.isAnonymous === true),
      thread: analysis.extractedThread,
      imageUrl: null,
      target: targetSummary(fresh),
      imported: imported
        ? { messageCount: imported.messageCount, summarized: true }
        : { messageCount: parsed.stats.total, summarized: false },
      lessons: await resolveLessons(String(req.currentUser!._id), payload.lessonHints ?? []),
    });
  } catch (error) {
    next(error);
  }
}

/** Re-analisis calibrado: la misma captura con la Matriz de Identidad aplicada.
 *  El usuario ve el antes y el despues, en lugar de que le expliquemos por que
 *  sus datos importaban. */
export async function recalibrate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const previous = await AnalysisModel.findOne({
      _id: param(req, "id"),
      userId: req.currentUser!._id,
    });
    if (!previous) throw new CustomError("Analisis no encontrado", 404);

    const { analysis, payload } = await recalibrateAnalysis(
      req.currentUser!._id,
      param(req, "id")
    );

    // El antes/despues muestra dos payloads completos: sin gate seria la via mas
    // barata para leer los tres scripts sin cuenta.
    const isAnonymous = req.currentUser!.isAnonymous === true;

    res.status(201).json({
      before: {
        analysisId: String(previous._id),
        analysis: gateScriptsForAnonymous(previous.payload, isAnonymous),
      },
      after: {
        analysisId: String(analysis._id),
        analysis: gateScriptsForAnonymous(payload, isAnonymous),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getAnalysis(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const analysis = await AnalysisModel.findOne({
      _id: param(req, "id"),
      userId: req.currentUser!._id,
    });
    if (!analysis) throw new CustomError("Analisis no encontrado", 404);

    // Mismo gate en la lectura: sin esto, un anonimo recupera por GET los dos
    // scripts que la respuesta del POST le habia ocultado.
    res.json({
      analysisId: String(analysis._id),
      analysis: gateScriptsForAnonymous(analysis.payload, req.currentUser!.isAnonymous === true),
      thread: analysis.extractedThread,
      imageUrl: analysis.image?.publicId ? signedScreenshotUrl(analysis.image.publicId) : null,
      createdAt: analysis.createdAt,
      scriptFeedback: analysis.scriptFeedback,
    });
  } catch (error) {
    next(error);
  }
}

/** Cierre del ciclo de aprendizaje: que script uso y que paso despues. */
export async function submitScriptFeedback(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const analysis = await AnalysisModel.findOne({
      _id: param(req, "id"),
      userId: req.currentUser!._id,
    });
    if (!analysis) throw new CustomError("Analisis no encontrado", 404);

    analysis.scriptFeedback.push({
      style: req.body.style,
      outcome: req.body.outcome,
      at: new Date(),
    });
    await analysis.save();

    if (analysis.targetId) {
      await recordScriptOutcome(
        analysis.targetId,
        req.body.style,
        req.body.outcome,
        analysis._id
      );
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

/**
 * Nota de voz → texto en el hilo. SOLO transcribe: no analiza, no opina. El
 * texto queda como mensaje del usuario (kind "audio") y entra al contexto de
 * Alfii por la capa de historial, asi el usuario puede preguntar por el.
 */
export async function transcribeForTarget(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await requireOwnedTarget(req.currentUser!._id, param(req, "id"));
    const file = req.file;
    if (!file?.buffer?.length) throw new CustomError("Falta el audio.", 400);

    const result = await transcribeAudio({
      buffer: file.buffer,
      mimetype: file.mimetype,
      filename: file.originalname || "audio.ogg",
      userId: String(req.currentUser!._id),
    });

    const message = await MessageModel.create({
      userId: req.currentUser!._id,
      targetId: target._id,
      role: "user",
      kind: "audio",
      content: result.text,
      meta: { model: result.model, latencyMs: result.latencyMs },
    });

    await TargetModel.findByIdAndUpdate(target._id, {
      $set: { lastMessageAt: new Date() },
      $inc: { messageCount: 1 },
    });

    res.status(201).json({
      message: {
        _id: String(message._id),
        role: "user",
        kind: "audio",
        content: result.text,
        createdAt: message.createdAt,
      },
      provider: result.provider,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    next(error);
  }
}

/** Serie de analisis del expediente para el grafo del historial. */
export async function timeline(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await requireOwnedTarget(req.currentUser!._id, param(req, "id"));
    const points = await buildTimeline(target);
    res.json({
      points,
      current: target.meters?.current ?? null,
      metersHistory: (target.meters?.history ?? []).map((m: any) => ({
        kiss: m.kiss,
        firstDate: m.firstDate,
        firstNight: m.firstNight,
        at: m.at,
      })),
      imported: target.importedHistory
        ? { messageCount: target.importedHistory.messageCount, firstMessageAt: target.importedHistory.firstMessageAt ?? null, lastMessageAt: target.importedHistory.lastMessageAt ?? null }
        : null,
      milestones: target.milestones ?? null,
      createdAt: target.createdAt,
    });
  } catch (error) {
    next(error);
  }
}

/** Lectura global de la trayectoria (cacheada por analysisCount / 24 h). */
export async function trajectory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await requireOwnedTarget(req.currentUser!._id, param(req, "id"));
    const force = String(req.query?.force ?? "") === "1";
    const out = await readTrajectory({ user: req.currentUser!, target, force });
    res.json(out);
  } catch (error) {
    next(error);
  }
}
