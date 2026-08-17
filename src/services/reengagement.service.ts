import { UserModel } from "../models/user.model";
import { sendReengagement } from "./mail/mail.service";

/**
 * Re-enganche por inactividad.
 *
 * Un cron de Vercel invoca runReengagementSweep() varias veces al dia en
 * horarios distintos: asi los correos llegan "esporadicamente" y no a la misma
 * hora exacta, pero cada usuario recibe como maximo UNO al dia.
 *
 * Secuencia por usuario: 3 correos — a los 3, 7 y 15 dias sin actividad.
 * Despues de la etapa 3 no se insiste mas (la cuenta no caduca y el correo es
 * el canal menos privado del producto: saturarlo quema la confianza). Si el
 * usuario vuelve a entrar, la secuencia se reinicia para su proxima ausencia.
 */

/** Dias de inactividad que disparan cada etapa (indice = etapa a enviar). */
const STAGE_AFTER_DAYS = [3, 7, 15];

/** Espaciado minimo entre correos al mismo usuario. 20h y no 24h: el cron no
 *  corre a horas fijas y con 24h exactas un envio se saltaria dias enteros. */
const MIN_GAP_MS = 20 * 60 * 60 * 1000;

/** Tope de envios por corrida: mantiene el barrido dentro del presupuesto de
 *  una invocacion serverless y de la cuota de Resend. Lo que no salga hoy
 *  sale en la siguiente corrida. */
const MAX_SENDS_PER_RUN = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SweepResult {
  scanned: number;
  sent: number;
  reset: number;
  skipped: number;
}

export async function runReengagementSweep(): Promise<SweepResult> {
  const now = Date.now();
  const oldestTrigger = new Date(now - STAGE_AFTER_DAYS[0] * DAY_MS);

  // Solo cuentas reales con correo: los anonimos no tienen a donde escribirles.
  const candidates = await UserModel.find({
    isAnonymous: false,
    email: { $exists: true, $ne: null },
    lastActiveAt: { $lte: oldestTrigger },
  })
    .select("email preferredName lastActiveAt reengagement")
    .limit(500)
    .lean();

  const result: SweepResult = { scanned: candidates.length, sent: 0, reset: 0, skipped: 0 };

  for (const user of candidates) {
    if (result.sent >= MAX_SENDS_PER_RUN) break;
    if (!user.email) continue;

    let stage = user.reengagement?.stage ?? 0;
    const lastSentAt = user.reengagement?.lastSentAt?.getTime();

    // El usuario volvio despues del ultimo correo: la secuencia se reinicia y
    // esta ausencia nueva arranca desde la etapa 0.
    if (lastSentAt && user.lastActiveAt.getTime() > lastSentAt) {
      await UserModel.updateOne(
        { _id: user._id },
        { $set: { "reengagement.stage": 0 } }
      );
      stage = 0;
      result.reset += 1;
    }

    // Secuencia completa: no se insiste mas.
    if (stage >= STAGE_AFTER_DAYS.length) {
      result.skipped += 1;
      continue;
    }

    const daysInactive = (now - user.lastActiveAt.getTime()) / DAY_MS;
    const dueDays = STAGE_AFTER_DAYS[stage];
    const gapOk = !lastSentAt || stage === 0 || now - lastSentAt >= MIN_GAP_MS;

    if (daysInactive < dueDays || !gapOk) {
      result.skipped += 1;
      continue;
    }

    const ok = await sendReengagement({
      to: user.email,
      name: user.preferredName,
      stage,
    });

    if (ok) {
      await UserModel.updateOne(
        { _id: user._id },
        { $set: { "reengagement.stage": stage + 1, "reengagement.lastSentAt": new Date() } }
      );
      result.sent += 1;
    } else {
      // Fallo puntual de Resend: no avanzamos la etapa, la proxima corrida
      // reintenta el mismo correo.
      result.skipped += 1;
    }
  }

  console.log(
    `[alfii:reengagement] scaneados=${result.scanned} enviados=${result.sent} reinicios=${result.reset} omitidos=${result.skipped}`
  );
  return result;
}
