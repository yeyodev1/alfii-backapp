/**
 * Parser puro del export de texto de WhatsApp ("Exportar chat > Sin archivos").
 *
 * Sin dependencias ni I/O a proposito: recibe el texto crudo y devuelve
 * mensajes atribuidos. Toda la politica (limite de participantes, mapeo
 * her/him, resumen) vive en import.service; aqui solo se parsea y filtra.
 *
 * Soporta los dos formatos que genera WhatsApp:
 *   Android: `12/1/24, 9:45 p. m. - Nombre: mensaje`
 *   iOS:     `[12/1/24, 21:45:12] Nombre: mensaje`
 */

export interface ParsedMessage {
  sender: string;
  text: string;
  /** null si la fecha no se pudo interpretar; el orden del archivo manda. */
  at: Date | null;
}

export interface ParsedChat {
  participants: string[];
  messages: ParsedMessage[];
  stats: {
    total: number;
    byParticipant: Record<string, number>;
    /** Lineas de multimedia reemplazadas por marcador posicional. */
    mediaFiltered: number;
    /** Lineas de sistema (cifrado, llamadas, cambios de grupo) descartadas. */
    systemDropped: number;
  };
}

// Cabeceras. El nombre NO puede contener ":" (WhatsApp lo garantiza) y el
// mensaje puede estar vacio (linea de solo multimedia).
const ANDROID_HEADER =
  /^(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}),?\s+(\d{1,2}:\d{2})\s*([ap]\.?\s?m\.?)?\s+-\s+(.*)$/i;
const IOS_HEADER =
  /^\[(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([ap]\.?\s?m\.?)?\]\s+(.*)$/i;

/** Lineas de sistema: no aportan senal y ensucian el hilo. Se descartan. */
const SYSTEM_PATTERNS: RegExp[] = [
  /cifrad[oa]s? de extremo a extremo/i,
  /end-to-end encrypted/i,
  /eliminaste este mensaje/i,
  /se elimin[oó] este mensaje/i,
  /this message was deleted/i,
  /you deleted this message/i,
  /llamada (de voz|de video)? ?perdida/i,
  /missed (voice|video) call/i,
  /videollamada perdida/i,
  /cambi[oó] (el asunto|el [ií]cono|la descripci[oó]n|tu c[oó]digo de seguridad)/i,
  /a[nñ]adi[oó] a|sali[oó] del grupo|te a[nñ]adi[oó]|cre[oó] el grupo/i,
  /los mensajes temporales/i,
  /uni[oó] usando el enlace/i,
];

/**
 * Multimedia -> marcador posicional. Se conserva la POSICION porque un
 * "[foto]" en medio de una discusion es senal (igual que hace el extractor de
 * vision con las capturas); lo que se descarta es el peso del adjunto.
 */
const MEDIA_PATTERNS: { re: RegExp; marker: string }[] = [
  { re: /<multimedia omitido>|<media omitted>/i, marker: "[archivo]" },
  { re: /imagen omitida|image omitted/i, marker: "[foto]" },
  { re: /video omitido|video omitted/i, marker: "[video]" },
  { re: /audio omitido|audio omitted/i, marker: "[audio]" },
  { re: /sticker omitido|sticker omitted/i, marker: "[sticker]" },
  { re: /gif omitido|gif omitted/i, marker: "[gif]" },
  { re: /documento omitido|document omitted/i, marker: "[documento]" },
  { re: /ubicaci[oó]n:|location:/i, marker: "[ubicacion]" },
  { re: /\(archivo adjuntado\)|\(file attached\)|<attached:/i, marker: "[archivo]" },
  { re: /^[\w\-]+\.(opus|jpe?g|png|webp|mp4|m4a|aac|pdf|vcf)\b/i, marker: "[archivo]" },
];

/** WhatsApp mete marcas invisibles (U+200E/U+200F) y espacios raros (U+202F)
 *  que rompen las regex si no se normalizan primero. */
function normalizeLine(line: string): string {
  return line
    .replace(/^﻿/, "")
    .replace(/[‎‏⁨⁩]/g, "")
    .replace(/[  ]/g, " ")
    .trimEnd();
}

function parseTimestamp(date: string, time: string, meridiem?: string): Date | null {
  // Locale hispano: dia/mes/anio. La ambiguedad d/m vs m/d es de bajo riesgo:
  // el timestamp solo ordena y da sabor al resumen, no decide nada.
  const dm = date.split(/[\/.\-]/).map((p) => Number(p));
  if (dm.length !== 3 || dm.some((n) => Number.isNaN(n))) return null;
  const [day, month, rawYear] = dm as [number, number, number];
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;

  const tm = time.split(":").map((p) => Number(p));
  let hours = tm[0] ?? 0;
  const minutes = tm[1] ?? 0;
  const seconds = tm[2] ?? 0;

  if (meridiem) {
    const isPm = /p/i.test(meridiem);
    if (isPm && hours < 12) hours += 12;
    if (!isPm && hours === 12) hours = 0;
  }

  const parsed = new Date(year, month - 1, day, hours, minutes, seconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function matchHeader(
  line: string
): { date: string; time: string; meridiem?: string; rest: string } | null {
  const android = ANDROID_HEADER.exec(line);
  if (android) {
    return { date: android[1]!, time: android[2]!, meridiem: android[3], rest: android[4]! };
  }
  const ios = IOS_HEADER.exec(line);
  if (ios) {
    return { date: ios[1]!, time: ios[2]!, meridiem: ios[3], rest: ios[4]! };
  }
  return null;
}

function isSystemLine(text: string): boolean {
  return SYSTEM_PATTERNS.some((re) => re.test(text));
}

function replaceMedia(text: string): { text: string; wasMedia: boolean } {
  for (const { re, marker } of MEDIA_PATTERNS) {
    if (re.test(text)) return { text: marker, wasMedia: true };
  }
  return { text, wasMedia: false };
}

export function parseWhatsAppExport(raw: string): ParsedChat {
  const lines = raw.split(/\r?\n/);

  const messages: ParsedMessage[] = [];
  const byParticipant: Record<string, number> = {};
  let mediaFiltered = 0;
  let systemDropped = 0;
  let current: ParsedMessage | null = null;

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line.trim()) continue;

    const header = matchHeader(line);

    if (!header) {
      // Continuacion multilinea del mensaje anterior
      if (current) current.text = `${current.text}\n${line.trim()}`.slice(0, 4000);
      continue;
    }

    // Cabecera nueva: cerrar el mensaje en curso
    if (current) {
      messages.push(current);
      current = null;
    }

    const colonIdx = header.rest.indexOf(": ");
    if (colonIdx === -1) {
      // Cabecera sin "Nombre:" = linea de sistema del grupo/chat
      systemDropped += 1;
      continue;
    }

    const sender = header.rest.slice(0, colonIdx).trim();
    const body = header.rest.slice(colonIdx + 2).trim();

    if (!sender || isSystemLine(body)) {
      systemDropped += 1;
      continue;
    }

    const { text, wasMedia } = replaceMedia(body);
    if (wasMedia) mediaFiltered += 1;

    current = {
      sender,
      text,
      at: parseTimestamp(header.date, header.time, header.meridiem),
    };
    byParticipant[sender] = (byParticipant[sender] ?? 0) + 1;
  }

  if (current) messages.push(current);

  // Rachas de marcadores seguidos del mismo remitente se colapsan en uno:
  // "envio 14 fotos" no merece 14 lineas de presupuesto de contexto.
  const collapsed: ParsedMessage[] = [];
  for (const msg of messages) {
    const prev = collapsed[collapsed.length - 1];
    const isMarker = /^\[[a-z]+\]$/.test(msg.text);
    if (prev && isMarker && prev.sender === msg.sender && prev.text === msg.text) continue;
    collapsed.push(msg);
  }

  return {
    participants: Object.keys(byParticipant),
    messages: collapsed,
    stats: {
      total: collapsed.length,
      byParticipant,
      mediaFiltered,
      systemDropped,
    },
  };
}
