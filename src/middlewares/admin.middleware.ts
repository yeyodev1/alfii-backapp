import { Response, NextFunction } from "express";
import { env } from "../config/env";
import type { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";

/**
 * Acceso al portal de administracion. Dos vias:
 *
 *  1. ADMIN_EMAILS (env): el respaldo que solo toca quien despliega. Estos
 *     correos son admin SIEMPRE — garantiza que el dueno nunca se bloquea.
 *  2. user.isAdmin: otorgado desde el propio portal por un admin existente.
 *
 * Anonimos jamas, tengan el flag que tengan.
 */
const adminEmails = new Set(
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

export function isEnvAdmin(email?: string | null): boolean {
  return !!email && adminEmails.has(email.toLowerCase());
}

export function adminOnly(req: AuthRequest, _res: Response, next: NextFunction) {
  const user = req.currentUser;
  const allowed =
    !!user && !user.isAnonymous && (isEnvAdmin(user.email) || user.isAdmin === true);

  if (!allowed) {
    return next(new CustomError("Solo administradores.", 403, { reason: "admin_only" }));
  }

  next();
}
