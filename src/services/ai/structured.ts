/**
 * Fachada historica del motor de modelo.
 *
 * Antes esto hablaba directo con Gemini. Ahora delega en el gateway, que elige
 * proveedor y hace failover. Se mantiene el nombre del modulo porque es el
 * punto de entrada que usan chat, analisis, vision y onboarding.
 */
export {
  generateStructured,
  streamText as generateTextStream,
  providerChain,
  logProviderChain,
  CLINICAL_REFRAME,
} from "./gateway";

export type { StreamMeta } from "./gateway";
export type { AiPart, AiTask, StructuredResult, ProviderName } from "./types";
