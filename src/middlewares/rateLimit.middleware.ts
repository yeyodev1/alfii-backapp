import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { AuthRequest } from "../types/AuthRequest";

/**
 * Clave por usuario, con fallback a IP normalizada.
 *
 * ipKeyGenerator no es opcional: sin el, un usuario con IPv6 puede saltarse el
 * limite rotando dentro de su propio bloque /64, que es enorme.
 */
const keyByUser = (req: AuthRequest) =>
  req.user?.userId ?? ipKeyGenerator(req.ip ?? "0.0.0.0");

/** Los analisis son la operacion caras: 10 por hora en v1. */
export const analysisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: keyByUser as any,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Llegaste al limite de analisis de esta hora. Vuelve en un rato.",
  },
});

/** El chat es barato pero no infinito. */
export const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  keyGenerator: keyByUser as any,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Vas muy rapido. Espera un momento." },
});

/** Anti fuerza bruta en autenticacion. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Demasiados intentos. Espera 15 minutos." },
});
