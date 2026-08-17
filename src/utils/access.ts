import type { IUser } from "../models/user.model";

/**
 * ¿Este usuario tiene acceso de pago?
 *
 * PUNTO UNICO para cualquier gate de plan presente o futuro: pro pagado y VIP
 * (acceso regalado por el admin) son indistinguibles para el producto. Hoy
 * ningun feature bloquea por plan (los gates reales son por isAnonymous);
 * cuando exista el paywall, se consulta ESTA funcion y VIP pasa solo.
 *
 * El gasto de IA se registra igual para todos: VIP regala acceso, no
 * invisibilidad contable.
 */
export function hasPaidAccess(user: Pick<IUser, "plan" | "isVip">): boolean {
  return user.plan === "pro" || user.isVip === true;
}
