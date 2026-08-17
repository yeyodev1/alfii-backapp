import { geminiModelFor } from "./gemini.client";
import type { ITarget } from "../../models/target.model";

/**
 * Router de modelo por costo.
 *
 * `pro` cuesta aproximadamente 8-10x mas que `flash`. En una pregunta como
 * "le escribo hoy?" la diferencia de calidad es marginal; en un analisis de
 * subtexto es todo. Sin este router, cada mensaje casual se paga como un
 * analisis completo.
 *
 * Se escala a `pro` cuando:
 *  - hay imagen (siempre)
 *  - el riesgo del expediente es ALTO o ABORTAR
 *  - la pregunta pide estrategia (longitud + intencion)
 *  - el usuario lo forzo con el boton "analizar en profundidad"
 */

const STRATEGY_SIGNALS = [
  /\bque\s+(le\s+)?(escribo|digo|respondo|contesto)\b/i,
  /\bcomo\s+(le\s+)?(respondo|contesto|escribo|manejo|abordo)\b/i,
  /\bque\s+hago\b/i,
  /\bestrategia\b/i,
  /\bconviene\b/i,
  /\bdeberia\b/i,
  /\bme\s+esta\s+(usando|probando|testeando)\b/i,
  /\bred\s+flag\b/i,
  /\bpierdo\s+el\s+tiempo\b/i,
  /\bse\s+enfrio\b/i,
  /\bcita\b/i,
  /\bignor(a|o|ando)\b/i,
];

export type ModelChoice = {
  model: string;
  tier: "flash" | "pro";
  reason: string;
};

export function routeModel(input: {
  hasImage: boolean;
  forceDeep?: boolean;
  message?: string;
  target?: ITarget | null;
}): ModelChoice {
  if (input.hasImage) {
    return { model: geminiModelFor("analysis"), tier: "pro", reason: "captura" };
  }
  if (input.forceDeep) {
    return { model: geminiModelFor("analysis"), tier: "pro", reason: "forzado_por_usuario" };
  }

  const level = input.target?.riskProfile?.level;
  if (level === "ALTO" || level === "ABORTAR") {
    return { model: geminiModelFor("analysis"), tier: "pro", reason: `riesgo_${level}` };
  }

  const message = input.message ?? "";
  const isStrategic = STRATEGY_SIGNALS.some((rx) => rx.test(message));
  const isLong = message.length > 220;

  if (isStrategic || isLong) {
    return { model: geminiModelFor("analysis"), tier: "pro", reason: isStrategic ? "intencion" : "longitud" };
  }

  return { model: geminiModelFor("chat"), tier: "flash", reason: "conversacion" };
}
