import { Response, NextFunction } from "express";
import { param, queryString } from "../utils/params";
import { z } from "zod";
import type { AuthRequest } from "../types/AuthRequest";
import {
  listTargets,
  requireOwnedTarget,
  targetDossier,
  targetSummary,
  deleteTarget,
  setMilestone,
  mergeTargets,
} from "../services/target.service";
import { listMessages, maybeGreet, streamChat, withTargetLock } from "../services/chat.service";
import { MILESTONE_KEYS, STAGES } from "../schemas/enums";
import { HOW_WE_MET, RELATIONSHIP_GOALS, type IHerProfile } from "../models/target.model";

export const chatBodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  forceDeep: z.boolean().optional(),
});

export const patchTargetSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  stage: z.enum(STAGES).optional(),
  isArchived: z.boolean().optional(),
});

/**
 * Contexto declarado sobre ella. Todos los campos opcionales y todos anulables:
 * PORQUE el usuario debe poder borrar un dato que dio mal sin borrar el
 * expediente. `null` significa "quita esto", ausente significa "no lo toques".
 */
export const patchHerProfileSchema = z.object({
  howWeMet: z.enum(HOW_WE_MET).nullish(),
  knownSinceMonths: z.number().int().min(0).max(1200).nullish(),
  herAge: z.number().int().min(18).max(99).nullish(),
  herOccupation: z.string().trim().max(80).nullish(),
  relationshipGoal: z.enum(RELATIONSHIP_GOALS).nullish(),
  notes: z.string().trim().max(500).nullish(),
});

export const mergeTargetSchema = z.object({
  fromId: z.string().min(1),
});

/** Fusiona dos expedientes de la misma chica en uno. */
export async function merge(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await mergeTargets({
      userId: req.currentUser!._id,
      intoId: param(req, "id"),
      fromId: req.body.fromId,
    });
    res.json({ target: targetSummary(target) });
  } catch (error) {
    next(error);
  }
}

export const patchMilestoneSchema = z.object({
  key: z.enum(MILESTONE_KEYS),
  achieved: z.boolean(),
});

/** Marcar un hito es del usuario, no del modelo: es un hecho declarado. */
export async function patchMilestone(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await setMilestone({
      userId: req.currentUser!._id,
      targetId: param(req, "id"),
      key: req.body.key,
      achieved: req.body.achieved,
    });
    res.json({ target: targetSummary(target) });
  } catch (error) {
    next(error);
  }
}

export async function index(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ targets: await listTargets(req.currentUser!._id) });
  } catch (error) {
    next(error);
  }
}

export async function show(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await requireOwnedTarget(req.currentUser!._id, param(req, "id"));
    res.json({ target: targetDossier(target) });
  } catch (error) {
    next(error);
  }
}

export async function patch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await requireOwnedTarget(req.currentUser!._id, param(req, "id"));

    if (req.body.displayName) {
      target.displayName = req.body.displayName;
      target.avatarInitial = req.body.displayName.charAt(0).toUpperCase();
    }
    if (req.body.stage) target.stage = req.body.stage;
    if (typeof req.body.isArchived === "boolean") target.isArchived = req.body.isArchived;

    await target.save();
    res.json({ target: targetSummary(target) });
  } catch (error) {
    next(error);
  }
}

/**
 * Actualizacion parcial del contexto declarado sobre ella.
 *
 * PORQUE es un handler aparte y no un ramo mas de `patch`: estos campos se
 * llenan a goteo desde la conversacion, no desde la pantalla de edicion del
 * expediente. Mezclarlos obligaria al cliente a mandar displayName y stage cada
 * vez que el usuario suelta un dato suelto.
 */
export async function patchHerProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await requireOwnedTarget(req.currentUser!._id, param(req, "id"));

    const current: IHerProfile = target.herProfile ?? {};
    const next_: IHerProfile = { ...current };

    // Recorrido campo por campo: null borra, undefined conserva. Un
    // Object.assign directo del body escribiria los null como valor y dejaria
    // claves muertas en el subdocumento.
    for (const key of Object.keys(patchHerProfileSchema.shape) as (keyof IHerProfile)[]) {
      if (!(key in req.body)) continue;
      const value = req.body[key];
      if (value === null || value === "") delete next_[key];
      else (next_ as Record<string, unknown>)[key] = value;
    }

    // Si no quedo ningun dato, se quita el subdocumento entero para que el
    // dossier no serialice una seccion vacia al modelo.
    target.herProfile = Object.keys(next_).length ? next_ : undefined;
    target.markModified("herProfile");
    await target.save();

    res.json({ target: targetSummary(target), herProfile: target.herProfile ?? null });
  } catch (error) {
    next(error);
  }
}

export async function destroy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await deleteTarget(req.currentUser!._id, param(req, "id"));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function messages(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await requireOwnedTarget(req.currentUser!._id, param(req, "id"));
    const result = await listMessages({
      targetId: target._id,
      before: queryString(req, "before"),
      limit: queryString(req, "limit") ? Number(queryString(req, "limit")) : undefined,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

/** Saludo proactivo de reingreso. Alfii habla primero: una herramienta espera,
 *  un asesor pregunta. */
export async function greeting(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await requireOwnedTarget(req.currentUser!._id, param(req, "id"));
    const result = await maybeGreet({ user: req.currentUser!, target });
    res.json({ greeting: result?.greeting ?? null, messageId: result?.messageId ?? null });
  } catch (error) {
    next(error);
  }
}

/**
 * Chat con streaming SSE. La espera de 4-6 segundos se siente inaceptable en
 * bloque y natural token por token.
 */
export async function chat(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await requireOwnedTarget(req.currentUser!._id, param(req, "id"));

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Heartbeat: proxies e intermediarios cortan conexiones SSE inactivas.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

    let closed = false;
    req.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
    });

    try {
      await withTargetLock(String(target._id), async () => {
        for await (const event of streamChat({
          user: req.currentUser!,
          target,
          message: req.body.message,
          forceDeep: req.body.forceDeep,
        })) {
          if (closed) break;
          send(event.type, event.data ?? null);
        }
      });
    } catch (error: any) {
      if (!closed) send("error", { message: error?.message ?? "Fallo el analisis." });
    } finally {
      clearInterval(heartbeat);
      if (!closed) res.end();
    }
  } catch (error) {
    next(error);
  }
}
