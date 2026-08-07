import { Response, NextFunction } from "express";
import { z } from "zod";
import type { AuthRequest } from "../types/AuthRequest";
import {
  createAnonymousSession,
  registerUser,
  loginUser,
  publicUser,
} from "../services/auth.service";
import { needsReacceptance, legalMeta } from "../services/legal.service";
import { PowerProfileModel } from "../models/powerProfile.model";
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
