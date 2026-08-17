import { Types } from "mongoose";
import { TargetModel, ITarget } from "../models/target.model";
import { AnalysisModel } from "../models/analysis.model";
import { MessageModel } from "../models/message.model";
import { deleteScreenshots } from "./media/cloudinary.service";
import {
  ACCENT_COLORS,
  ARCHETYPE_LABELS,
  MILESTONE_KEYS,
  MILESTONE_LABELS,
  MILESTONE_METER,
  type MilestoneKey,
} from "../schemas/enums";
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
function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Expediente activo con el mismo nombre, ignorando mayusculas y espacios. */
async function findTwinTarget(userId: Types.ObjectId, name: string) {
  return TargetModel.findOne({
    userId,
    isArchived: false,
    displayName: { $regex: `^${escapeRegex(name.trim())}$`, $options: "i" },
  });
}

/** "Valeria" -> "Valeria (2)". Busca el primer sufijo libre. */
async function uniqueName(userId: Types.ObjectId, name: string) {
  for (let n = 2; n < 20; n++) {
    const candidate = `${name} (${n})`;
    if (!(await findTwinTarget(userId, candidate))) return candidate;
  }
  return `${name} (nueva)`;
}

/**
 * Cuelga un analisis suelto de un expediente que ya existe.
 *
 * Es la rama "es la misma": el analisis pasa a formar parte de esa memoria, con
 * su captura y su lectura en el hilo, en vez de abrir una ficha paralela.
 */
async function attachAnalysisToTarget(target: ITarget, analysis: any): Promise<ITarget> {
  analysis.targetId = target._id;
  await analysis.save();

  if (analysis.image?.publicId) {
    await MessageModel.create({
      userId: target.userId,
      targetId: target._id,
      role: "user",
      kind: "screenshot",
      content: "",
      image: analysis.image,
    });
  }

  await MessageModel.create({
    userId: target.userId,
    targetId: target._id,
    role: "alfii",
    kind: "analysis",
    content: analysis.payload.lead || analysis.payload.subtext.reading.slice(0, 300),
    analysisId: analysis._id,
  });

  await TargetModel.findByIdAndUpdate(target._id, {
    $inc: { analysisCount: 1, messageCount: analysis.image?.publicId ? 2 : 1 },
    $set: {
      lastAnalysisAt: new Date(),
      lastMessageAt: new Date(),
      // Si el analisis venia de un import de WhatsApp, su resumen tambien se
      // muda al expediente fusionado (reemplaza al anterior: es mas completo).
      ...(analysis.importedHistory
        ? { importedHistory: { ...analysis.importedHistory, importedAt: new Date() } }
        : {}),
    },
  });

  return (await TargetModel.findById(target._id)) ?? target;
}

export async function createTargetFromAnalysis(input: {
  userId: Types.ObjectId;
  analysisId: string;
  displayName: string;
  /** Sin modo, un nombre repetido corta con 409 para que decida el usuario. */
  mode?: "merge" | "separate";
}): Promise<ITarget> {
  const analysis = await AnalysisModel.findOne({ _id: input.analysisId, userId: input.userId });
  if (!analysis) throw new CustomError("Analisis no encontrado", 404);
  if (analysis.targetId) {
    const existing = await TargetModel.findById(analysis.targetId);
    if (existing) return existing;
  }

  const name = input.displayName.trim().slice(0, 60);
  if (!name) throw new CustomError("Necesito un nombre para el expediente.", 400);

  /**
   * Deteccion de expediente repetido.
   *
   * PORQUE no se unifica solo: dos personas pueden llamarse igual, y fusionar
   * por nombre sin preguntar mezclaria dos memorias distintas, que es el peor
   * error posible en este producto. Tampoco se crea un duplicado en silencio:
   * eso partia la memoria de la misma chica en dos fichas. Se corta aqui y
   * decide el usuario, que es el unico que sabe si es la misma.
   */
  const twin = await findTwinTarget(input.userId, name);

  if (twin && !input.mode) {
    throw new CustomError(`Ya tienes un expediente de ${twin.displayName}.`, 409, {
      reason: "duplicate_target",
      existing: {
        id: String(twin._id),
        displayName: twin.displayName,
        stage: twin.stage,
        analysisCount: twin.analysisCount,
        lastMessageAt: twin.lastMessageAt,
      },
    });
  }

  if (twin && input.mode === "merge") {
    return attachAnalysisToTarget(twin, analysis);
  }

  // "separate": es otra persona con el mismo nombre. Se desambigua para que el
  // usuario pueda distinguirlas de un vistazo en la Boveda.
  const finalName = twin ? await uniqueName(input.userId, name) : name;

  const count = await TargetModel.countDocuments({ userId: input.userId });
  const payload = analysis.payload;

  const target = await TargetModel.create({
    userId: input.userId,
    displayName: finalName,
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
    // El resumen del import viajo en el analisis (aun no habia expediente):
    // al confirmar el nombre se muda a su casa definitiva.
    importedHistory: analysis.importedHistory
      ? { ...analysis.importedHistory, importedAt: new Date() }
      : undefined,
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

/**
 * Marca o desmarca un hito.
 *
 * Al marcarlo se resuelve tambien su medidor al 100: dejar "beso 34%" cuando el
 * usuario acaba de decir que ya paso seria contradecirle con una estimacion.
 * Al desmarcarlo el medidor NO se restaura: la estimacion vieja ya no vale y el
 * proximo analisis la recalculara con datos frescos.
 */
export async function setMilestone(input: {
  userId: Types.ObjectId;
  targetId: string;
  key: MilestoneKey;
  achieved: boolean;
}): Promise<ITarget> {
  const target = await requireOwnedTarget(input.userId, input.targetId);

  target.milestones[input.key] = {
    achieved: input.achieved,
    at: input.achieved ? new Date() : undefined,
  };

  const meter = MILESTONE_METER[input.key];
  if (meter && input.achieved) {
    target.meters.current[meter] = 100;
  }

  // Si la salida ya ocurrio, la etapa lo refleja venga de donde venga: no tiene
  // sentido seguir en "calibrando" cuando el usuario acaba de decir que se
  // vieron. Solo avanza, nunca retrocede desde un estado posterior.
  const BEFORE_DATE = ["APERTURA", "CALIBRACION", "ESCALADA", "CITA_AGENDADA"];
  if (input.key === "firstDate" && input.achieved && BEFORE_DATE.includes(target.stage)) {
    target.stage = "POST_CITA";
  }

  target.version += 1;
  await target.save();
  return target;
}

/**
 * Fusiona el expediente `fromId` dentro de `intoId`.
 *
 * Existe para los duplicados que ya estan en la base: antes cada analisis creaba
 * su propia ficha, asi que la misma chica podia quedar partida en dos memorias.
 * Borrar una perderia mensajes y capturas reales, asi que se mueven.
 *
 * Criterio en los choques: gana el dato MAS avanzado o MAS antiguo segun el
 * caso. Un hito cumplido gana a uno sin cumplir (ocurrio de verdad), un medidor
 * mas alto gana al mas bajo (el analisis mas reciente lo estimo asi), y la fecha
 * mas antigua gana en "cuando paso" (es cuando realmente ocurrio).
 */
export async function mergeTargets(input: {
  userId: Types.ObjectId;
  intoId: string;
  fromId: string;
}): Promise<ITarget> {
  if (input.intoId === input.fromId) {
    throw new CustomError("No puedo fusionar un expediente consigo mismo.", 400);
  }

  const into = await requireOwnedTarget(input.userId, input.intoId);
  const from = await requireOwnedTarget(input.userId, input.fromId);

  // El contenido se mueve, nunca se borra: son conversaciones y capturas reales.
  await MessageModel.updateMany({ targetId: from._id }, { $set: { targetId: into._id } });
  await AnalysisModel.updateMany({ targetId: from._id }, { $set: { targetId: into._id } });

  for (const key of MILESTONE_KEYS) {
    const a = into.milestones?.[key];
    const b = from.milestones?.[key];
    if (b?.achieved && !a?.achieved) {
      into.milestones[key] = { achieved: true, at: b.at };
    } else if (a?.achieved && b?.achieved) {
      const earliest = [a.at, b.at].filter(Boolean).sort()[0];
      into.milestones[key] = { achieved: true, at: earliest as Date | undefined };
    }
  }

  into.meters.current = {
    kiss: Math.max(into.meters.current.kiss, from.meters.current.kiss),
    firstDate: Math.max(into.meters.current.firstDate, from.meters.current.firstDate),
    firstNight: Math.max(into.meters.current.firstNight, from.meters.current.firstNight),
  };
  into.meters.history = [...into.meters.history, ...from.meters.history].sort(
    (x, y) => new Date(x.at).getTime() - new Date(y.at).getTime()
  );

  into.archetype.history = [...into.archetype.history, ...from.archetype.history].sort(
    (x, y) => new Date(x.at).getTime() - new Date(y.at).getTime()
  );
  if (!into.archetype.primary && from.archetype.primary) {
    into.archetype.primary = from.archetype.primary;
    into.archetype.confidence = from.archetype.confidence;
    into.archetype.hybrid = from.archetype.hybrid;
  }

  // Las red flags no se descartan nunca: son justo lo que protege al usuario.
  const seenFlags = new Set(into.riskProfile.flags.map((f) => f.code));
  for (const flag of from.riskProfile.flags) {
    if (!seenFlags.has(flag.code)) into.riskProfile.flags.push(flag);
  }
  if (from.riskProfile.transactionalRisk > into.riskProfile.transactionalRisk) {
    into.riskProfile.transactionalRisk = from.riskProfile.transactionalRisk;
    into.riskProfile.level = from.riskProfile.level;
  }

  into.scriptsUsed = [...into.scriptsUsed, ...from.scriptsUsed];

  // Los datos declarados de ella solo rellenan huecos: lo que ya estaba en el
  // expediente destino se respeta.
  if (from.herProfile) {
    into.herProfile = { ...from.herProfile, ...(into.herProfile ?? {}) };
  }

  if (from.contextSummary && from.contextSummary !== into.contextSummary) {
    into.contextSummary = `${into.contextSummary}\n${from.contextSummary}`.trim().slice(-1200);
  }

  into.analysisCount += from.analysisCount;
  into.messageCount += from.messageCount;
  if (from.lastMessageAt && (!into.lastMessageAt || from.lastMessageAt > into.lastMessageAt)) {
    into.lastMessageAt = from.lastMessageAt;
  }
  into.version += 1;

  await into.save();
  await TargetModel.deleteOne({ _id: from._id });

  return into;
}

/** Cuanto sabemos de ella. Alimenta el aviso de "completar su perfil". */
export function herProfileCompleteness(target: ITarget) {
  const her = target.herProfile ?? {};
  const checks: { field: string; done: boolean }[] = [
    { field: "howWeMet", done: !!her.howWeMet },
    { field: "knownSinceMonths", done: typeof her.knownSinceMonths === "number" },
    { field: "herAge", done: typeof her.herAge === "number" },
    { field: "herOccupation", done: !!her.herOccupation },
    { field: "instagram", done: !!her.instagram },
    { field: "relationshipGoal", done: !!her.relationshipGoal },
  ];

  const done = checks.filter((c) => c.done).length;
  return {
    score: Math.round((done / checks.length) * 100),
    missing: checks.filter((c) => !c.done).map((c) => c.field),
  };
}

/** Hitos en forma serializable, con etiqueta lista para pintar. */
export function milestonesView(target: ITarget) {
  return MILESTONE_KEYS.map((key) => ({
    key,
    label: MILESTONE_LABELS[key],
    achieved: !!target.milestones?.[key]?.achieved,
    at: target.milestones?.[key]?.at ?? null,
  }));
}

export function targetSummary(target: ITarget) {
  return {
    id: String(target._id),
    milestones: milestonesView(target),
    herProfile: target.herProfile ?? null,
    herCompleteness: herProfileCompleteness(target),
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
