/**
 * Reloj del usuario.
 *
 * El modelo no tiene nocion de "ahora": sin esto lee un "ayer" de una captura
 * sin saber que dia es hoy, o recomienda "escribe a las 18:00" sin saber si
 * ya pasaron. Cada prompt lleva la hora actual en la zona del usuario.
 * Por defecto Ecuador (el mercado principal); se cambia en Ajustes.
 */
export const DEFAULT_TIMEZONE = "America/Guayaquil";

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== "string" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("es-EC", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
}

/** Offset tipo "UTC-5" para la zona en este instante. */
export function utcOffsetLabel(tz: string, at = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  return raw.replace("GMT", "UTC");
}

export function formatNow(tz: string, at = new Date()): string {
  const date = new Intl.DateTimeFormat("es-EC", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(at);
  const time = new Intl.DateTimeFormat("es-EC", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  return `${date}, ${time}`;
}

/** Linea que va al prompt. Ej: "AHORA: viernes, 21 de agosto de 2026, 15:42 (America/Guayaquil, UTC-5)". */
export function nowLine(tz: string | null | undefined, at = new Date()): string {
  const zone = resolveTimeZone(tz);
  return `AHORA: ${formatNow(zone, at)} (${zone}, ${utcOffsetLabel(zone, at)})`;
}

/** Bloque completo con instrucciones de uso del reloj. */
export function clockLayer(tz: string | null | undefined, at = new Date()): string {
  return (
    `=== RELOJ ===\n${nowLine(tz, at)}\n` +
    `Toda hora o fecha de capturas, chats importados y mensajes se interpreta en esta zona. ` +
    `"Hoy", "ayer", "anoche" y "el viernes" se calculan desde AHORA. Antes de aconsejar cuando ` +
    `escribir, calcula cuanto tiempo paso desde el ultimo mensaje de ella y si la hora que propones ` +
    `ya paso. Nunca digas "esta noche" si ya es de madrugada ni "manana" si el dia acaba de cambiar.`
  );
}
