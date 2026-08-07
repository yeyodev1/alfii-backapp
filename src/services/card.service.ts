import { Types } from "mongoose";
import { IUser } from "../models/user.model";
import { IPowerProfile, PowerProfileModel } from "../models/powerProfile.model";
import { ITarget, TargetModel } from "../models/target.model";
import { profileCompleteness } from "./onboarding.service";
import {
  IncomeRange,
  INCOME_RANGES,
  LESSON_IDS,
  Outcome,
  PERSONALITY_LABELS,
  PersonalityStyle,
} from "../schemas/enums";

/**
 * Carta tipo FIFA Ultimate Team del usuario.
 *
 * La mecanica solo funciona si la carta arranca BAJA y sube al dar datos: una
 * carta que nace en 85 sin informacion es una mentira y mata el incentivo.
 * Por eso aqui no hay "valores por defecto generosos": si el dato no esta, la
 * stat aporta cero y el hint dice literalmente que hay que responder.
 *
 * Todo el calculo es puro y determinista: mismas entradas, mismo resultado.
 * No hay Math.random ni dependencia de Date.now en el numero final.
 */

export type StatKey = "MRC" | "LEC" | "TMG" | "EST" | "FIS" | "CAL";
export type CardTier = "BRONCE" | "PLATA" | "ORO" | "LEYENDA";

export interface CardStat {
  key: StatKey;
  label: string;
  value: number;
  hint: string;
}

export interface LockedItem {
  field: string;
  statKey: StatKey;
  gain: number;
  question: string;
}

export interface UserCard {
  overall: number;
  tier: CardTier;
  position: string;
  positionLabel: string;
  stats: CardStat[];
  completeness: number;
  locked: LockedItem[];
  nextBest: { field: string; gain: number; statKey: StatKey } | null;
}

/* -------------------------------------------------------------------------- */
/* Entrada normalizada                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Snapshot plano de todo lo que la carta necesita. Se normaliza una sola vez
 * para poder SIMULAR (ver `withFieldFilled`) cuanto subiria el overall si el
 * usuario respondiera un dato concreto, sin tocar la base ni los documentos.
 */
interface CardInput {
  preferredName?: string;
  birthDate?: Date;
  analysisCount: number;

  profession?: string;
  successLevel?: number;
  incomeRange?: IncomeRange;

  assets: { asset: string; selfRating: number; verifiedByAlfii: boolean }[];
  redLines: string[];
  personalityStyle?: PersonalityStyle;

  heightCm?: number;
  weightKg?: number;
  buildSelfRating?: number;

  frameScore: number;
  seenLessons: string[];

  /** Resultados de scripts efectivamente reportados por el usuario. */
  outcomes: Outcome[];
  /** Cuantas veces Alfii le recomendo un delay (denominador honesto de TMG). */
  delayRecommendations: number;
}

/**
 * income y physique los esta anadiendo otro flujo en paralelo. Se leen con una
 * asercion a una forma OPCIONAL para que este servicio compile y funcione
 * exista o no el campo en el documento en tiempo de ejecucion.
 */
type OptionalIncome = { monthlyRange?: IncomeRange } | undefined;
type OptionalPhysique =
  | { heightCm?: number; weightKg?: number; buildSelfRating?: number }
  | undefined;

function toInput(user: IUser, profile: IPowerProfile | null, targets: ITarget[]): CardInput {
  const income = (profile as unknown as { income?: OptionalIncome } | null)?.income;
  const physique = (profile as unknown as { physique?: OptionalPhysique } | null)?.physique;

  // Un outcome SIN_REPORTAR no es informacion: el usuario uso el script pero
  // nunca dijo que paso. Contarlo como dato inflaria TMG con humo.
  const outcomes: Outcome[] = [];
  let delayRecommendations = 0;
  for (const target of targets) {
    for (const script of target.scriptsUsed ?? []) {
      if (script.outcome && script.outcome !== "SIN_REPORTAR") outcomes.push(script.outcome);
    }
    if (target.timingPattern?.recommendedDelayMinutes != null) delayRecommendations += 1;
  }

  return {
    preferredName: user.preferredName,
    birthDate: user.birthDate,
    analysisCount: user.analysisCount ?? 0,

    profession: profile?.status?.profession,
    successLevel: profile?.status?.successLevel,
    incomeRange: income?.monthlyRange,

    assets: profile?.attractionAssets ?? [],
    redLines: profile?.philosophy?.redLines ?? [],
    personalityStyle: profile?.personalityStyle,

    heightCm: physique?.heightCm,
    weightKg: physique?.weightKg,
    buildSelfRating: physique?.buildSelfRating,

    // frameScore tiene default 70 en el schema. Ese 70 NO es un marco medido,
    // es un placeholder; mas abajo se descuenta mientras no haya analisis.
    frameScore: profile?.frameScore ?? 0,
    seenLessons: profile?.education?.seenLessons ?? [],

    outcomes,
    delayRecommendations,
  };
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                  */
/* -------------------------------------------------------------------------- */

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Todas las stats viven en 0-99, igual que en una carta real. */
function stat(value: number) {
  return clamp(Math.round(value), 0, 99);
}

/** Sin tildes ni mayusculas: el texto libre del usuario llega como sea. */
function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Formulas de cada stat                                                       */
/* -------------------------------------------------------------------------- */

/**
 * MRC Marco = frameScore observado.
 *
 * frameScore nace en 70 por defecto y baja cuando Alfii corrige al usuario.
 * Un 70 sin una sola conversacion analizada seria marco regalado, asi que
 * mientras no haya analisis se aplica un factor de confianza: el marco no se
 * declara, se demuestra. Con >= 3 analisis ya se muestra el valor crudo.
 */
function statMarco(input: CardInput) {
  const confidence = clamp(0.35 + 0.65 * (input.analysisCount / 3), 0.35, 1);
  const value = stat(input.frameScore * confidence);

  const hint =
    input.analysisCount === 0
      ? "Tu marco todavia no ha sido observado. Sube tu primera conversacion: Alfii mide el marco en lo que escribes, no en lo que dices de ti."
      : input.analysisCount < 3
        ? `Marco medido con ${input.analysisCount} analisis. Con 3 analisis se muestra tu marco real sin descuento.`
        : "Marco medido. Sube cuando sostienes tu posicion y baja cada vez que Alfii te corrige por ceder.";

  return { value, hint };
}

/**
 * LEC Lectura = analisis realizados, con rendimientos decrecientes.
 *
 * Curva de saturacion 95 * n / (n + 8): el primer analisis vale mucho (11),
 * el decimo mucho menos (52) y el numero cien casi nada (87). Nunca llega a
 * 99 porque leer a alguien no se "termina".
 */
function statLectura(input: CardInput) {
  const n = Math.max(0, input.analysisCount);
  const value = stat((95 * n) / (n + 8));

  const hint =
    n === 0
      ? "Aun no has analizado ninguna conversacion. El primer analisis es el que mas sube esta stat."
      : `${n} analisis realizados. Cada analisis nuevo suma menos que el anterior: la curva se aplana a proposito.`;

  return { value, hint };
}

/**
 * TMG Timing = adherencia observable a los delays recomendados.
 *
 * No existe telemetria del envio real del usuario, asi que la unica evidencia
 * honesta es el resultado que EL reporta de los scripts que uso. Con menos de
 * 3 resultados reportados la muestra no dice nada: se devuelve un valor base
 * bajo y el hint declara explicitamente que falta evidencia. Prohibido inventar
 * una adherencia alta por defecto.
 */
const TMG_BASELINE = 22;
const TMG_MIN_SAMPLE = 3;
const OUTCOME_WEIGHT: Record<Outcome, number> = {
  RESPONDIO_POSITIVO: 1,
  RESPONDIO_NEUTRO: 0.6,
  RESPONDIO_FRIO: 0.25,
  NO_RESPONDIO: 0,
  SIN_REPORTAR: 0,
};

function statTiming(input: CardInput) {
  const sample = input.outcomes.length;

  if (sample < TMG_MIN_SAMPLE) {
    return {
      value: TMG_BASELINE,
      hint:
        input.delayRecommendations === 0
          ? "Sin datos de timing. Analiza una conversacion para recibir un delay recomendado y despues reporta que paso al enviarlo."
          : `Sin datos suficientes (${sample} de ${TMG_MIN_SAMPLE} resultados reportados). Marca que paso con cada script que usaste: respondio, respondio frio o no respondio.`,
    };
  }

  const ratio = input.outcomes.reduce((sum, o) => sum + OUTCOME_WEIGHT[o], 0) / sample;
  // La confianza crece con la muestra: 3 reportes no pesan igual que 10.
  const confidence = clamp(sample / 10, 0.3, 1);
  // Se parte del baseline y solo se suma lo que la evidencia respalda.
  const value = stat(TMG_BASELINE + 77 * ratio * confidence);

  return {
    value,
    hint:
      sample < 10
        ? `Calculado con ${sample} resultados reportados. Reporta mas para que el numero deje de estar amortiguado.`
        : "Respeta el delay que te recomienda Alfii y reporta el resultado: esta stat sigue tu adherencia real.",
  };
}

/**
 * EST Estatus = profesion (25) + successLevel (35) + rango de ingreso (39).
 * Todo lo que falta aporta exactamente cero. Maximo 99.
 */
function statEstatus(input: CardInput) {
  let value = 0;
  const missing: string[] = [];

  if (input.profession?.trim()) value += 25;
  else missing.push("a que te dedicas");

  if (input.successLevel) value += (clamp(input.successLevel, 1, 5) / 5) * 35;
  else missing.push("tu nivel de exito del 1 al 5");

  const incomeIndex = input.incomeRange ? INCOME_RANGES.indexOf(input.incomeRange) : -1;
  if (incomeIndex >= 0) value += (incomeIndex / (INCOME_RANGES.length - 1)) * 39;
  else missing.push("tu rango de ingreso mensual");

  return {
    value: stat(value),
    hint: missing.length
      ? `Falta: ${missing.join(", ")}. Responde eso y esta stat sube.`
      : "Estatus completo. Sube si actualizas tu nivel de exito o tu rango de ingreso.",
  };
}

/**
 * FIS Fisico = complexion autoevaluada (40) + IMC derivado (30) + activos de
 * atraccion de tipo fisico (29).
 *
 * El IMC no premia estar delgado: premia estar en rango saludable 20-25 y
 * decae hacia los extremos. Es un proxy grueso, por eso pesa menos que la
 * autoevaluacion y menos que los activos que el usuario declara.
 */
const PHYSICAL_ASSET_KEYWORDS = [
  "fisico",
  "cuerpo",
  "gimnasio",
  "gym",
  "altura",
  "alto",
  "atletico",
  "deporte",
  "musculo",
  "barba",
  "sonrisa",
  "pelo",
  "cabello",
  "rostro",
  "cara",
  "estilo",
  "vestir",
  "moda",
  "imagen",
  "apariencia",
  "look",
  "piel",
  "ojos",
];

function bmiScore(heightCm?: number, weightKg?: number) {
  if (!heightCm || !weightKg) return null;
  const meters = heightCm / 100;
  const bmi = weightKg / (meters * meters);
  if (bmi >= 20 && bmi <= 25) return 30;
  // Decaimiento lineal: a 5 puntos de IMC fuera del rango ya vale cero.
  const distance = bmi < 20 ? 20 - bmi : bmi - 25;
  return clamp(30 * (1 - distance / 10), 0, 30);
}

function statFisico(input: CardInput) {
  let value = 0;
  const missing: string[] = [];

  if (input.buildSelfRating) value += (clamp(input.buildSelfRating, 1, 5) / 5) * 40;
  else missing.push("como calificas tu complexion del 1 al 5");

  const bmi = bmiScore(input.heightCm, input.weightKg);
  if (bmi !== null) value += bmi;
  else missing.push("tu estatura y tu peso");

  const physical = input.assets.filter((a) =>
    PHYSICAL_ASSET_KEYWORDS.some((k) => normalize(a.asset ?? "").includes(k))
  );
  if (physical.length) {
    const avg = physical.reduce((s, a) => s + clamp(a.selfRating ?? 3, 1, 5), 0) / physical.length;
    // Un activo verificado por Alfii vale mas que uno solo declarado.
    const verified = physical.some((a) => a.verifiedByAlfii) ? 3 : 0;
    value += clamp((avg / 5) * 24 + Math.min(physical.length, 2) * 1 + verified, 0, 29);
  } else {
    missing.push("al menos un activo de atraccion fisico");
  }

  return {
    value: stat(value),
    hint: missing.length
      ? `Falta: ${missing.join(", ")}. Es la stat mas facil de subir ahora mismo.`
      : "Fisico completo. Sube si Alfii verifica tus activos en una conversacion real.",
  };
}

/**
 * CAL Calibracion = completitud del perfil (70) + lecciones vistas (30).
 *
 * Mide cuanto sabe Alfii de ti, no cuanto vales. Es la stat que el usuario
 * puede subir sin salir de la app, y por eso es el gancho del onboarding.
 */
function statCalibracion(input: CardInput, completeness: number) {
  const lessonRatio = clamp(input.seenLessons.length / LESSON_IDS.length, 0, 1);
  const value = stat(completeness * 0.7 + lessonRatio * 30);

  const pendingLessons = LESSON_IDS.length - Math.min(input.seenLessons.length, LESSON_IDS.length);
  const hint =
    completeness < 100
      ? `Perfil al ${completeness}%. Completa La Auditoria: cada respuesta sube esta stat y mejora los analisis.`
      : pendingLessons > 0
        ? `Perfil completo. Te faltan ${pendingLessons} lecciones por leer para llegar al maximo.`
        : "Calibracion al maximo. Alfii tiene todo lo que necesita de ti.";

  return { value, hint };
}

/* -------------------------------------------------------------------------- */
/* Overall y tier                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Pesos del overall. Marco y Lectura mandan porque son las dos unicas stats
 * que exigen uso real del producto; Fisico pesa poco a proposito para que la
 * carta no premie declarar altura y peso por encima de trabajar el marco.
 */
const STAT_WEIGHTS: Record<StatKey, number> = {
  MRC: 0.25,
  LEC: 0.2,
  TMG: 0.15,
  EST: 0.15,
  FIS: 0.1,
  CAL: 0.15,
};

const STAT_LABELS: Record<StatKey, string> = {
  MRC: "Marco",
  LEC: "Lectura",
  TMG: "Timing",
  EST: "Estatus",
  FIS: "Fisico",
  CAL: "Calibracion",
};

function tierOf(overall: number): CardTier {
  if (overall >= 85) return "LEYENDA";
  if (overall >= 75) return "ORO";
  if (overall >= 60) return "PLATA";
  return "BRONCE";
}

/** Posicion: tres letras del estilo de personalidad, como en una carta real. */
const POSITIONS: Record<PersonalityStyle, string> = {
  TIBURON_CORPORATIVO: "TIB",
  CREATIVO_BOHEMIO: "CRE",
  LIDER_CARISMATICO: "LID",
  CABALLERO_CLASICO: "CAB",
  ESTRATEGA_SILENCIOSO: "EST",
};

/**
 * profileCompleteness lee unicamente campos planos de user y profile, asi que
 * se le puede pasar un snapshot. Esto permite recalcular la completitud de un
 * escenario simulado sin duplicar aqui los pesos del onboarding, que son la
 * fuente unica de verdad.
 */
function completenessOf(input: CardInput) {
  const fakeUser = {
    preferredName: input.preferredName,
    birthDate: input.birthDate,
  } as unknown as IUser;

  // El snapshot se construye SIEMPRE, aunque el usuario todavia no tenga
  // documento PowerProfile: con todos los campos vacios el puntaje es 0 igual,
  // y asi la simulacion de "que pasa si respondo esto" tambien funciona para
  // quien aun no ha empezado La Auditoria.
  const fakeProfile = {
    status: { profession: input.profession },
    attractionAssets: input.assets,
    philosophy: { redLines: input.redLines },
    personalityStyle: input.personalityStyle,
    // income y physique van en el snapshot porque profileCompleteness ya
    // los pondera: omitirlos daria un 88% eterno a un perfil completo.
    income: { monthlyRange: input.incomeRange },
    physique: {
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      buildSelfRating: input.buildSelfRating,
    },
  } as unknown as IPowerProfile;

  return profileCompleteness(fakeUser, fakeProfile).score;
}

function computeStats(input: CardInput) {
  const completeness = completenessOf(input);

  const parts: Record<StatKey, { value: number; hint: string }> = {
    MRC: statMarco(input),
    LEC: statLectura(input),
    TMG: statTiming(input),
    EST: statEstatus(input),
    FIS: statFisico(input),
    CAL: statCalibracion(input, completeness),
  };

  const overall = clamp(
    Math.round(
      (Object.keys(parts) as StatKey[]).reduce(
        (sum, key) => sum + parts[key].value * STAT_WEIGHTS[key],
        0
      )
    ),
    0,
    99
  );

  return { parts, overall, completeness };
}

/* -------------------------------------------------------------------------- */
/* Bloqueados: que falta y cuanto sumaria                                      */
/* -------------------------------------------------------------------------- */

/**
 * Cada candidato declara como se veria el input si el usuario respondiera. Los
 * valores simulados son DELIBERADAMENTE medios (successLevel 3, ingreso medio,
 * rating 3), nunca maximos: la ganancia prometida tiene que ser alcanzable,
 * no un anzuelo.
 */
interface LockedCandidate {
  field: string;
  statKey: StatKey;
  question: string;
  isLocked: (input: CardInput) => boolean;
  fill: (input: CardInput) => CardInput;
}

const LOCKED_CANDIDATES: LockedCandidate[] = [
  {
    field: "preferredName",
    statKey: "CAL",
    question: "Como quieres que te llame?",
    isLocked: (i) => !i.preferredName,
    fill: (i) => ({ ...i, preferredName: "simulado" }),
  },
  {
    field: "birthDate",
    statKey: "CAL",
    question: "Cual es tu fecha de nacimiento?",
    isLocked: (i) => !i.birthDate,
    fill: (i) => ({ ...i, birthDate: new Date(0) }),
  },
  {
    field: "status",
    statKey: "EST",
    question: "A que te dedicas y que tan bien te va del 1 al 5?",
    isLocked: (i) => !i.profession?.trim() || !i.successLevel,
    fill: (i) => ({
      ...i,
      profession: i.profession?.trim() ? i.profession : "simulado",
      successLevel: i.successLevel ?? 3,
    }),
  },
  {
    field: "income",
    statKey: "EST",
    question: "En que rango esta tu ingreso mensual?",
    isLocked: (i) => !i.incomeRange,
    fill: (i) => ({ ...i, incomeRange: "1000_2500" }),
  },
  {
    field: "assets",
    statKey: "FIS",
    question: "Cuales son tus tres mejores activos de atraccion?",
    isLocked: (i) => !i.assets.length,
    fill: (i) => ({
      ...i,
      assets: [
        { asset: "fisico", selfRating: 3, verifiedByAlfii: false },
        { asset: "conversacion", selfRating: 3, verifiedByAlfii: false },
      ],
    }),
  },
  {
    field: "physique",
    statKey: "FIS",
    question: "Cuanto mides, cuanto pesas y como calificas tu complexion del 1 al 5?",
    isLocked: (i) => !i.heightCm || !i.weightKg || !i.buildSelfRating,
    fill: (i) => ({
      ...i,
      heightCm: i.heightCm ?? 175,
      weightKg: i.weightKg ?? 72,
      buildSelfRating: i.buildSelfRating ?? 3,
    }),
  },
  {
    field: "philosophy",
    statKey: "CAL",
    question: "Cuales son tus lineas rojas innegociables?",
    isLocked: (i) => !i.redLines.length,
    fill: (i) => ({ ...i, redLines: ["simulada"] }),
  },
  {
    field: "personality",
    statKey: "CAL",
    question:
      "Con cual te identificas: tiburon corporativo, creativo bohemio, lider carismatico, caballero clasico o estratega silencioso?",
    isLocked: (i) => !i.personalityStyle,
    fill: (i) => ({ ...i, personalityStyle: "ESTRATEGA_SILENCIOSO" }),
  },
  {
    field: "firstAnalysis",
    statKey: "LEC",
    question: "Sube una conversacion para que Alfii la analice.",
    isLocked: (i) => i.analysisCount === 0,
    // Un solo analisis: es la promesa mas conservadora posible.
    fill: (i) => ({ ...i, analysisCount: i.analysisCount + 1 }),
  },
  {
    field: "scriptOutcome",
    statKey: "TMG",
    question: "Que paso con los scripts que ya usaste: respondio, respondio frio o no respondio?",
    isLocked: (i) => i.outcomes.length < TMG_MIN_SAMPLE,
    // Se simula la muestra minima con resultados NEUTROS, no positivos.
    fill: (i) => ({
      ...i,
      outcomes: [
        ...i.outcomes,
        ...(Array(TMG_MIN_SAMPLE - i.outcomes.length).fill("RESPONDIO_NEUTRO") as Outcome[]),
      ],
    }),
  },
];

function buildLocked(input: CardInput, baseOverall: number): LockedItem[] {
  const locked = LOCKED_CANDIDATES.filter((c) => c.isLocked(input)).map((c) => ({
    field: c.field,
    statKey: c.statKey,
    gain: Math.max(0, computeStats(c.fill(input)).overall - baseOverall),
    question: c.question,
  }));

  // Orden determinista: mayor ganancia primero y, ante empate, el orden fijo
  // de LOCKED_CANDIDATES. Sin esto dos llamadas iguales podrian devolver
  // nextBest distintos.
  return locked.sort((a, b) => {
    if (b.gain !== a.gain) return b.gain - a.gain;
    return (
      LOCKED_CANDIDATES.findIndex((c) => c.field === a.field) -
      LOCKED_CANDIDATES.findIndex((c) => c.field === b.field)
    );
  });
}

/* -------------------------------------------------------------------------- */
/* API publica                                                                 */
/* -------------------------------------------------------------------------- */

/** Calculo puro. Expuesto aparte para poder testearlo sin base de datos. */
export function computeCard(
  user: IUser,
  profile: IPowerProfile | null,
  targets: ITarget[]
): UserCard {
  const input = toInput(user, profile, targets);
  const { parts, overall, completeness } = computeStats(input);

  const stats: CardStat[] = (Object.keys(STAT_WEIGHTS) as StatKey[]).map((key) => ({
    key,
    label: STAT_LABELS[key],
    value: parts[key].value,
    hint: parts[key].hint,
  }));

  const locked = buildLocked(input, overall);
  // Solo se recomienda algo que de verdad suma: un nextBest con gain 0 seria
  // pedirle un dato al usuario a cambio de nada.
  const best = locked.find((l) => l.gain > 0) ?? null;

  return {
    overall,
    tier: tierOf(overall),
    position: input.personalityStyle ? POSITIONS[input.personalityStyle] : "SIN",
    positionLabel: input.personalityStyle
      ? PERSONALITY_LABELS[input.personalityStyle]
      : "Sin definir",
    stats,
    completeness,
    locked,
    nextBest: best ? { field: best.field, gain: best.gain, statKey: best.statKey } : null,
  };
}

/** Carga lo minimo indispensable y devuelve la carta del usuario. */
export async function getUserCard(user: IUser): Promise<UserCard> {
  const userId = user._id as Types.ObjectId;

  // Los targets archivados tambien cuentan: el historial de scripts reportados
  // es evidencia de timing aunque el expediente ya este cerrado.
  const [profile, targets] = await Promise.all([
    PowerProfileModel.findOne({ userId }),
    TargetModel.find({ userId }).select("scriptsUsed timingPattern").limit(200),
  ]);

  return computeCard(user, profile, targets);
}
