import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env";
import { activeModel } from "../modelConfig.service";
import type { AiTask } from "./types";

export const genai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

/**
 * Antes era un mapa constante leido del env al importar: cambiar de modelo
 * exigia redeploy. Ahora consulta la configuracion runtime (portal admin) con
 * el env como fallback. Funcion y no objeto para que cada llamada vea el
 * valor vigente.
 */
export function geminiModelFor(task: AiTask): string {
  return activeModel("gemini", task);
}

/**
 * Ajustes de seguridad.
 *
 * El producto analiza subtexto de conversaciones adultas y detecta senales de
 * riesgo. Con los umbrales por defecto, Gemini bloquea respuestas legitimas en
 * el momento critico. Se relajan las categorias que producen falsos positivos
 * en este dominio y se mantiene el bloqueo de contenido peligroso real.
 */
export const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
] as any;

/**
 * Advertencia de arranque sobre la capa de la API.
 *
 * En la capa GRATUITA de la API de Gemini, Google usa los prompts y las
 * respuestas para mejorar sus productos y personal humano puede revisarlos.
 * Este producto promete confidencialidad y procesa conversaciones intimas de
 * terceros: con una key de capa gratuita, esa promesa es falsa y el anexo
 * europeo seria inexacto sobre el subencargado.
 *
 * No se puede detectar la capa por API, asi que se avisa de forma explicita
 * y ruidosa en cada arranque hasta que se confirme por variable de entorno.
 */
export async function verifyGeminiTier() {
  if (process.env.GEMINI_BILLING_CONFIRMED === "true") {
    console.log("[gemini] capa de pago confirmada por entorno");
    return;
  }

  console.warn(
    [
      "",
      "  ============================================================",
      "  AVISO DE PRIVACIDAD - CAPA DE LA API DE GEMINI",
      "  ============================================================",
      "  En la capa GRATUITA, Google usa los prompts y respuestas para",
      "  mejorar sus productos y personal humano puede revisarlos.",
      "",
      "  Alfii promete confidencialidad y procesa conversaciones de",
      "  terceros. Con capa gratuita esa promesa es FALSA.",
      "",
      "  Verifica que el proyecto de Google Cloud de esta key tenga",
      "  facturacion habilitada. Cuando lo confirmes, agrega:",
      "",
      "      GEMINI_BILLING_CONFIRMED=true",
      "",
      "  No proceses datos reales de usuarios hasta entonces.",
      "  ============================================================",
      "",
    ].join("\n")
  );
}

export function isBillingConfirmed(): boolean {
  return process.env.GEMINI_BILLING_CONFIRMED === "true";
}
