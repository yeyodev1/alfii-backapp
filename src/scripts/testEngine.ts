/**
 * Prueba del motor sin tocar la base de datos.
 *
 * Es la puerta de decision del proyecto: valida que Gemini produzca un analisis
 * a la altura del prompt ANTES de construir nueve pantallas encima.
 *
 *   pnpm test:engine
 */
import "dotenv/config";
import { generateStructured, logProviderChain } from "../services/ai/structured";
import { BUNKER_SYSTEM } from "../prompts/bunker.system";
import { analysisPayloadSchema, analysisResponseSchema } from "../schemas/analysis.schema";
import { ARCHETYPE_LABELS, SCRIPT_STYLES } from "../schemas/enums";

const FAKE_IDENTITY = `=== MATRIZ DE IDENTIDAD DEL USUARIO ===
Como dirigirte a el: Diego
Edad: 29 anos
Estatus: fundador de una agencia de datos (nivel de exito 4/5) - clase media alta
Activos de atraccion: inteligencia (5/5), ambicion (5/5), humor (4/5), presencia (3/5)
Busca: ABIERTO
Lineas rojas innegociables: deshonestidad; que me hagan sentir una opcion de reserva
Postura financiera en citas: DEPENDE
Estilo de personalidad: Estratega silencioso. Los tres scripts deben sonar como este estilo.
Calidad de marco observada: 72/100`;

const FAKE_THREAD = `ELLA: jajaja ya veo
EL: entonces si te gusto el lugar
ELLA: si estuvo lindo, aunque la musica media rara jaja
EL: la proxima elijo yo la playlist entonces
ELLA: uy no se si confiarte eso
ELLA: y tu que haces despierto a esta hora 👀`;

async function main() {
  console.log("\n=== PRUEBA DEL MOTOR ALFII ===\n");
  logProviderChain();
  console.log("");

  const started = Date.now();

  const result = await generateStructured({
    task: "analysis",
    system: BUNKER_SYSTEM,
    parts: [
      {
        text:
          `${FAKE_IDENTITY}\n\n` +
          `=== EXPEDIENTE DE SOFI ===\n` +
          `Etapa actual: CALIBRACION\nAnalisis previos: 0\n` +
          `Arquetipo: sin diagnosticar todavia.\n` +
          `Riesgo: LIMPIO (transaccional 0/100)\n` +
          `Medidores actuales: beso 0%, cita 0%, noche 0%\n\n` +
          `=== CAPTURA A ANALIZAR ===\n` +
          `Plataforma: whatsapp\nNombre en el encabezado: Sofi\n` +
          `Confianza de la extraccion: 95%\n\n` +
          `${FAKE_THREAD}\n\n` +
          `Analiza el ultimo mensaje de ELLA en el contexto de todo el hilo. ` +
          `Cita fragmentos literales para sostener tu lectura.`,
      },
    ],
    jsonSchema: analysisResponseSchema,
    validator: analysisPayloadSchema,
    temperature: 0.85,
    maxOutputTokens: 5000,
  });

  const p = result.data;

  console.log("--- METRICAS ---");
  console.log(`proveedor:       ${result.provider} / ${result.model}`);
  if (result.failedOver.length) {
    console.log(`failover desde:  ${result.failedOver.join(", ")}`);
  }
  console.log(`latencia:        ${result.latencyMs} ms (total ${Date.now() - started} ms)`);
  console.log(`tokens entrada:  ${result.inputTokens}`);
  console.log(`tokens salida:   ${result.outputTokens}`);
  console.log(`requirio reparacion: ${result.repaired ? "SI" : "no"}\n`);

  console.log("--- LEAD ---");
  console.log(p.lead, "\n");

  console.log("--- 1. SUBTEXTO ---");
  console.log(p.subtext.reading);
  console.log(`\nmarco: ${p.subtext.frameDetected}`);
  console.log(`shit test: ${p.subtext.shitTestDetected ? p.subtext.shitTestType : "no"}\n`);

  console.log("--- 2. ARQUETIPO ---");
  console.log(
    `${p.archetypeDiagnosis.primary} (${ARCHETYPE_LABELS[p.archetypeDiagnosis.primary]})` +
      (p.archetypeDiagnosis.hybrid.length ? ` + ${p.archetypeDiagnosis.hybrid.join(", ")}` : "") +
      ` - confianza ${Math.round(p.archetypeDiagnosis.confidence * 100)}%`
  );
  console.log(p.archetypeDiagnosis.reasoning, "\n");

  console.log("--- 3. RADAR DE RIESGO ---");
  console.log(`nivel: ${p.riskRadar.level} | transaccional: ${p.riskRadar.transactionalRisk}/100`);
  p.riskRadar.flags.forEach((f) => console.log(`  flag ${f.code} (sev ${f.severity}): ${f.description}`));
  if (p.riskRadar.userPostureCorrection) {
    console.log(`correccion de postura: ${p.riskRadar.userPostureCorrection}`);
  }
  console.log();

  console.log("--- 4. TIMING ---");
  console.log(`esperar ${p.timing.waitMinutes} min`);
  console.log(p.timing.rationale, "\n");

  console.log("--- 5. SCRIPTS ---");
  p.scripts.forEach((s, i) => {
    console.log(`[${i + 1}] ${s.style}`);
    console.log(`    "${s.text}"`);
    console.log(`    -> ${s.rationale}\n`);
  });

  console.log("--- 6. MEDIDORES ---");
  console.log(`beso ${p.meters.kiss}% | cita ${p.meters.firstDate}% | noche ${p.meters.firstNight}%\n`);

  console.log("--- VALIDACIONES DEL CONTRATO ---");
  const checks: [string, boolean][] = [
    ["exactamente 3 scripts", p.scripts.length === 3],
    [
      "los 3 estilos correctos y en orden",
      SCRIPT_STYLES.every((style, i) => p.scripts[i]?.style === style),
    ],
    ["medidores en rango 0-100", [p.meters.kiss, p.meters.firstDate, p.meters.firstNight].every((v) => v >= 0 && v <= 100)],
    ["subtexto cita el hilo real", /despierto a esta hora|👀|playlist|musica/i.test(p.subtext.reading)],
    ["scripts sin placeholders", !p.scripts.some((s) => /\[|\{|xxx/i.test(s.text))],
    ["lead personalizado con su nombre", /diego/i.test(p.lead)],
  ];

  let allPass = true;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? "OK  " : "FALLA"} ${label}`);
    if (!ok) allPass = false;
  }

  console.log(`\n${allPass ? "MOTOR VALIDADO" : "REVISAR: alguna validacion fallo"}\n`);
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error("\nFALLO LA PRUEBA:", error?.message ?? error);
  if (error?.details) console.error("detalles:", JSON.stringify(error.details, null, 2));
  process.exit(1);
});
