import type { Request } from "express";

/**
 * De donde llega la peticion, segun los headers del edge.
 *
 * Vercel manda x-vercel-ip-country (ISO-3166 de dos letras) y x-vercel-ip-city
 * (URI-encoded); Cloudflare manda cf-ipcountry. En local no llega ninguno y la
 * funcion devuelve null: el flujo debe funcionar igual sin pista.
 *
 * Es una PISTA, no un hecho: VPNs y proxies mienten. Por eso el dato se guarda
 * sin confirmar y es el usuario quien lo confirma en conversacion.
 */
export interface GeoHint {
  country?: string;
  city?: string;
}

const REGION_NAMES = (() => {
  try {
    return new Intl.DisplayNames(["es"], { type: "region" });
  } catch {
    return null;
  }
})();

function header(req: Request, name: string): string {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

export function requestGeo(req: Request): GeoHint | null {
  const iso = (header(req, "x-vercel-ip-country") || header(req, "cf-ipcountry")).toUpperCase();
  const rawCity = header(req, "x-vercel-ip-city");

  if (!iso || iso === "XX" || iso === "T1") return null;

  let country = iso;
  try {
    country = REGION_NAMES?.of(iso) ?? iso;
  } catch {
    // ISO invalido: se queda el codigo crudo, que sigue siendo una pista util
  }

  let city: string | undefined;
  if (rawCity) {
    try {
      city = decodeURIComponent(rawCity);
    } catch {
      city = rawCity;
    }
  }

  return { country, city };
}
