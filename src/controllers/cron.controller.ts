import { Request, Response } from "express";
import { env } from "../config/env";
import { runReengagementSweep } from "../services/reengagement.service";

/**
 * Endpoints invocados por los cron jobs de Vercel (vercel.json "crons").
 *
 * Vercel manda "Authorization: Bearer <CRON_SECRET>" en cada invocacion; sin
 * ese header exacto se responde 401. Con CRON_SECRET vacio los crons quedan
 * apagados a proposito (desarrollo local, preview sin secreto).
 */
function isAuthorizedCron(req: Request): boolean {
  if (!env.CRON_SECRET) return false;
  return req.headers.authorization === `Bearer ${env.CRON_SECRET}`;
}

export async function reengagementCron(req: Request, res: Response): Promise<void> {
  if (!isAuthorizedCron(req)) {
    res.status(401).json({ message: "No autorizado" });
    return;
  }

  const result = await runReengagementSweep();
  res.json({ ok: true, ...result });
}
