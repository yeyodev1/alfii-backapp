import { Response, NextFunction } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import type { AuthRequest } from "../types/AuthRequest";
import { AiUsageModel } from "../models/aiUsage.model";
import { UserModel } from "../models/user.model";
import { param, queryString } from "../utils/params";
import { CustomError } from "../errors/customError.error";
import { MODEL_CATALOG, CATALOG_PROVIDERS, type CatalogProvider } from "../services/ai/catalog";
import { activeConfig, setModelOverride } from "../services/modelConfig.service";
import { providerBillingSnapshot } from "../services/providerBilling.service";
import { isEnvAdmin } from "../middlewares/admin.middleware";

/**
 * Portal de administracion: gasto de IA global y por usuario.
 *
 * Todo se agrega al leer desde la coleccion aiusages (un documento por
 * llamada). Con el volumen actual eso es instantaneo; si algun dia duele,
 * el precomputo se agrega sin cambiar el contrato de estos endpoints.
 */

function windowDays(req: AuthRequest): number {
  const days = Number(queryString(req, "days") ?? 30);
  return Number.isFinite(days) ? Math.min(Math.max(Math.round(days), 1), 365) : 30;
}

function since(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

const SUM_FIELDS = {
  costUsd: { $sum: "$costUsd" },
  inputTokens: { $sum: "$inputTokens" },
  outputTokens: { $sum: "$outputTokens" },
  calls: { $sum: 1 },
} as const;

export async function overview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const days = windowDays(req);
    const from = since(days);

    const [allTime, inWindow, byProvider, byModel, byTask, byDay, activeUserIds, totalUsers] =
      await Promise.all([
        AiUsageModel.aggregate([{ $group: { _id: null, ...SUM_FIELDS } }]),
        AiUsageModel.aggregate([
          { $match: { createdAt: { $gte: from } } },
          { $group: { _id: null, ...SUM_FIELDS } },
        ]),
        AiUsageModel.aggregate([
          { $match: { createdAt: { $gte: from } } },
          { $group: { _id: "$provider", ...SUM_FIELDS } },
          { $sort: { costUsd: -1 } },
        ]),
        AiUsageModel.aggregate([
          { $match: { createdAt: { $gte: from } } },
          { $group: { _id: "$aiModel", ...SUM_FIELDS } },
          { $sort: { costUsd: -1 } },
        ]),
        AiUsageModel.aggregate([
          { $match: { createdAt: { $gte: from } } },
          { $group: { _id: "$task", ...SUM_FIELDS } },
          { $sort: { costUsd: -1 } },
        ]),
        AiUsageModel.aggregate([
          { $match: { createdAt: { $gte: from } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              ...SUM_FIELDS,
            },
          },
          { $sort: { _id: 1 } },
        ]),
        AiUsageModel.distinct("userId", { createdAt: { $gte: from }, userId: { $ne: null } }),
        UserModel.countDocuments(),
      ]);

    res.json({
      days,
      totals: {
        allTime: allTime[0] ?? { costUsd: 0, inputTokens: 0, outputTokens: 0, calls: 0 },
        window: inWindow[0] ?? { costUsd: 0, inputTokens: 0, outputTokens: 0, calls: 0 },
      },
      byProvider,
      byModel,
      byTask,
      byDay,
      activeUsers: activeUserIds.length,
      totalUsers,
    });
  } catch (error) {
    next(error);
  }
}

export async function users(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const days = windowDays(req);
    const from = since(days);

    const [allTimeByUser, windowByUser] = await Promise.all([
      AiUsageModel.aggregate([
        { $match: { userId: { $ne: null } } },
        { $group: { _id: "$userId", ...SUM_FIELDS, lastCallAt: { $max: "$createdAt" } } },
      ]),
      AiUsageModel.aggregate([
        { $match: { userId: { $ne: null }, createdAt: { $gte: from } } },
        {
          $group: {
            _id: "$userId",
            ...SUM_FIELDS,
            // Dias distintos con actividad: la base de la frecuencia real.
            activeDays: {
              $addToSet: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            },
          },
        },
      ]),
    ]);

    const windowMap = new Map(windowByUser.map((u) => [String(u._id), u]));
    const totalMap = new Map(allTimeByUser.map((u) => [String(u._id), u]));

    const userDocs = await UserModel.find({})
      .select("email preferredName isAnonymous analysisCount lastActiveAt createdAt plan isVip isAdmin")
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();

    const rows = userDocs.map((u) => {
      const id = String(u._id);
      const total = totalMap.get(id);
      const win = windowMap.get(id);
      const activeDays = win?.activeDays?.length ?? 0;

      return {
        id,
        email: u.email ?? null,
        preferredName: u.preferredName ?? null,
        isAnonymous: u.isAnonymous,
        plan: u.plan,
        isVip: u.isVip === true,
        isAdmin: u.isAdmin === true || isEnvAdmin(u.email),
        isEnvAdmin: isEnvAdmin(u.email),
        createdAt: u.createdAt,
        lastActiveAt: u.lastActiveAt,
        analysisCount: u.analysisCount,
        costTotal: total?.costUsd ?? 0,
        callsTotal: total?.calls ?? 0,
        lastCallAt: total?.lastCallAt ?? null,
        costWindow: win?.costUsd ?? 0,
        callsWindow: win?.calls ?? 0,
        tokensWindow: (win?.inputTokens ?? 0) + (win?.outputTokens ?? 0),
        activeDays,
        // Llamadas por dia activo: "chatea cada tanto" en un solo numero.
        callsPerActiveDay: activeDays ? Math.round(((win?.calls ?? 0) / activeDays) * 10) / 10 : 0,
      };
    });

    rows.sort((a, b) => b.costWindow - a.costWindow || b.costTotal - a.costTotal);

    res.json({ days, users: rows });
  } catch (error) {
    next(error);
  }
}

/**
 * Catalogo + config activa + proyeccion de gasto por modelo.
 *
 * La proyeccion usa los tokens REALES de los ultimos N dias por tarea: "con
 * este modelo, tu mismo uso habria costado $X". Datos propios, no teoria.
 */
export async function models(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const days = windowDays(req);
    const from = since(days);

    const byTask = await AiUsageModel.aggregate([
      { $match: { createdAt: { $gte: from } } },
      { $group: { _id: "$task", ...SUM_FIELDS } },
    ]);
    const taskUsage = new Map(byTask.map((t) => [t._id, t]));

    const projections = Object.fromEntries(
      CATALOG_PROVIDERS.map((provider) => [
        provider,
        MODEL_CATALOG[provider].map((m) => ({
          ...m,
          // Que habria costado el uso real de cada tarea con este modelo
          projectedByTask: Object.fromEntries(
            m.tasks.map((task) => {
              const usage = taskUsage.get(task);
              const cost = usage
                ? (usage.inputTokens * m.inPerM + usage.outputTokens * m.outPerM) / 1_000_000
                : 0;
              return [task, Math.round(cost * 10000) / 10000];
            })
          ),
        })),
      ])
    );

    res.json({
      days,
      active: activeConfig(),
      catalog: projections,
      // El costo REAL de cada tarea en el periodo, para comparar contra la proyeccion
      currentByTask: Object.fromEntries(
        byTask.map((t) => [t._id, Math.round(t.costUsd * 10000) / 10000])
      ),
    });
  } catch (error) {
    next(error);
  }
}

export const patchModelSchema = z.object({
  provider: z.enum(CATALOG_PROVIDERS as [CatalogProvider, ...CatalogProvider[]]),
  task: z.enum(["chat", "analysis", "vision"]),
  /** null limpia el override y vuelve al default del env. */
  model: z.string().min(1).max(80).nullable(),
});

export async function patchModel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await setModelOverride(req.body.provider, req.body.task, req.body.model);
    res.json({ ok: true, active: activeConfig() });
  } catch (error) {
    next(error);
  }
}

/** Verificacion del gasto contra las APIs de los proveedores + gasto local. */
export async function providers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const days = windowDays(req);
    const from = since(days);

    const [billing, localByProvider] = await Promise.all([
      providerBillingSnapshot(days),
      AiUsageModel.aggregate([
        { $match: { createdAt: { $gte: from } } },
        { $group: { _id: "$provider", ...SUM_FIELDS } },
      ]),
    ]);

    res.json({
      days,
      billing,
      local: Object.fromEntries(
        localByProvider.map((p) => [
          p._id,
          { costUsd: p.costUsd, calls: p.calls, tokens: p.inputTokens + p.outputTokens },
        ])
      ),
    });
  } catch (error) {
    next(error);
  }
}

export const patchAdminSchema = z.object({ isAdmin: z.boolean() });

/**
 * Otorga o retira acceso admin. Guardas:
 *  - solo cuentas registradas (un anonimo con flag admin no significa nada);
 *  - nadie puede tocar su PROPIO flag: quitartelo a ti mismo te bloquea, y
 *    dartelo tu mismo no tiene sentido (ya eres admin si llegaste aqui).
 * Los correos de ADMIN_EMAILS son admin siempre, con o sin flag.
 */
export async function patchAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = param(req, "id");
    if (!Types.ObjectId.isValid(id)) throw new CustomError("Id invalido", 400);
    if (String(req.currentUser!._id) === id) {
      throw new CustomError("No puedes cambiar tu propio acceso de administrador.", 400);
    }

    const target = await UserModel.findById(id).select("isAnonymous");
    if (!target) throw new CustomError("Usuario no encontrado", 404);
    if (target.isAnonymous) {
      throw new CustomError("Una cuenta anonima no puede ser administrador.", 400);
    }

    const user = await UserModel.findByIdAndUpdate(
      id,
      { $set: { isAdmin: req.body.isAdmin } },
      { new: true }
    ).select("email preferredName isAdmin isVip plan");

    res.json({ ok: true, user });
  } catch (error) {
    next(error);
  }
}

export const patchVipSchema = z.object({ isVip: z.boolean() });

export async function patchVip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = param(req, "id");
    if (!Types.ObjectId.isValid(id)) throw new CustomError("Id invalido", 400);

    const user = await UserModel.findByIdAndUpdate(
      id,
      { $set: { isVip: req.body.isVip } },
      { new: true }
    ).select("email preferredName isAnonymous isVip plan");
    if (!user) throw new CustomError("Usuario no encontrado", 404);

    res.json({ ok: true, user });
  } catch (error) {
    next(error);
  }
}

export async function userDetail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const days = windowDays(req);
    const from = since(days);
    const id = param(req, "id");
    if (!Types.ObjectId.isValid(id)) throw new CustomError("Id invalido", 400);
    const userId = new Types.ObjectId(id);

    const [user, byDay, byTask, recent] = await Promise.all([
      UserModel.findById(userId)
        .select("email preferredName isAnonymous analysisCount lastActiveAt createdAt plan")
        .lean(),
      AiUsageModel.aggregate([
        { $match: { userId, createdAt: { $gte: from } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            ...SUM_FIELDS,
          },
        },
        { $sort: { _id: 1 } },
      ]),
      AiUsageModel.aggregate([
        { $match: { userId, createdAt: { $gte: from } } },
        { $group: { _id: "$task", ...SUM_FIELDS } },
        { $sort: { costUsd: -1 } },
      ]),
      AiUsageModel.find({ userId })
        .sort({ createdAt: -1 })
        .limit(50)
        .select("provider aiModel task inputTokens outputTokens costUsd latencyMs estimated createdAt")
        .lean(),
    ]);

    if (!user) throw new CustomError("Usuario no encontrado", 404);

    res.json({ days, user, byDay, byTask, recent });
  } catch (error) {
    next(error);
  }
}
