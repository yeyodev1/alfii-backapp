import crypto from "crypto";
import { DISCLAIMER_SECTIONS, PLAIN_SUMMARY, type LegalSection } from "./disclaimer";
import { TERMS_SECTIONS } from "./terms";
import { PRIVACY_SECTIONS } from "./privacy";
import { REGIONAL_ANNEXES, detectRegion, type RegionalAnnex } from "./regional";
import { env } from "../env";

/**
 * Version legal. Cambiar cualquier texto de los documentos obliga a subir esta
 * fecha: al hacerlo, el docHash cambia y todos los usuarios reciben el modal de
 * re-aceptacion en su siguiente ingreso.
 *
 * Lo que sostiene una disputa no es que el usuario aceptara, es poder probar
 * QUE VERSION EXACTA acepto y cuando. Sin docHash no se puede probar.
 */
// 2026-08-07: cambia el tratamiento de capturas (pasan a conservarse en el
// expediente) y se anaden OpenAI y Cloudinary como encargados. Es un cambio
// material: obliga a reaceptacion, por eso sube la version.
export const LEGAL_VERSION = "2026-08-07";

export interface LegalDocument {
  version: string;
  docHash: string;
  publishedAt: string;
  operator: string;
  jurisdiction: string;
  contact: { privacy: string; legal: string };
  plainSummary: typeof PLAIN_SUMMARY;
  documents: {
    disclaimer: { title: string; sections: LegalSection[] };
    terms: { title: string; sections: LegalSection[] };
    privacy: { title: string; sections: LegalSection[] };
  };
  annexes: RegionalAnnex[];
}

let cached: LegalDocument | null = null;

export function getCurrentLegal(): LegalDocument {
  if (cached) return cached;

  const documents = {
    disclaimer: { title: "Descargo de Responsabilidad", sections: DISCLAIMER_SECTIONS },
    terms: { title: "Terminos de Uso", sections: TERMS_SECTIONS },
    privacy: { title: "Aviso de Privacidad", sections: PRIVACY_SECTIONS },
  };

  const canonical = JSON.stringify({
    version: LEGAL_VERSION,
    documents,
    annexes: REGIONAL_ANNEXES,
    plainSummary: PLAIN_SUMMARY,
  });

  cached = {
    version: LEGAL_VERSION,
    docHash: crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32),
    publishedAt: `${LEGAL_VERSION}T00:00:00.000Z`,
    operator: env.LEGAL_OPERATOR,
    jurisdiction: "EC",
    contact: { privacy: env.LEGAL_CONTACT_PRIVACY, legal: env.LEGAL_CONTACT_LEGAL },
    plainSummary: PLAIN_SUMMARY,
    documents,
    annexes: REGIONAL_ANNEXES,
  };

  return cached;
}

export { detectRegion };
export type { LegalSection, RegionalAnnex };
