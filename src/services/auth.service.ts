import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { UserModel, IUser } from "../models/user.model";
import { PowerProfileModel } from "../models/powerProfile.model";
import { CustomError } from "../errors/customError.error";
import { getCurrentLegal } from "./legal.service";

export interface TokenPayload {
  userId: string;
  email?: string;
  accountType: "anonymous" | "registered";
}

export function signToken(user: IUser): string {
  const payload: TokenPayload = {
    userId: String(user._id),
    email: user.email,
    accountType: user.isAnonymous ? "anonymous" : "registered",
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function hashIp(ip?: string): string | undefined {
  if (!ip) return undefined;
  // Se guarda el hash, nunca la IP en claro. El aviso de privacidad declara
  // que se registra para acreditar la aceptacion legal, no para rastrear.
  return crypto.createHash("sha256").update(`${ip}:${env.JWT_SECRET}`).digest("hex").slice(0, 32);
}

/**
 * Sesion anonima: permite la primera captura sin cuenta. El muro de registro
 * llega despues, cuando el usuario ya leyo su analisis.
 */
export async function createAnonymousSession() {
  const anonymousId = crypto.randomBytes(24).toString("base64url");
  const user = await UserModel.create({ anonymousId, isAnonymous: true });
  await PowerProfileModel.create({ userId: user._id });
  return { user, token: signToken(user) };
}

export interface RegisterInput {
  userId: string;
  email: string;
  password: string;
  confirm18: boolean;
  legalVersion: string;
  ip?: string;
  userAgent?: string;
  locale?: string;
}

/**
 * Convierte la sesion anonima en cuenta real conservando el expediente.
 * Solo correo y contrasena: nada de nombre, telefono ni tarjeta.
 */
export async function registerUser(input: RegisterInput) {
  const legal = getCurrentLegal();

  if (input.legalVersion !== legal.version) {
    throw new CustomError(
      "Los terminos se actualizaron. Vuelve a cargar la pagina para revisarlos.",
      409,
      { expected: legal.version, received: input.legalVersion }
    );
  }
  if (!input.confirm18) {
    throw new CustomError("Debes confirmar que tienes 18 anos o mas.", 400);
  }

  const email = input.email.trim().toLowerCase();
  const existing = await UserModel.findOne({ email });
  if (existing) {
    throw new CustomError("Ese correo ya tiene una cuenta. Inicia sesion.", 409);
  }

  const user = await UserModel.findById(input.userId);
  if (!user) throw new CustomError("Sesion no encontrada", 404);
  if (!user.isAnonymous) throw new CustomError("Esta sesion ya tiene cuenta.", 409);

  user.email = email;
  user.passwordHash = await bcrypt.hash(input.password, 12);
  user.isAnonymous = false;
  user.confirm18 = true;
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

  const profileExists = await PowerProfileModel.exists({ userId: user._id });
  if (!profileExists) await PowerProfileModel.create({ userId: user._id });

  return { user, token: signToken(user) };
}

export async function loginUser(email: string, password: string) {
  const user = await UserModel.findOne({ email: email.trim().toLowerCase() });
  if (!user || !user.passwordHash) {
    throw new CustomError("Correo o contrasena incorrectos.", 401);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new CustomError("Correo o contrasena incorrectos.", 401);

  user.lastActiveAt = new Date();
  await user.save();

  return { user, token: signToken(user) };
}

export function publicUser(user: IUser) {
  const legal = getCurrentLegal();
  const latest = user.legalAcceptances?.[user.legalAcceptances.length - 1];

  return {
    id: String(user._id),
    email: user.email ?? null,
    isAnonymous: user.isAnonymous,
    preferredName: user.preferredName ?? null,
    hasBirthDate: !!user.birthDate,
    plan: user.plan,
    analysisCount: user.analysisCount,
    legalUpToDate: latest?.version === legal.version,
  };
}
