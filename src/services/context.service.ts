import {
  ARCHETYPE_LABELS,
  INCOME_RANGE_LABELS,
  MILESTONE_KEYS,
  MILESTONE_LABELS,
  PERSONALITY_LABELS,
} from "../schemas/enums";
import type { IUser } from "../models/user.model";
import type { IPowerProfile } from "../models/powerProfile.model";
import type { ITarget } from "../models/target.model";
import { AnalysisModel } from "../models/analysis.model";
import { MessageModel } from "../models/message.model";
import { deriveAge } from "../utils/age";

/**
 * Ensamblador de contexto del agente.
 *
 * Un Target = una instancia del agente con su propia memoria. Las capas se
 * ensamblan SIEMPRE en este orden, y el orden no es estetico sino economico:
 * Gemini cachea prefijos repetidos, asi que lo estatico va primero y lo
 * volatil al final. Invertirlo multiplica el costo por turno.
 *
 *   0. Prompt base            estatico
 *   1. Identidad del usuario  casi estatico
 *   2. Dossier de la chica    por turno   <- estado de DB, no memoria del modelo
 *   3. Resumen rodante        cada N turnos
 *   4. Ultimas 3 capturas     por captura
 *   5. Ultimos 20 turnos      por turno
 *   6. Mensaje actual         request
 */

export const CONTEXT_BUDGET_TOKENS = 12000;
export const RECENT_MESSAGES_WINDOW = 20;
export const RECENT_THREADS_WINDOW = 3;
export const COMPACTION_THRESHOLD = 40;

/** Estimacion barata: ~4 caracteres por token en espanol. Suficiente para
 *  presupuestar sin pagar una llamada de countTokens en cada turno. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface AssembledContext {
  layers: { name: string; text: string; tokens: number; protected: boolean }[];
  text: string;
  tokens: number;
  dropped: string[];
}

// ---------------------------------------------------------------------------
// Capa 1 - identidad del usuario
// ---------------------------------------------------------------------------

export function buildIdentityLayer(user: IUser, profile: IPowerProfile | null): string {
  const lines: string[] = ["=== MATRIZ DE IDENTIDAD DEL USUARIO ==="];
  const missing: string[] = [];

  lines.push(`Como dirigirte a el: ${user.preferredName || "(no lo ha dicho)"}`);
  if (!user.preferredName) missing.push("su nombre");

  const age = deriveAge(user.birthDate);
  if (age !== null) {
    lines.push(`Edad: ${age} anos`);
  } else {
    lines.push("Edad: desconocida");
    missing.push("su edad");
  }

  if (!profile) {
    lines.push("Matriz de Identidad: sin completar.");
    return [
      ...lines,
      "",
      "IMPORTANTE: no conoces al usuario. Analiza con lo que tienes y dile de " +
        "forma explicita que tus scripts van a ser genericos hasta que complete " +
        "su perfil. No inventes rasgos suyos.",
    ].join("\n");
  }

  if (profile.status?.profession) {
    lines.push(
      `Estatus: ${profile.status.profession}` +
        (profile.status.successLevel ? ` (nivel de exito ${profile.status.successLevel}/5)` : "") +
        (profile.status.socioeconomic ? ` - ${profile.status.socioeconomic}` : "")
    );
  } else {
    missing.push("su profesion y estatus");
  }

  if (profile.attractionAssets?.length) {
    lines.push(
      "Activos de atraccion: " +
        profile.attractionAssets.map((a) => `${a.asset} (${a.selfRating}/5)`).join(", ")
    );
  } else {
    missing.push("sus activos de atraccion");
  }

  // Ingresos y fisico: se piden en La Auditoria prometiendo que calibran los
  // scripts. Si no llegaran hasta aqui, esa promesa seria falsa y el test solo
  // seria una mecanica de recoleccion de datos.
  if (profile.income?.monthlyRange) {
    lines.push(
      `Rango de ingresos declarado: ${INCOME_RANGE_LABELS[profile.income.monthlyRange]}` +
        (profile.income.currency ? ` (${profile.income.currency})` : "") +
        `. Usalo para calibrar que planes le puedes sugerir de forma realista. ` +
        `Jamas se lo menciones a ella ni lo conviertas en argumento de valor.`
    );
  }

  if (profile.physique?.heightCm || profile.physique?.buildSelfRating) {
    const parts: string[] = [];
    if (profile.physique.heightCm) parts.push(`${profile.physique.heightCm} cm`);
    if (profile.physique.weightKg) parts.push(`${profile.physique.weightKg} kg`);
    if (profile.physique.buildSelfRating) {
      parts.push(`complexion autoevaluada ${profile.physique.buildSelfRating}/5`);
    }
    lines.push(`Fisico: ${parts.join(", ")}.`);
  }

  if (profile.philosophy?.seeking) lines.push(`Busca: ${profile.philosophy.seeking}`);
  if (profile.philosophy?.redLines?.length) {
    lines.push(`Lineas rojas innegociables: ${profile.philosophy.redLines.join("; ")}`);
  } else {
    missing.push("sus lineas rojas");
  }
  if (profile.philosophy?.financeStance) {
    lines.push(`Postura financiera en citas: ${profile.philosophy.financeStance}`);
  }

  if (profile.personalityStyle) {
    lines.push(
      `Estilo de personalidad: ${PERSONALITY_LABELS[profile.personalityStyle]}. ` +
        `Los tres scripts deben sonar como este estilo.`
    );
  } else {
    missing.push("su estilo de personalidad");
  }

  lines.push(`Calidad de marco observada: ${profile.frameScore}/100`);
  if (profile.frameScore < 55) {
    lines.push(
      "Su marco viene debil segun el historial. Se mas firme en la correccion " +
        "de postura y no le des scripts que lo pongan en posicion de perseguir."
    );
  }

  if (missing.length) {
    lines.push("", `DATOS QUE TE FALTAN: ${missing.join(", ")}.`);
    lines.push(
      "Si el analisis se beneficiaria de un dato faltante, dilo en una frase " +
        "corta al final del bloque correspondiente. No lo inventes."
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Capa 2 - dossier de la chica (estado de DB, no memoria del modelo)
// ---------------------------------------------------------------------------

export function buildDossierLayer(target: ITarget): string {
  const lines: string[] = [`=== EXPEDIENTE DE ${target.displayName.toUpperCase()} ===`];

  lines.push(`Etapa actual: ${target.stage}`);
  lines.push(`Analisis previos: ${target.analysisCount}`);

  // Contexto declarado por el usuario. Va arriba del diagnostico porque
  // condiciona como se lee todo lo demas: el mismo mensaje frio significa
  // distinto en una match de app de citas que en una companiera de trabajo.
  const her = target.herProfile;
  if (her && Object.keys(her).length) {
    const HOW_WE_MET_LABELS: Record<string, string> = {
      APP_CITAS: "se conocieron en una app de citas",
      TRABAJO: "se conocieron en el trabajo",
      AMIGOS: "se conocieron por amigos en comun",
      GYM: "se conocieron en el gimnasio",
      UNIVERSIDAD: "se conocieron en la universidad",
      FIESTA: "se conocieron en una fiesta",
      REDES: "se conocieron por redes sociales",
      CALLE: "el la abordo en la calle",
      OTRO: "se conocieron por otra via",
    };
    const GOAL_LABELS: Record<string, string> = {
      ALGO_SERIO: "el busca algo serio con ella",
      CASUAL: "el busca algo casual",
      NO_LO_SE: "el todavia no sabe que busca con ella",
    };

    lines.push("Lo que el usuario declaro sobre ella:");
    if (her.howWeMet) {
      lines.push(`  - Origen: ${HOW_WE_MET_LABELS[her.howWeMet] ?? her.howWeMet}`);
    }
    if (typeof her.knownSinceMonths === "number") {
      lines.push(
        her.knownSinceMonths < 1
          ? "  - Se conocen hace menos de un mes."
          : `  - Se conocen hace ${her.knownSinceMonths} mes(es).`
      );
    }
    if (typeof her.herAge === "number") lines.push(`  - Edad de ella: ${her.herAge}`);
    if (her.herOccupation) lines.push(`  - Ocupacion de ella: ${her.herOccupation}`);
    if (her.relationshipGoal) {
      lines.push(`  - Objetivo: ${GOAL_LABELS[her.relationshipGoal] ?? her.relationshipGoal}`);
    }
    if (her.notes) lines.push(`  - Notas del usuario: ${her.notes}`);
    lines.push(
      "Estos datos los dio el usuario, no son diagnostico tuyo: tratalos como " +
        "contexto verificado y no los contradigas."
    );
  }

  if (target.archetype?.primary) {
    const hybrid = target.archetype.hybrid?.length
      ? ` con rasgos de ${target.archetype.hybrid.map((h) => ARCHETYPE_LABELS[h]).join(" y ")}`
      : "";
    lines.push(
      `Arquetipo diagnosticado: ${target.archetype.primary} (${ARCHETYPE_LABELS[target.archetype.primary]})${hybrid}, ` +
        `confianza ${Math.round((target.archetype.confidence || 0) * 100)}%`
    );

    if (target.archetype.history?.length > 1) {
      const shifts = target.archetype.history
        .slice(-4)
        .map((h) => h.primary)
        .join(" -> ");
      lines.push(`Como fue mutando: ${shifts}`);
    }
  } else {
    lines.push("Arquetipo: sin diagnosticar todavia.");
  }

  lines.push(
    `Riesgo: ${target.riskProfile.level} (transaccional ${target.riskProfile.transactionalRisk}/100)`
  );
  if (target.riskProfile.flags?.length) {
    lines.push("Red flags acumuladas:");
    for (const flag of target.riskProfile.flags.slice(0, 6)) {
      lines.push(
        `  - ${flag.code}: ${flag.description} (severidad ${flag.severity}, vista ${flag.occurrences} vez/veces)`
      );
    }
  }

  // Los hitos van ANTES de los medidores y mandan sobre ellos: son hechos que
  // el usuario declaro, no estimaciones tuyas. Predecir la probabilidad de algo
  // que ya paso es el error mas caro que puede cometer el agente aqui.
  const achieved = MILESTONE_KEYS.filter((k) => target.milestones?.[k]?.achieved);
  if (achieved.length) {
    lines.push(
      "HITOS YA CUMPLIDOS (confirmados por el usuario): " +
        achieved
          .map((k) => {
            const at = target.milestones[k]?.at;
            const when = at ? ` el ${new Date(at).toISOString().slice(0, 10)}` : "";
            return `${MILESTONE_LABELS[k]}${when}`;
          })
          .join(", ") +
        ". No estimes la probabilidad de estos: ya ocurrieron. Trabaja sobre lo que sigue."
    );
  }

  const m = target.meters.current;
  lines.push(`Medidores actuales: beso ${m.kiss}%, cita ${m.firstDate}%, noche ${m.firstNight}%`);
  if (target.meters.history?.length > 1) {
    const trend = target.meters.history
      .slice(-3)
      .map((h) => `${h.kiss}/${h.firstDate}/${h.firstNight}`)
      .join(" -> ");
    lines.push(`Tendencia (beso/cita/noche): ${trend}`);
  }

  if (target.timingPattern?.herTypicalReplyMinutes) {
    lines.push(
      `Ella suele responder en ~${target.timingPattern.herTypicalReplyMinutes} minutos. ` +
        `Calibra el timing con este dato real, no con reglas genericas.`
    );
  }
  if (target.timingPattern?.herActiveHours?.length) {
    lines.push(`Horas activas observadas: ${target.timingPattern.herActiveHours.join(", ")}h`);
  }

  if (target.scriptsUsed?.length) {
    lines.push("Historial de scripts usados con ella:");
    for (const s of target.scriptsUsed.slice(-8)) {
      lines.push(`  - estilo ${s.style} -> resultado ${s.outcome}`);
    }
    const failed = target.scriptsUsed.filter(
      (s) => s.outcome === "RESPONDIO_FRIO" || s.outcome === "NO_RESPONDIO"
    );
    if (failed.length >= 2) {
      const styles = [...new Set(failed.map((s) => s.style))];
      lines.push(
        `ATENCION: el estilo ${styles.join(" y ")} ya fallo con ella. Considera otro enfoque y dilo.`
      );
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Capa 3 - resumen rodante
// ---------------------------------------------------------------------------

export function buildSummaryLayer(target: ITarget): string {
  if (!target.contextSummary) return "";
  return `=== RESUMEN DE LA RELACION HASTA AHORA ===\n${target.contextSummary}`;
}

// ---------------------------------------------------------------------------
// Capa 4 - ultimas capturas
// ---------------------------------------------------------------------------

export async function buildThreadsLayer(targetId: string): Promise<string> {
  const analyses = await AnalysisModel.find({ targetId })
    .sort({ createdAt: -1 })
    .limit(RECENT_THREADS_WINDOW)
    .select("extractedThread createdAt")
    .lean();

  if (!analyses.length) return "";

  const blocks = analyses.reverse().map((a, idx) => {
    const when = new Date(a.createdAt).toISOString().slice(0, 16).replace("T", " ");
    const thread = (a.extractedThread || [])
      .map((m) => `${m.speaker === "her" ? "ELLA" : "EL"}: ${m.text}`)
      .join("\n");
    return `--- Captura ${idx + 1} (${when}) ---\n${thread}`;
  });

  return `=== ULTIMAS CONVERSACIONES REALES CON ELLA ===\n${blocks.join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// Capa 5 - historial de chat con Alfii
// ---------------------------------------------------------------------------

export async function buildHistoryLayer(targetId: string): Promise<string> {
  const messages = await MessageModel.find({ targetId, compacted: false })
    .sort({ createdAt: -1 })
    .limit(RECENT_MESSAGES_WINDOW)
    .select("role kind content createdAt")
    .lean();

  if (!messages.length) return "";

  const lines = messages
    .reverse()
    .map((m) => {
      const who = m.role === "user" ? "USUARIO" : "ALFII";
      const prefix = m.kind === "analysis" ? "[analisis entregado] " : "";
      return `${who}: ${prefix}${m.content}`.slice(0, 900);
    })
    .join("\n");

  return `=== CONVERSACION RECIENTE CONTIGO ===\n${lines}`;
}

// ---------------------------------------------------------------------------
// Ensamblado con presupuesto
// ---------------------------------------------------------------------------

export interface AssembleInput {
  user: IUser;
  profile: IPowerProfile | null;
  target?: ITarget | null;
  includeThreads?: boolean;
  includeHistory?: boolean;
  extra?: string;
}

export async function assembleContext(input: AssembleInput): Promise<AssembledContext> {
  const layers: AssembledContext["layers"] = [];

  const push = (name: string, text: string, isProtected: boolean) => {
    if (!text) return;
    layers.push({ name, text, tokens: estimateTokens(text), protected: isProtected });
  };

  // Capas 1-3 son intocables: son la identidad del agente.
  push("identity", buildIdentityLayer(input.user, input.profile), true);

  if (input.target) {
    push("dossier", buildDossierLayer(input.target), true);
    push("summary", buildSummaryLayer(input.target), true);

    if (input.includeThreads !== false) {
      push("threads", await buildThreadsLayer(String(input.target._id)), false);
    }
    if (input.includeHistory !== false) {
      push("history", await buildHistoryLayer(String(input.target._id)), false);
    }
  }

  if (input.extra) push("extra", input.extra, true);

  // Recorte: primero las capturas viejas, despues el historial de chat.
  const dropped: string[] = [];
  const order = ["threads", "history"];
  let total = layers.reduce((sum, l) => sum + l.tokens, 0);

  for (const name of order) {
    if (total <= CONTEXT_BUDGET_TOKENS) break;
    const idx = layers.findIndex((l) => l.name === name);
    if (idx === -1) continue;

    const layer = layers[idx];
    const excess = total - CONTEXT_BUDGET_TOKENS;

    if (layer.tokens <= excess) {
      layers.splice(idx, 1);
      dropped.push(name);
      total -= layer.tokens;
    } else {
      const keepChars = Math.max(0, layer.text.length - excess * 4);
      layer.text = "[...recortado por presupuesto...]\n" + layer.text.slice(-keepChars);
      layer.tokens = estimateTokens(layer.text);
      dropped.push(`${name}:truncado`);
      total = layers.reduce((sum, l) => sum + l.tokens, 0);
    }
  }

  const text = layers.map((l) => l.text).join("\n\n");

  return { layers, text, tokens: estimateTokens(text), dropped };
}
