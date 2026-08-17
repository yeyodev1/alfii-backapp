import { findCatalogModel } from "./catalog";

/**
 * Tabla de precios por modelo, en USD por MILLON de tokens.
 *
 * Fuente: los mismos precios documentados en config/env.ts al elegir cada
 * modelo. Se busca por PREFIJO y gana la primera coincidencia, asi que lo mas
 * especifico va arriba (flash-lite antes que flash). Cuando un proveedor
 * cambie tarifas, se actualiza AQUI y el costo de las llamadas nuevas sale
 * bien; las viejas conservan el costo con el que se registraron.
 */
const PRICES: [prefix: string, inPerM: number, outPerM: number][] = [
  // Gemini (ai.google.dev/gemini-api/docs/pricing)
  ["gemini-2.5-flash-lite", 0.1, 0.4],
  ["gemini-2.5-flash", 0.3, 2.5],
  ["gemini-3-flash-preview", 0.5, 3.0],
  ["gemini-3.6-flash", 1.5, 7.5],

  // OpenAI (platform.openai.com/docs/pricing)
  ["gpt-5.6-luna", 0.2, 1.2],
  ["gpt-5.6-terra", 2.5, 10.0],
  ["gpt-5.4-nano", 0.2, 1.25],
  ["gpt-5.4-mini", 0.75, 4.5],

  // DeepSeek (api-docs.deepseek.com/quick_start/pricing) — precio de cache
  // MISS: el hit es 50x mas barato, asi que esto es techo, no promedio.
  ["deepseek-v4-flash", 0.14, 0.28],
  ["deepseek-v4-pro", 0.435, 0.87],
];

/** Respaldo para modelos sin fila: mejor un costo aproximado que un cero. */
const FALLBACK: [number, number] = [0.5, 2.0];

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  // El catalogo (services/ai/catalog.ts) es la fuente primaria de precios: es
  // el mismo que ve el portal admin, asi que costo mostrado y costo calculado
  // no pueden divergir. La tabla local de arriba queda de respaldo historico.
  const inCatalog = findCatalogModel(model);
  if (inCatalog) {
    return (inputTokens * inCatalog.inPerM + outputTokens * inCatalog.outPerM) / 1_000_000;
  }

  const row = PRICES.find(([prefix]) => model.startsWith(prefix));
  const [inPerM, outPerM] = row ? [row[1], row[2]] : FALLBACK;
  return (inputTokens * inPerM + outputTokens * outPerM) / 1_000_000;
}
