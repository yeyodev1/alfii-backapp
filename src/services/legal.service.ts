import { UserModel, IUser } from "../models/user.model";
import { getCurrentLegal, detectRegion } from "../config/legal";
import { hashIp } from "./auth.service";
import { CustomError } from "../errors/customError.error";

export { getCurrentLegal, detectRegion };

export function legalMeta() {
  const legal = getCurrentLegal();
  return {
    version: legal.version,
    docHash: legal.docHash,
    publishedAt: legal.publishedAt,
    operator: legal.operator,
    jurisdiction: legal.jurisdiction,
    contact: legal.contact,
  };
}

export function needsReacceptance(user: IUser): boolean {
  if (user.isAnonymous) return false;
  const legal = getCurrentLegal();
  return !user.legalAcceptances?.some((a) => a.version === legal.version);
}

export async function recordAcceptance(input: {
  userId: string;
  version: string;
  ip?: string;
  userAgent?: string;
  locale?: string;
}) {
  const legal = getCurrentLegal();

  if (input.version !== legal.version) {
    throw new CustomError("Version legal desactualizada. Recarga la pagina.", 409, {
      expected: legal.version,
    });
  }

  const user = await UserModel.findById(input.userId);
  if (!user) throw new CustomError("Usuario no encontrado", 404);

  const already = user.legalAcceptances.some((a) => a.version === legal.version);
  if (!already) {
    user.legalAcceptances.push({
      version: legal.version,
      docHash: legal.docHash,
      acceptedAt: new Date(),
      ipHash: hashIp(input.ip),
      userAgent: input.userAgent?.slice(0, 240),
      locale: input.locale,
      jurisdiction: legal.jurisdiction,
    });
    await user.save();
  }

  return user.legalAcceptances;
}

/** Evidencia descargable para el usuario y para el operador. */
export function acceptanceReceipts(user: IUser) {
  return (user.legalAcceptances || []).map((a) => ({
    version: a.version,
    docHash: a.docHash,
    acceptedAt: a.acceptedAt,
    jurisdiction: a.jurisdiction,
    locale: a.locale,
  }));
}
