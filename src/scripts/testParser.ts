/**
 * Prueba del parser de exports de WhatsApp. Sin test runner en el proyecto:
 * se ejecuta igual que testEngine con `npm run test:parser` y falla con exit 1
 * si alguna asercion no se cumple.
 */
import { parseWhatsAppExport } from "../utils/whatsappParser";

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FALLO  ${label}`, detail ?? "");
  }
}

// ---------------------------------------------------------------------------
// 1. Formato Android (es-EC) con multimedia, sistema y multilinea
// ---------------------------------------------------------------------------
const ANDROID = [
  "12/1/24, 9:40 p. m. - Los mensajes y las llamadas están cifrados de extremo a extremo.",
  "12/1/24, 9:45 p. m. - Diego: Hola, cómo estás?",
  "12/1/24, 9:47 p. m. - María Fernanda: Bien y tú?",
  "12/1/24, 9:48 p. m. - María Fernanda: <Multimedia omitido>",
  "12/1/24, 9:48 p. m. - María Fernanda: <Multimedia omitido>",
  "12/1/24, 9:50 p. m. - Diego: Jaja mira esto",
  "y esto sigue en otra línea",
  "12/1/24, 9:52 p. m. - María Fernanda: Eliminaste este mensaje",
  "13/1/24, 10:02 a. m. - Diego: IMG-2024.jpg (archivo adjuntado)",
  "13/1/24, 10:05 a. m. - María Fernanda: Qué risa 😂",
].join("\n");

console.log("\n[Android]");
const a = parseWhatsAppExport(ANDROID);
check("2 participantes", a.participants.length === 2, a.participants);
check("cifrado descartado", !a.messages.some((m) => /cifrad/i.test(m.text)));
check("eliminado descartado", !a.messages.some((m) => /eliminaste/i.test(m.text)));
check(
  "multimedia colapsado a un marcador",
  a.messages.filter((m) => m.text === "[archivo]" && m.sender === "María Fernanda").length === 1,
  a.messages.map((m) => m.text)
);
check(
  "multilinea unida",
  a.messages.some((m) => m.text.includes("Jaja mira esto\ny esto sigue")),
  a.messages.map((m) => m.text)
);
check("adjunto -> [archivo]", a.messages.some((m) => m.sender === "Diego" && m.text === "[archivo]"));
check("timestamp pm parseado", a.messages[0]!.at !== null && a.messages[0]!.at!.getHours() === 21);

// ---------------------------------------------------------------------------
// 2. Formato iOS con segundos y corchetes
// ---------------------------------------------------------------------------
const IOS = [
  "[12/1/24, 21:45:12] Diego: Hola",
  "[12/1/24, 21:46:00] Majo: Holaa",
  "[12/1/24, 21:47:30] Majo: audio omitido",
  "[13/1/24, 08:15:02] Diego: Buenos días",
].join("\n");

console.log("\n[iOS]");
const b = parseWhatsAppExport(IOS);
check("4 mensajes menos filtros", b.messages.length === 4, b.messages.length);
check("audio -> [audio]", b.messages.some((m) => m.text === "[audio]"));
check("hora 24h parseada", b.messages[0]!.at !== null && b.messages[0]!.at!.getHours() === 21);
check("conteo por participante", b.stats.byParticipant["Majo"] === 2, b.stats.byParticipant);

// ---------------------------------------------------------------------------
// 3. Grupo (3 participantes): el parser reporta, el service corta con 422
// ---------------------------------------------------------------------------
const GROUP = [
  "1/2/24, 10:00 - Ana: hola",
  "1/2/24, 10:01 - Luis: qué tal",
  "1/2/24, 10:02 - Pedro: buenas",
].join("\n");

console.log("\n[Grupo]");
const c = parseWhatsAppExport(GROUP);
check("3 participantes detectados", c.participants.length === 3, c.participants);

// ---------------------------------------------------------------------------
// 4. Marcas invisibles de WhatsApp (U+200E) no rompen el parseo
// ---------------------------------------------------------------------------
const LRM = "‎12/1/24, 9:45 p. m. - Diego: con marcas invisibles";
console.log("\n[Unicode]");
const d = parseWhatsAppExport(`${LRM}\n12/1/24, 9:46 p. m. - Majo: ok`);
check("linea con LRM parseada", d.messages.length === 2, d.messages);

console.log(failures ? `\n${failures} aserciones fallaron` : "\nTodo verde");
process.exit(failures ? 1 : 0);
