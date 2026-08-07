import type { AnalysisPayload } from "../schemas/analysis.schema";
import type { ScriptStyle } from "../schemas/enums";

/**
 * Gating de scripts para usuarios anonimos.
 *
 * PORQUE existe este archivo y no una condicion dentro de cada handler: la regla
 * es de seguridad, no de presentacion. Si se duplica en analyzeFirst, getAnalysis
 * y en el siguiente endpoint que alguien agregue, tarde o temprano una copia se
 * queda sin actualizar y filtra los scripts pagados. Una sola funcion pura, sin
 * acceso a req ni a Mongo, es auditable de un vistazo y testeable sin servidor.
 */

/** Forma de un script ya pasado por el gate. text/rationale van a null cuando
 *  esta bloqueado: el campo existe para que el cliente no tenga que ramificar,
 *  pero viaja vacio. */
export interface GatedScript {
  style: ScriptStyle;
  text: string | null;
  rationale: string | null;
  locked: boolean;
  teaser?: string;
}

export interface ScriptLockInfo {
  scriptsLocked: number;
  reason: "anonymous";
  cta: string;
}

export type GatedAnalysisPayload = Omit<AnalysisPayload, "scripts"> & {
  scripts: GatedScript[];
  locked?: ScriptLockInfo;
};

/**
 * Teasers fijos por estilo.
 *
 * PORQUE son constantes y no un recorte del script real: cualquier fragmento del
 * texto generado (primeras palabras, resumen, longitud) es informacion que el
 * usuario no pago. Estas frases describen el estilo, no el contenido, asi que
 * son seguras de emitir aunque el script hable de algo sensible.
 */
const STYLE_TEASERS: Record<ScriptStyle, string> = {
  PODER: "Respuesta directa que fija el marco sin pedir permiso",
  CABALLERO: "Respuesta calibrada para sonar calido sin perder el marco",
  PICARO: "Respuesta con humor y tension, ligera pero con intencion",
};

const LOCK_CTA = "Crea tu cuenta para desbloquear las otras dos respuestas";

/**
 * Devuelve el payload listo para serializar al cliente.
 *
 * PORQUE se reconstruyen los objetos en vez de mutar el payload recibido: el
 * mismo objeto se guarda completo en Mongo y se reutiliza en otros puntos del
 * request. Mutarlo aqui borraria los scripts reales de la persistencia. El
 * bloqueo es de transporte, el documento guardado siempre queda intacto.
 */
export function gateScriptsForAnonymous(
  payload: AnalysisPayload,
  isAnonymous: boolean
): GatedAnalysisPayload {
  const scripts = payload?.scripts ?? [];

  // Usuario registrado: pasa todo, pero con `locked` explicito para que el
  // cliente tenga una sola forma de respuesta y no infiera por ausencia.
  if (!isAnonymous) {
    return {
      ...payload,
      scripts: scripts.map((script) => ({
        style: script.style,
        text: script.text,
        rationale: script.rationale,
        locked: false,
      })),
    };
  }

  const gated: GatedScript[] = scripts.map((script, index) =>
    index === 0
      ? {
          style: script.style,
          text: script.text,
          rationale: script.rationale,
          locked: false,
        }
      : {
          // Nunca se copia script.text ni script.rationale en esta rama.
          style: script.style,
          text: null,
          rationale: null,
          locked: true,
          teaser: STYLE_TEASERS[script.style] ?? "Respuesta alternativa calibrada para este momento",
        }
  );

  const lockedCount = gated.filter((script) => script.locked).length;

  // Si por lo que sea vino un solo script, no hay nada bloqueado y no se emite
  // el bloque `locked`: mostrar un CTA sin nada detras erosiona la confianza.
  if (!lockedCount) return { ...payload, scripts: gated };

  return {
    ...payload,
    scripts: gated,
    locked: { scriptsLocked: lockedCount, reason: "anonymous", cta: LOCK_CTA },
  };
}
