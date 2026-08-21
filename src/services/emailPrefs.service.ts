import { createHmac, timingSafeEqual } from "crypto";
import { Types } from "mongoose";
import { env } from "../config/env";
import { UserModel, type IUser } from "../models/user.model";
import { CustomError } from "../errors/customError.error";
import { appUrl } from "./mail/mail.service";

/**
 * Preferencias de correo y baja con un clic.
 *
 * El enlace del pie de cada correo NO exige login: lleva el id del usuario y
 * un token HMAC derivado de JWT_SECRET. Nadie puede dar de baja a otro sin el
 * token, y el servidor no guarda nada extra (es stateless). Desde Ajustes el
 * usuario logueado cambia lo mismo con su sesion normal.
 */

export interface EmailPrefs {
  reengagement: boolean;
  achievements: boolean;
}

export const DEFAULT_PREFS: EmailPrefs = { reengagement: true, achievements: true };

export function prefsOf(user: Pick<IUser, "emailPrefs"> | null | undefined): EmailPrefs {
  const p: any = user?.emailPrefs ?? {};
  return {
    reengagement: p.reengagement !== false,
    achievements: p.achievements !== false,
  };
}

export function unsubscribeToken(userId: string): string {
  return createHmac("sha256", env.JWT_SECRET).update(`unsub:${userId}`).digest("hex").slice(0, 40);
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  if (!Types.ObjectId.isValid(userId) || !token) return false;
  const expected = Buffer.from(unsubscribeToken(userId));
  const given = Buffer.from(String(token));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Pagina del front que gestiona la baja: /correos?u=<id>&t=<token>. */
export function emailPrefsUrl(userId: string): string {
  return appUrl(`/correos?u=${encodeURIComponent(userId)}&t=${unsubscribeToken(userId)}`);
}

export async function requireUserByToken(userId: string, token: string): Promise<IUser> {
  if (!verifyUnsubscribeToken(userId, token)) {
    throw new CustomError("Enlace de correo invalido o caducado.", 403);
  }
  const user = await UserModel.findById(userId);
  if (!user || user.isAnonymous) throw new CustomError("Cuenta no encontrada.", 404);
  return user;
}

export async function updatePrefs(userId: Types.ObjectId | string, patch: Partial<EmailPrefs>): Promise<EmailPrefs> {
  const $set: Record<string, unknown> = {};
  if (typeof patch.reengagement === "boolean") $set["emailPrefs.reengagement"] = patch.reengagement;
  if (typeof patch.achievements === "boolean") $set["emailPrefs.achievements"] = patch.achievements;
  if (patch.reengagement === false || patch.achievements === false) $set["emailPrefs.updatedAt"] = new Date();
  const user = await UserModel.findByIdAndUpdate(userId, { $set }, { new: true }).select("emailPrefs");
  return prefsOf(user);
}
