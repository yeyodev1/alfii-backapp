import { Response, NextFunction } from "express";
import { z } from "zod";
import type { AuthRequest } from "../types/AuthRequest";
import {
  createAnonymousSession,
  registerUser,
  loginUser,
  publicUser,
  requestPasswordReset,
  resetPassword,
  changePassword,
} from "../services/auth.service";
import { needsReacceptance, legalMeta } from "../services/legal.service";
import { PowerProfileModel } from "../models/powerProfile.model";
import { UserModel } from "../models/user.model";
import { CustomError } from "../errors/customError.error";
import { prefsOf, requireUserByToken, updatePrefs } from "../services/emailPrefs.service";
import { profileCompleteness } from "../services/onboarding.service";

export const registerBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.string().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Correo invalido")),
  password: z
    .string()
    .min(8, "La contrasena necesita al menos 8 caracteres")
    .max(128),
  confirm18: z.literal(true, { message: "Debes confirmar que tienes 18 anos o mas" }),
  legalVersion: z.string().min(1),
});

export const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1),
});

export async function anonymous(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { user, token } = await createAnonymousSession();
    res.status(201).json({ token, user: publicUser(user), legal: legalMeta() });
  } catch (error) {
    next(error);
  }
}

export async function register(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { user, token } = await registerUser({
      userId: req.user!.userId,
      email: req.body.email,
      password: req.body.password,
      confirm18: req.body.confirm18,
      legalVersion: req.body.legalVersion,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      locale: (req.headers["accept-language"] as string)?.split(",")[0],
    });
    res.status(201).json({ token, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
}

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(160),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8, "La contrasena necesita al menos 8 caracteres").max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8, "La contrasena necesita al menos 8 caracteres").max(128),
});

/**
 * Pide el enlace de recuperacion.
 *
 * Responde 200 siempre, exista o no la cuenta: contestar distinto convertiria
 * este endpoint en un buscador de quien usa Alfii.
 */
export async function forgotPassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await requestPasswordReset(req.body.email);
    res.json({
      ok: true,
      message: "Si ese correo tiene cuenta, te llega un enlace en un minuto.",
    });
  } catch (error) {
    next(error);
  }
}

export async function resetPasswordHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { user, token } = await resetPassword(req.body.token, req.body.password);
    res.json({ token, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
}

export async function changePasswordHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { user, token } = await changePassword({
      userId: req.currentUser!._id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
    });
    res.json({ token, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
}

export async function login(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { user, token } = await loginUser(req.body.email, req.body.password);
    res.json({
      token,
      user: publicUser(user),
      needsLegalReacceptance: needsReacceptance(user),
    });
  } catch (error) {
    next(error);
  }
}

export async function me(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = req.currentUser!;
    const profile = await PowerProfileModel.findOne({ userId: user._id });

    res.json({
      user: publicUser(user),
      needsLegalReacceptance: needsReacceptance(user),
      onboarding: {
        completed: profile?.onboarding.completed ?? false,
        currentStep: profile?.onboarding.currentStep ?? 0,
      },
      completeness: profileCompleteness(user, profile),
    });
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Correos: preferencias (con sesion) y baja con un clic (con token del correo)
// ---------------------------------------------------------------------------
export const emailPrefsSchema = z.object({
  reengagement: z.boolean().optional(),
  achievements: z.boolean().optional(),
});

export async function patchEmailPrefs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.currentUser!.isAnonymous) throw new CustomError("Necesitas una cuenta con correo.", 400);
    const prefs = await updatePrefs(req.currentUser!._id, req.body);
    res.json({ emailPrefs: prefs });
  } catch (error) {
    next(error);
  }
}

/** Lectura publica por token: que correos tiene activos este usuario. */
export async function emailPrefsByToken(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await requireUserByToken(String(req.query.u ?? ""), String(req.query.t ?? ""));
    res.json({ email: maskEmail(user.email ?? ""), emailPrefs: prefsOf(user) });
  } catch (error) {
    next(error);
  }
}

export const emailPrefsTokenSchema = z.object({
  u: z.string().min(1),
  t: z.string().min(1),
  reengagement: z.boolean().optional(),
  achievements: z.boolean().optional(),
  /** Atajo: baja de todo con un clic. */
  all: z.boolean().optional(),
});

export async function setEmailPrefsByToken(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await requireUserByToken(req.body.u, req.body.t);
    const patch = req.body.all === false
      ? { reengagement: false, achievements: false }
      : req.body.all === true
        ? { reengagement: true, achievements: true }
        : { reengagement: req.body.reengagement, achievements: req.body.achievements };
    const prefs = await updatePrefs(user._id, patch);
    res.json({ email: maskEmail(user.email ?? ""), emailPrefs: prefs });
  } catch (error) {
    next(error);
  }
}

function maskEmail(email: string): string {
  const [u, d] = email.split("@");
  if (!u || !d) return email;
  return `${u.slice(0, 2)}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
}

export const whatsappWaitlistSchema = z.object({ join: z.boolean() });

export async function setWhatsappWaitlist(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.currentUser!.isAnonymous) throw new CustomError("Necesitas una cuenta con correo para avisarte.", 400);
    await UserModel.findByIdAndUpdate(req.currentUser!._id, {
      $set: { whatsappWaitlist: { joined: req.body.join === true, at: new Date() } },
    });
    res.json({ whatsappWaitlist: req.body.join === true });
  } catch (error) {
    next(error);
  }
}
