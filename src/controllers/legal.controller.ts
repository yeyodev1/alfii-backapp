import { Response, NextFunction } from "express";
import { z } from "zod";
import type { AuthRequest } from "../types/AuthRequest";
import {
  getCurrentLegal,
  legalMeta,
  recordAcceptance,
  acceptanceReceipts,
  detectRegion,
} from "../services/legal.service";
import { UserModel } from "../models/user.model";
import { PowerProfileModel } from "../models/powerProfile.model";
import { TargetModel } from "../models/target.model";
import { AnalysisModel } from "../models/analysis.model";
import { MessageModel } from "../models/message.model";
import { deriveAge } from "../utils/age";

export const acceptSchema = z.object({ version: z.string().min(1) });

/** Publico, sin auth: los documentos legales deben ser consultables por
 *  cualquiera antes de registrarse. */
export function current(req: AuthRequest, res: Response) {
  const legal = getCurrentLegal();
  const locale = (req.headers["accept-language"] as string)?.split(",")[0];

  res.json({
    ...legalMeta(),
    detectedRegion: detectRegion(locale),
    plainSummary: legal.plainSummary,
    documents: legal.documents,
    annexes: legal.annexes,
  });
}

export function meta(_req: AuthRequest, res: Response) {
  res.json(legalMeta());
}

export async function accept(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const acceptances = await recordAcceptance({
      userId: req.currentUser!._id.toString(),
      version: req.body.version,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      locale: (req.headers["accept-language"] as string)?.split(",")[0],
    });
    res.json({ acceptances: acceptances.map((a) => ({ version: a.version, acceptedAt: a.acceptedAt })) });
  } catch (error) {
    next(error);
  }
}

export function myAcceptances(req: AuthRequest, res: Response) {
  res.json({ acceptances: acceptanceReceipts(req.currentUser!) });
}

/**
 * Portabilidad. Es un derecho implementado en la aplicacion, no un correo a
 * atender: RGPD art. 20, CPRA y equivalentes en Latinoamerica.
 */
export async function exportData(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = req.currentUser!;
    const [profile, targets, analyses, messages] = await Promise.all([
      PowerProfileModel.findOne({ userId: user._id }).lean(),
      TargetModel.find({ userId: user._id }).lean(),
      AnalysisModel.find({ userId: user._id }).lean(),
      MessageModel.find({ userId: user._id }).sort({ createdAt: 1 }).lean(),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      notice:
        "Exportacion completa de tus datos en Alfii. Las capturas de pantalla no " +
        "figuran porque nunca se almacenaron: solo se conserva el texto extraido.",
      account: {
        email: user.email ?? null,
        preferredName: user.preferredName ?? null,
        birthDate: user.birthDate ?? null,
        derivedAge: deriveAge(user.birthDate),
        plan: user.plan,
        createdAt: user.createdAt,
        analysisCount: user.analysisCount,
        dataSkips: user.dataSkips,
      },
      legalAcceptances: acceptanceReceipts(user),
      identityMatrix: profile
        ? {
            status: profile.status,
            attractionAssets: profile.attractionAssets,
            philosophy: profile.philosophy,
            personalityStyle: profile.personalityStyle,
            // Ingresos y datos fisicos son de lo mas sensible que guardamos.
            // Omitirlos del export los volveria invisibles justo para quien
            // ejerce su derecho de acceso, que es cuando mas importan.
            income: profile.income ?? null,
            physique: profile.physique ?? null,
            frameScore: profile.frameScore,
            onboarding: profile.onboarding,
            education: profile.education,
          }
        : null,
      targets,
      analyses,
      messages,
    };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="alfii-mis-datos.json"');
    res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    next(error);
  }
}

/** Supresion. Inmediata y no reversible, como declara el aviso de privacidad. */
export async function purge(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = req.currentUser!;

    await Promise.all([
      MessageModel.deleteMany({ userId: user._id }),
      AnalysisModel.deleteMany({ userId: user._id }),
      TargetModel.deleteMany({ userId: user._id }),
      PowerProfileModel.deleteMany({ userId: user._id }),
    ]);

    // El registro de aceptacion legal se conserva por su valor probatorio,
    // desvinculado de todo dato de contenido. Asi lo declara el aviso.
    await UserModel.updateOne(
      { _id: user._id },
      {
        $set: {
          email: undefined,
          passwordHash: undefined,
          preferredName: undefined,
          birthDate: undefined,
          isAnonymous: true,
          analysisCount: 0,
          dataSkips: [],
        },
      }
    );

    res.json({ ok: true, message: "Todo borrado. No queda nada." });
  } catch (error) {
    next(error);
  }
}
