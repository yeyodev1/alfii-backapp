import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AuthRequest, JwtPayload } from "../types/AuthRequest";
import { UserModel } from "../models/user.model";
import { CustomError } from "../errors/customError.error";

/**
 * Auth opcional: permite la sesion anonima que hace posible la primera captura
 * sin cuenta. Si hay token valido, carga el usuario; si no, deja pasar.
 */
export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next();

  try {
    const decoded = jwt.verify(header.split(" ")[1], env.JWT_SECRET) as JwtPayload;
    req.user = decoded;
  } catch {
    // Token invalido o expirado en ruta opcional: se ignora y se sigue como anonimo.
  }
  next();
}

/**
 * Pulso de actividad: lastActiveAt alimenta el re-enganche por correo, asi que
 * debe reflejar CUALQUIER uso de la app, no solo login y analisis. Se escribe
 * como maximo una vez cada 30 min por usuario (cache en memoria por instancia;
 * en serverless cada instancia tiene el suyo — de sobra para esta señal).
 */
const TOUCH_INTERVAL_MS = 30 * 60 * 1000;
const lastTouch = new Map<string, number>();

function touchActivity(userId: string, current: Date) {
  const now = Date.now();
  const cached = lastTouch.get(userId) ?? current.getTime();
  if (now - cached < TOUCH_INTERVAL_MS) return;
  lastTouch.set(userId, now);
  // Fire-and-forget: el pulso jamas bloquea ni tumba la peticion que lo genero.
  UserModel.updateOne({ _id: userId }, { $set: { lastActiveAt: new Date() } }).catch(() => {});
}

/** Carga el documento completo del usuario. Usar despues de authMiddleware. */
export async function loadUser(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (!req.user?.userId) throw new CustomError("No autenticado", 401);
    const user = await UserModel.findById(req.user.userId);
    if (!user) throw new CustomError("Sesion invalida", 401);
    req.currentUser = user;
    touchActivity(String(user._id), user.lastActiveAt);
    next();
  } catch (error) {
    next(error);
  }
}
