import type { Request } from "express";
import { CustomError } from "../errors/customError.error";

/**
 * Express 5 tipa req.params como string | string[]. Este helper normaliza y de
 * paso valida, para no repetir el casteo en cada controlador.
 */
export function param(req: Request, name: string): string {
  const raw = (req.params as Record<string, string | string[]>)[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw new CustomError(`Falta el parametro ${name}`, 400);
  return value;
}

export function queryString(req: Request, name: string): string | undefined {
  const raw = (req.query as Record<string, unknown>)[name];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return undefined;
}
