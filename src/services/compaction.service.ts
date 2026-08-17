import { Types } from "mongoose";
import { MessageModel } from "../models/message.model";
import { TargetModel } from "../models/target.model";
import { generateStructured } from "./ai/structured";
import { compactionResponseSchema, compactionSchema } from "../schemas/chat.schema";
import { COMPACTION_THRESHOLD, RECENT_MESSAGES_WINDOW } from "./context.service";
import { logEvent } from "../utils/redact";

const COMPACTION_SYSTEM = `Resumes el historial de asesoria entre Alfii y un usuario sobre una mujer concreta.

Produce un resumen rodante que reemplaza por completo el anterior. NO lo
concatenes: reescribelo entero. Maximo 1200 caracteres.

Prioriza, en este orden:
1. Hechos concretos: citas acordadas o caidas, encuentros, cambios de etapa.
2. Patrones de conducta de ella que se repiten.
3. Que enfoques funcionaron y cuales no.
4. Contexto personal relevante de ella que el usuario menciono.

Descarta cortesias, repeticiones y detalles irrelevantes. Escribe en tercera
persona, denso y factual. Sin encabezados ni listas.`;

/**
 * Compactacion asincrona.
 *
 * Clave: los mensajes NO se borran. Se marcan compacted=true, salen del
 * contexto del modelo y siguen visibles en la UI del usuario. El historial que
 * ve el usuario y el contexto que ve el modelo son dos cosas distintas.
 *
 * Se ejecuta despues de responder para que el usuario nunca espere por esto.
 */
export async function maybeCompact(targetId: string | Types.ObjectId): Promise<boolean> {
  const activeCount = await MessageModel.countDocuments({ targetId, compacted: false });
  if (activeCount < COMPACTION_THRESHOLD) return false;

  const target = await TargetModel.findById(targetId);
  if (!target) return false;

  // Los mas recientes se conservan literales; el resto se resume.
  const recent = await MessageModel.find({ targetId, compacted: false })
    .sort({ createdAt: -1 })
    .limit(RECENT_MESSAGES_WINDOW)
    .select("_id")
    .lean();

  const keepIds = new Set(recent.map((m) => String(m._id)));

  const toCompact = await MessageModel.find({ targetId, compacted: false })
    .sort({ createdAt: 1 })
    .select("_id role kind content createdAt")
    .lean();

  const olderMessages = toCompact.filter((m) => !keepIds.has(String(m._id)));
  if (!olderMessages.length) return false;

  const transcript = olderMessages
    .map((m) => `${m.role === "user" ? "USUARIO" : "ALFII"}: ${m.content}`.slice(0, 700))
    .join("\n");

  try {
    const result = await generateStructured({
      task: "chat",
      system: COMPACTION_SYSTEM,
      parts: [
        {
          text:
            `Resumen previo (puede estar vacio):\n${target.contextSummary || "(vacio)"}\n\n` +
            `Conversacion a resumir:\n${transcript}`,
        },
      ],
      jsonSchema: compactionResponseSchema,
      validator: compactionSchema,
      temperature: 0.4,
      maxOutputTokens: 900,
      attribution: { userId: String(target.userId) },
    });

    target.contextSummary = result.data.summary.slice(0, 1200);
    await target.save();

    await MessageModel.updateMany(
      { _id: { $in: olderMessages.map((m) => m._id) } },
      { $set: { compacted: true } }
    );

    logEvent("compaction.done", {
      targetId: String(targetId),
      compactedCount: olderMessages.length,
      model: result.model,
      latencyMs: result.latencyMs,
    });

    return true;
  } catch (error) {
    // La compactacion es una optimizacion, no una funcion critica: si falla,
    // el turno del usuario ya se respondio y se reintenta en el siguiente.
    logEvent("compaction.failed", { targetId: String(targetId) });
    return false;
  }
}
