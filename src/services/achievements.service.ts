import { UserModel, type IUser } from "../models/user.model";
import { getUserCard } from "./card.service";
import { sendAchievement, sendProfileCompleted } from "./mail/mail.service";

/**
 * Avisos de logro por correo.
 *
 * Dos reglas que definen este archivo:
 *
 *  1. NUNCA se menciona a las chicas. Un logro habla del usuario y de su carta,
 *     jamas de un expediente, un nombre o un analisis. El correo es el canal
 *     menos privado que tenemos.
 *  2. Cada logro se avisa UNA sola vez. Se registra en user.notifiedAchievements
 *     antes de enviar, no despues: si el envio falla no se reintenta en bucle en
 *     cada peticion. Un correo perdido molesta menos que cinco repetidos.
 */

/** Un fallo aqui jamas puede tumbar la operacion que lo disparo. */
async function claim(user: IUser, key: string): Promise<boolean> {
  if (user.notifiedAchievements?.includes(key)) return false;

  const updated = await UserModel.findOneAndUpdate(
    { _id: user._id, notifiedAchievements: { $ne: key } },
    { $push: { notifiedAchievements: key } },
    { new: true }
  );

  // Si otro proceso lo reclamo primero, updated viene null y no se duplica.
  return !!updated;
}

const TIER_LABELS: Record<string, string> = {
  PLATA: "Has llegado a Plata",
  ORO: "Has llegado a Oro",
  LEYENDA: "Has llegado a Leyenda",
};

/**
 * Revisa si hay algo que celebrar y lo notifica.
 *
 * Se llama despues de completar el onboarding o de cerrar un bloque: son los
 * momentos en los que la carta puede haber cambiado de verdad.
 */
export async function checkAchievements(user: IUser): Promise<void> {
  if (!user.email || user.isAnonymous) return;
  if (user.emailPrefs?.achievements === false) return;

  try {
    const card = await getUserCard(user);

    if (card.completeness >= 100 && (await claim(user, "profile_complete"))) {
      await sendProfileCompleted({
        userId: String(user._id),
        to: user.email,
        name: user.preferredName,
        overall: card.overall,
        tier: card.tier,
      });
    }

    // Solo se avisan las subidas de categoria, no cada punto: un correo por
    // cada +1 de una stat seria spam de nuestra propia app.
    if (card.tier !== "BRONCE" && (await claim(user, `tier_${card.tier}`))) {
      await sendAchievement({
        userId: String(user._id),
        to: user.email,
        name: user.preferredName,
        title: TIER_LABELS[card.tier] ?? `Nueva categoria: ${card.tier}`,
        detail:
          `tu carta subio a ${card.overall} y entraste en ${card.tier}. ` +
          `Cada dato que sumas afina lo que te propongo.`,
      });
    }
  } catch (error: any) {
    console.error(`[alfii:achievements] fallo la revision: ${error?.message}`);
  }
}
