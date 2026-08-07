import { Types } from "mongoose";
import { TargetModel, ITarget } from "../models/target.model";
import { AnalysisModel } from "../models/analysis.model";
import { MessageModel } from "../models/message.model";
import { deleteScreenshots } from "./media/cloudinary.service";
import { ACCENT_COLORS, ARCHETYPE_LABELS } from "../schemas/enums";
import { CustomError } from "../errors/customError.error";

/**
 * Verificacion de propiedad. Sin esto, cualquier usuario podria leer las
 * conversaciones de otro cambiando un id en la URL. Es la comprobacion mas
 * importante de todo el backend.
 */
export async function requireOwnedTarget(
  userId: Types.ObjectId | string,
  targetId: string
): Promise<ITarget> {
  if (!Types.ObjectId.isValid(targetId)) {
    throw new CustomError("Expediente no encontrado", 404);
  }
  const target = await TargetModel.findOne({ _id: targetId, userId });
  if (!target) throw new CustomError("Expediente no encontrado", 404);
  return target;
}

function pickAccentColor(existingCount: number) {
  return ACCENT_COLORS[existingCount % ACCENT_COLORS.length];
}

/**
 * Crea el expediente a partir de un analisis previo. El nombre viene detectado
 * del encabezado de la captura y confirmado por el usuario.
 */
export async function createTargetFromAnalysis(input: {
  userId: Types.ObjectId;
  analysisId: string;
  displayName: string;
}): Promise<ITarget> {
  const analysis = await AnalysisModel.findOne({ _id: input.analysisId, userId: input.userId });
  if (!analysis) throw new CustomError("Analisis no encontrado", 404);
  if (analysis.targetId) {
    const existing = await TargetModel.findById(analysis.targetId);
    if (existing) return existing;
  }

  const name = input.displayName.trim().slice(0, 60);
  if (!name) throw new CustomError("Necesito un nombre para el expediente.", 400);

  const count = await TargetModel.countDocuments({ userId: input.userId });
  const payload = analysis.payload;

  const target = await TargetModel.create({
    userId: input.userId,
    displayName: name,
    nameConfirmed: true,
    accentColor: pickAccentColor(count),
    avatarInitial: name.charAt(0).toUpperCase(),
    archetype: {
      primary: payload.archetypeDiagnosis.primary,
      hybrid: payload.archetypeDiagnosis.hybrid,
      confidence: payload.archetypeDiagnosis.confidence,
      history: [
        {
          primary: payload.archetypeDiagnosis.primary,
          hybrid: payload.archetypeDiagnosis.hybrid,
          confidence: payload.archetypeDiagnosis.confidence,
          analysisId: analysis._id,
          at: new Date(),
        },
      ],
    },
    riskProfile: {
      level: payload.riskRadar.level,
      transactionalRisk: payload.riskRadar.transactionalRisk,
      flags: payload.riskRadar.flags.map((f) => ({
        code: f.code,
        description: f.description,
        severity: f.severity,
        firstSeenAt: new Date(),
        occurrences: 1,
      })),
    },
    meters: {
      current: payload.meters,
      history: [{ ...payload.meters, analysisId: analysis._id, at: new Date() }],
    },
    timingPattern: {
      herActiveHours: [],
      recommendedDelayMinutes: payload.timing.waitMinutes,
      lastRecommendedAt: new Date(),
    },
    stage: payload.stateUpdate?.stage ?? "APERTURA",
    contextSummary: payload.stateUpdate?.summaryPatch ?? "",
    analysisCount: 1,
    messageCount: 1,
    lastAnalysisAt: analysis.createdAt,
    lastMessageAt: new Date(),
  });

  analysis.targetId = target._id;
  await analysis.save();

  // La primera captura se analizo antes de que existiera el expediente. Al
  // crearlo se ancla al hilo para que la conversacion arranque con la imagen
  // real y no con un analisis huerfano.
  if (analysis.image?.publicId) {
    await MessageModel.create({
      userId: input.userId,
      targetId: target._id,
      role: "user",
      kind: "screenshot",
      content: "",
      image: analysis.image,
    });
  }

  await MessageModel.create({
    userId: input.userId,
    targetId: target._id,
    role: "alfii",
    kind: "analysis",
    content: payload.lead || payload.subtext.reading.slice(0, 300),
    analysisId: analysis._id,
  });

  return target;
}

export function targetSummary(target: ITarget) {
  return {
    id: String(target._id),
    displayName: target.displayName,
    accentColor: target.accentColor,
    avatarInitial: target.avatarInitial,
    stage: target.stage,
    archetype: target.archetype.primary
      ? {
          primary: target.archetype.primary,
          label: ARCHETYPE_LABELS[target.archetype.primary],
          hybrid: target.archetype.hybrid,
          confidence: target.archetype.confidence,
        }
      : null,
    risk: {
      level: target.riskProfile.level,
      transactionalRisk: target.riskProfile.transactionalRisk,
      flagCount: target.riskProfile.flags.length,
    },
    meters: target.meters.current,
    analysisCount: target.analysisCount,
    lastMessageAt: target.lastMessageAt,
    recommendedDelayMinutes: target.timingPattern.recommendedDelayMinutes ?? null,
  };
}

export function targetDossier(target: ITarget) {
  return {
    ...targetSummary(target),
    // Va en el dossier y no en el summary: la lista de expedientes no necesita
    // estos datos y cargarlos ahi solo engorda cada item del listado.
    herProfile: target.herProfile ?? null,
    archetypeHistory: target.archetype.history,
    riskFlags: target.riskProfile.flags,
    metersHistory: target.meters.history,
    timingPattern: target.timingPattern,
    scriptsUsed: target.scriptsUsed,
    contextSummary: target.contextSummary,
    messageCount: target.messageCount,
    createdAt: target.createdAt,
    version: target.version,
  };
}

export async function listTargets(userId: Types.ObjectId) {
  const targets = await TargetModel.find({ userId, isArchived: false })
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .limit(100);
  return targets.map(targetSummary);
}

/**
 * Borrado del expediente. Con capturas persistidas, borrar solo en Mongo dejaria
 * las imagenes vivas en Cloudinary: el usuario creeria haber borrado algo que
 * sigue existiendo. Los assets se eliminan primero.
 */
export async function deleteTarget(userId: Types.ObjectId, targetId: string) {
  const target = await requireOwnedTarget(userId, targetId);

  const withImages = await MessageModel.find({
    targetId: target._id,
    "image.publicId": { $exists: true },
  })
    .select("image.publicId")
    .lean();

  await deleteScreenshots(
    withImages.map((m) => m.image?.publicId).filter((id): id is string => !!id)
  );

  await Promise.all([
    MessageModel.deleteMany({ targetId: target._id }),
    AnalysisModel.deleteMany({ targetId: target._id }),
    TargetModel.deleteOne({ _id: target._id }),
  ]);
}
