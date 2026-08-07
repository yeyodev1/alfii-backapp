import { Response, NextFunction } from "express";
import type { AuthRequest } from "../types/AuthRequest";
import { getUserCard } from "../services/card.service";

/**
 * Carta del usuario. Es de solo lectura y siempre se calcula al vuelo: no se
 * persiste nada porque la carta es una proyeccion del perfil, y guardarla
 * abriria la puerta a que muestre stats viejas justo despues de que el usuario
 * respondio un dato, que es el momento en el que la mecanica tiene que brillar.
 */
export async function getMyCard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await getUserCard(req.currentUser!));
  } catch (error) {
    next(error);
  }
}
