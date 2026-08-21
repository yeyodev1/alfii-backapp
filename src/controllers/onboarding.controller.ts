import { isValidTimeZone, resolveTimeZone, nowLine } from "../utils/clock";
import { Response, NextFunction } from "express";
import { z } from "zod";
import type { AuthRequest } from "../types/AuthRequest";
import {
  onboardingOpener,
  onboardingTurn,
  profileCompleteness,
  buildIdentityMatrix,
} from "../services/onboarding.service";
import { PowerProfileModel } from "../models/powerProfile.model";
import { SKIPPABLE_FIELDS } from "../schemas/enums";
import { requestGeo } from "../utils/geo";
import { PERSONA_KEYS, PERSONAS, type PersonaKey } from "../prompts/personas";
import { UserModel } from "../models/user.model";
import { CustomError } from "../errors/customError.error";

export const onboardingBodySchema = z
  .object({
    message: z.string().trim().max(1200).optional(),
    chipSelection: z.array(z.string().max(60)).max(10).optional(),
    birthDate: z.string().optional(),
    skip: z.enum(SKIPPABLE_FIELDS).optional(),
  })
  .refine(
    (v) => !!(v.message || v.chipSelection?.length || v.birthDate || v.skip),
    "Necesito una respuesta, una seleccion, una fecha o una omision."
  );

export async function opener(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingOpener(req.currentUser!));
  } catch (error) {
    next(error);
  }
}

export async function message(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(
      await onboardingTurn({
        user: req.currentUser!,
        message: req.body.message,
        chipSelection: req.body.chipSelection,
        birthDate: req.body.birthDate,
        skip: req.body.skip,
        geo: requestGeo(req),
      })
    );
  } catch (error) {
    next(error);
  }
}

export async function profile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const powerProfile = await PowerProfileModel.findOne({ userId: req.currentUser!._id });
    if (!powerProfile) throw new CustomError("Perfil no encontrado", 404);

    res.json({
      identityMatrix: buildIdentityMatrix(req.currentUser!, powerProfile),
      completeness: profileCompleteness(req.currentUser!, powerProfile),
      seenLessons: powerProfile.education.seenLessons,
    });
  } catch (error) {
    next(error);
  }
}

export async function completeness(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const powerProfile = await PowerProfileModel.findOne({ userId: req.currentUser!._id });
    res.json(profileCompleteness(req.currentUser!, powerProfile));
  } catch (error) {
    next(error);
  }
}

export const personaSchema = z.object({ persona: z.enum(PERSONA_KEYS).nullable() });

/** Con que voz le habla Alfii. null vuelve a la voz por defecto. */
export async function setPersona(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const persona = req.body.persona as PersonaKey | null;
    await UserModel.updateOne(
      { _id: req.currentUser!._id },
      persona ? { $set: { alfiiPersona: persona } } : { $unset: { alfiiPersona: 1 } }
    );
    res.json({ ok: true, persona: persona ? PERSONAS[persona].label : null });
  } catch (error) {
    next(error);
  }
}

export const timezoneSchema = z.object({ timezone: z.string().min(1).max(64).nullable() });

/** Zona horaria del usuario. null vuelve al default (Ecuador). */
export async function setTimezone(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const tz = req.body.timezone as string | null;
    if (tz && !isValidTimeZone(tz)) throw new CustomError("Zona horaria invalida.", 400);
    await UserModel.updateOne(
      { _id: req.currentUser!._id },
      tz ? { $set: { timezone: tz } } : { $unset: { timezone: 1 } }
    );
    res.json({ timezone: resolveTimeZone(tz), now: nowLine(tz) });
  } catch (error) {
    next(error);
  }
}

export const lessonSeenSchema = z.object({ lessonId: z.string().min(1).max(40) });

export async function markLessonSeen(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await PowerProfileModel.updateOne(
      { userId: req.currentUser!._id },
      {
        $addToSet: { "education.seenLessons": req.body.lessonId },
        $set: { "education.lastLessonAt": new Date() },
      }
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}
