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

/** Carga el documento completo del usuario. Usar despues de authMiddleware. */
export async function loadUser(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (!req.user?.userId) throw new CustomError("No autenticado", 401);
    const user = await UserModel.findById(req.user.userId);
    if (!user) throw new CustomError("Sesion invalida", 401);
    req.currentUser = user;
    next();
  } catch (error) {
    next(error);
  }
}
