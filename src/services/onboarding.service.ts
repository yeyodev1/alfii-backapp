import { generateStructured } from "./ai/structured";
import {
  ONBOARDING_SYSTEM,
  ONBOARDING_PROMPT_VERSION,
  stepInstruction,
} from "../prompts/onboarding.system";
import { onboardingReplySchema, onboardingResponseSchema } from "../schemas/onboarding.schema";
import { PowerProfileModel, IPowerProfile } from "../models/powerProfile.model";
import { UserModel, IUser } from "../models/user.model";
import {
  ONBOARDING_STEPS,
  ONBOARDING_TOTAL_STEPS,
  SKIPPABLE_FIELDS,
  SkippableField,
} from "../schemas/enums";
import { checkAchievements } from "./achievements.service";
import { isPlausibleBirthDate } from "../utils/age";
import { CustomError } from "../errors/customError.error";
import { logMetrics } from "../utils/redact";

/** Maximo de turnos por bloque. Un onboarding conversacional que se atasca se
 *  abandona: al tercer turno degrada a chips y avanza. */
const MAX_TURNS_PER_BLOCK = 3;

/**
 * Opciones tocables por bloque, con su explicacion.
 *
 * PORQUE viven aqui y no las improvisa el modelo: el modelo devolvia los valores
 * del enum en crudo (CABALLERO_CLASICO, TIBURON_CORPORATIVO) y el usuario tenia
 * que adivinar que significaba cada uno. Estas son canonicas, estan en castellano
 * y cada una explica que implica elegirla.
 */
export const STEP_CHIP_OPTIONS: Record<string, { label: string; hint: string }[]> = {
  ASSETS: [
    { label: "Inteligencia", hint: "Se nota que piensas rapido y conectas ideas" },
    { label: "Fisico", hint: "Tu cuerpo y tu presencia entran antes que tus palabras" },
    { label: "Fluidez verbal", hint: "Sostienes cualquier conversacion sin esfuerzo" },
    { label: "Estilo de vida", hint: "Lo que haces y donde te mueves llama la atencion" },
    { label: "Estabilidad", hint: "Transmites que tienes tu vida resuelta" },
    { label: "Ambicion", hint: "Vas claramente hacia algun lado y se te ve" },
    { label: "Humor", hint: "Haces reir y bajas la tension de cualquier momento" },
    { label: "Presencia", hint: "Cuando entras a un sitio la gente lo nota" },
  ],
  PHILOSOPHY: [
    { label: "Algo serio", hint: "Buscas una relacion, no pasar el rato" },
    { label: "Algo casual", hint: "Quieres disfrutar sin compromiso, con las cartas sobre la mesa" },
    { label: "Estoy abierto", hint: "Depende de quien aparezca y de como fluya" },
    { label: "No lo se", hint: "Todavia lo estas averiguando, y esta bien decirlo" },
  ],
  PERSONALITY: [
    { label: "Tiburon corporativo", hint: "Competitivo y directo. Hablas de logros y vas al grano" },
    { label: "Creativo bohemio", hint: "Espontaneo y curioso. Propones planes que nadie espera" },
    { label: "Lider carismatico", hint: "Sociable y con energia. La gente te sigue sin que lo pidas" },
    { label: "Caballero clasico", hint: "Educado y frontal. Cortejas a la antigua, sin juegos" },
    { label: "Estratega silencioso", hint: "Reservado y observador. Hablas poco y pegas fuerte" },
  ],
  // Los importes son en dolares y se dice en la propia etiqueta: sin eso el
  // modelo terminaba preguntando la moneda, que es un paso extra en el bloque
  // mas incomodo de toda la Auditoria.
  INCOME: [
    { label: "Menos de $500", hint: "Dolares al mes, aproximado" },
    { label: "Entre $500 y $1.000", hint: "Dolares al mes, aproximado" },
    { label: "Entre $1.000 y $2.500", hint: "Dolares al mes, aproximado" },
    { label: "Entre $2.500 y $5.000", hint: "Dolares al mes, aproximado" },
    { label: "Mas de $5.000", hint: "Dolares al mes, aproximado" },
    { label: "Prefiero no decirlo", hint: "Se salta sin coste y seguimos" },
  ],
  PHYSIQUE: [
    { label: "1", hint: "Fuera de forma y lo sabes" },
    { label: "2", hint: "Podrias cuidarte bastante mas" },
    { label: "3", hint: "Normal, ni destacas ni desentonas" },
    { label: "4", hint: "En forma, se te nota que te cuidas" },
    { label: "5", hint: "En tu mejor momento fisico" },
    { label: "Prefiero no decirlo", hint: "Se salta sin coste y seguimos" },
  ],
};

function chipsForStep(stepKey: string): string[] {
  return (STEP_CHIP_OPTIONS[stepKey] ?? []).map((o) => o.label);
}

export interface OnboardingState {
  step: number;
  totalSteps: number;
  stepKey: string;
  completed: boolean;
  reply: string;
  microLessonId?: string | null;
  suggestedChips: string[];
  /** Mismas opciones que suggestedChips pero con su explicacion, para que el
   *  usuario sepa que esta eligiendo. */
  chipOptions?: { label: string; hint: string }[];
  /** Conversacion previa, para rehidratar el hilo al recargar la pagina. */
  history?: { role: "user" | "alfii"; content: string }[];
  resumed?: boolean;
  progress: number;
  identityMatrix?: ReturnType<typeof buildIdentityMatrix> | null;
}

export function buildIdentityMatrix(user: IUser, profile: IPowerProfile) {
  return {
    preferredName: user.preferredName ?? null,
    hasBirthDate: !!user.birthDate,
    status: profile.status ?? null,
    assets: profile.attractionAssets ?? [],
    philosophy: profile.philosophy ?? null,
    personalityStyle: profile.personalityStyle ?? null,
    income: profile.income ?? null,
    physique: profile.physique ?? null,
    frameScore: profile.frameScore,
    completeness: profileCompleteness(user, profile).score,
  };
}

/** Puntaje de completitud. Alimenta el badge permanente de perfil incompleto,
 *  que es la alternativa a insistir con popups. */
export function profileCompleteness(user: IUser, profile: IPowerProfile | null) {
  // Los dos bloques sensibles pesan poco a proposito: son los que mas se
  // omiten, y no queremos que el badge castigue a quien decide no darlos.
  const checks: { field: SkippableField; done: boolean; weight: number }[] = [
    { field: "preferredName", done: !!user.preferredName, weight: 10 },
    { field: "birthDate", done: !!user.birthDate, weight: 12 },
    { field: "status", done: !!profile?.status?.profession, weight: 18 },
    { field: "assets", done: !!profile?.attractionAssets?.length, weight: 18 },
    { field: "philosophy", done: !!profile?.philosophy?.redLines?.length, weight: 18 },
    { field: "personality", done: !!profile?.personalityStyle, weight: 12 },
    { field: "income", done: !!profile?.income?.monthlyRange, weight: 6 },
    { field: "physique", done: !!profile?.physique?.buildSelfRating, weight: 6 },
  ];

  const score = checks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
  const missing = checks.filter((c) => !c.done).map((c) => c.field);

  return {
    score,
    missing,
    // Lo que el usuario ve en el badge: no un porcentaje abstracto sino el
    // impacto concreto de lo que le falta.
    impact:
      score >= 100
        ? "Mis analisis van al 100%."
        : `Mis analisis van al ${Math.max(40, score)}%. Me falta ${missing.length} dato(s).`,
  };
}

async function ensureProfile(userId: string) {
  let profile = await PowerProfileModel.findOne({ userId });
  if (!profile) profile = await PowerProfileModel.create({ userId });
  return profile;
}

/**
 * Turno de La Auditoria.
 *
 * El recorrido completo pasa por este unico endpoint conversacional con
 * currentStep: un solo flujo, un solo prompt, un solo lugar donde vive la
 * logica. Pasos 0-1 son identidad; 2-5 son la Matriz de Identidad.
 */
export async function onboardingTurn(input: {
  user: IUser;
  message?: string;
  chipSelection?: string[];
  birthDate?: string;
  skip?: SkippableField;
}): Promise<OnboardingState> {
  const profile = await ensureProfile(String(input.user._id));
  const step = Math.min(profile.onboarding.currentStep, ONBOARDING_TOTAL_STEPS - 1);
  const stepKey = ONBOARDING_STEPS[step];

  // --- omision con friccion ya confirmada en el cliente ---
  if (input.skip) {
    if (!SKIPPABLE_FIELDS.includes(input.skip)) {
      throw new CustomError("Campo no omitible", 400);
    }
    await UserModel.findByIdAndUpdate(input.user._id, {
      $push: { dataSkips: { field: input.skip, skippedAt: new Date() } },
    });
    return advance(input.user, profile, {
      reply:
        "Entendido, seguimos. Solo ten presente que en ese punto voy a trabajar " +
        "con menos informacion, y lo vas a notar cuando te de los scripts.",
      microLessonId: null,
      suggestedChips: [],
    });
  }

  // --- fecha de nacimiento: dato estructurado, no texto libre ---
  if (input.birthDate) {
    if (!isPlausibleBirthDate(input.birthDate)) {
      return {
        ...currentState(profile),
        reply: "Esa fecha no me cuadra. Revisala y me la pasas de nuevo.",
        suggestedChips: [],
      };
    }
    await UserModel.findByIdAndUpdate(input.user._id, {
      $set: { birthDate: new Date(input.birthDate) },
    });
    return advance(input.user, profile, {
      reply: "Anotado. Con eso ya puedo calibrar el tono de lo que te doy.",
      microLessonId: null,
      suggestedChips: [],
    });
  }

  const userText = input.chipSelection?.length
    ? input.chipSelection.join(", ")
    : (input.message ?? "").trim();

  if (!userText) throw new CustomError("Necesito una respuesta.", 400);

  profile.onboarding.transcript.push({ role: "user", content: userText, at: new Date() });

  const turnsInBlock = countTurnsInBlock(profile, step);

  const history = profile.onboarding.transcript
    .slice(-10)
    .map((t) => `${t.role === "user" ? "USUARIO" : "ALFII"}: ${t.content}`)
    .join("\n");

  const result = await generateStructured({
    task: "chat",
    system: `${ONBOARDING_SYSTEM}\n\n${stepInstruction(step)}`,
    parts: [
      {
        text:
          `Bloque ${step + 1} de ${ONBOARDING_TOTAL_STEPS}. ` +
          `Turnos ya usados en este bloque: ${turnsInBlock}/${MAX_TURNS_PER_BLOCK}.\n` +
          (turnsInBlock >= MAX_TURNS_PER_BLOCK
            ? "LIMITE ALCANZADO: cierra el bloque con lo que tengas, marca blockComplete true.\n"
            : "") +
          `Nombre del usuario: ${input.user.preferredName || "(aun no lo sabes)"}\n\n` +
          `Conversacion:\n${history}`,
      },
    ],
    jsonSchema: onboardingResponseSchema,
    validator: onboardingReplySchema,
    temperature: 0.9,
    maxOutputTokens: 1200,
  });

  logMetrics("onboarding.turn", {
    provider: result.provider,
    failedOver: result.failedOver,
    model: result.model,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    repaired: result.repaired,
  });

  const data = result.data;

  await applyExtraction(input.user, profile, data.extracted);

  if (data.framePenalty > 0) {
    profile.frameScore = Math.max(0, profile.frameScore - data.framePenalty);
  }

  profile.onboarding.transcript.push({ role: "alfii", content: data.reply, at: new Date() });
  if (profile.onboarding.transcript.length > 60) {
    profile.onboarding.transcript = profile.onboarding.transcript.slice(-60);
  }

  const forceComplete = turnsInBlock + 1 >= MAX_TURNS_PER_BLOCK;

  if (data.blockComplete || forceComplete) {
    return advance(input.user, profile, {
      reply: data.reply,
      microLessonId: data.microLessonId ?? null,
      suggestedChips: data.suggestedChips,
    });
  }

  await profile.save();

  // Dentro del mismo bloque manda el catalogo canonico si existe: las sugerencias
  // improvisadas por el modelo llegaban con los valores del enum en crudo.
  const state = currentState(profile);
  const canonical = chipsForStep(state.stepKey);

  return {
    ...state,
    reply: data.reply,
    microLessonId: data.microLessonId ?? null,
    suggestedChips: canonical.length ? canonical : data.suggestedChips,
    chipOptions: STEP_CHIP_OPTIONS[state.stepKey] ?? [],
  };
}

function countTurnsInBlock(profile: IPowerProfile, _step: number): number {
  // Aproximacion suficiente: turnos del usuario desde el ultimo cierre de bloque.
  const marker = profile.onboarding.transcript
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.role === "alfii" && t.content.includes("__BLOCK_END__"))
    .pop();
  const from = marker ? marker.i : 0;
  return profile.onboarding.transcript.slice(from).filter((t) => t.role === "user").length - 1;
}

async function applyExtraction(
  user: IUser,
  profile: IPowerProfile,
  extracted: NonNullable<Awaited<ReturnType<typeof onboardingTurn>>> extends never ? never : any
) {
  if (!extracted) return;

  if (extracted.preferredName) {
    await UserModel.findByIdAndUpdate(user._id, {
      $set: { preferredName: String(extracted.preferredName).slice(0, 40) },
    });
    user.preferredName = String(extracted.preferredName).slice(0, 40);
  }

  if (extracted.profession) profile.status.profession = extracted.profession;
  if (extracted.successLevel) profile.status.successLevel = extracted.successLevel;
  if (extracted.socioeconomic) profile.status.socioeconomic = extracted.socioeconomic;

  if (extracted.assets?.length) {
    profile.attractionAssets = extracted.assets.map((a: any) => ({
      asset: a.asset,
      // Si no lo puntuo, se omite el campo para que Mongoose aplique su default
      // (3). Mandar null explicito lo guardaria como null y romperia el calculo
      // de la stat FIS de la carta.
      ...(typeof a.selfRating === "number" ? { selfRating: a.selfRating } : {}),
      verifiedByAlfii: false,
    }));
  }

  if (extracted.seeking) profile.philosophy.seeking = extracted.seeking;
  if (extracted.redLines?.length) profile.philosophy.redLines = extracted.redLines;
  if (extracted.financeStance) profile.philosophy.financeStance = extracted.financeStance;
  if (extracted.personalityStyle) profile.personalityStyle = extracted.personalityStyle;

  // Ingreso y fisico son omitibles: solo se escriben si el usuario los dio de
  // verdad, para que un bloque evadido no deje datos fantasma en la carta.
  if (extracted.incomeMonthlyRange) {
    profile.income.monthlyRange = extracted.incomeMonthlyRange;
    profile.income.selfReported = true;
    // Dolares por defecto: es la moneda en la que estan escritas las opciones
    // que el usuario toco, asi que asumir otra cosa falsearia el dato.
    if (!profile.income.currency) profile.income.currency = "USD";
  }
  if (extracted.incomeCurrency) {
    profile.income.currency = String(extracted.incomeCurrency).slice(0, 8).toUpperCase();
  }

  if (extracted.heightCm) profile.physique.heightCm = extracted.heightCm;
  if (extracted.weightKg) profile.physique.weightKg = extracted.weightKg;
  if (extracted.buildSelfRating) profile.physique.buildSelfRating = extracted.buildSelfRating;
}

async function advance(
  user: IUser,
  profile: IPowerProfile,
  payload: { reply: string; microLessonId: string | null; suggestedChips: string[] }
): Promise<OnboardingState> {
  profile.onboarding.currentStep = Math.min(
    profile.onboarding.currentStep + 1,
    ONBOARDING_TOTAL_STEPS
  );
  profile.onboarding.transcript.push({
    role: "alfii",
    content: "__BLOCK_END__",
    at: new Date(),
  });

  const completed = profile.onboarding.currentStep >= ONBOARDING_TOTAL_STEPS;
  if (completed && !profile.onboarding.completed) {
    profile.onboarding.completed = true;
    profile.onboarding.extractedAt = new Date();
  }

  if (payload.microLessonId && !profile.education.seenLessons.includes(payload.microLessonId)) {
    profile.education.seenLessons.push(payload.microLessonId);
    profile.education.lastLessonAt = new Date();
  }

  await profile.save();

  const fresh = (await UserModel.findById(user._id)) ?? user;

  const state = currentState(profile);

  // Al cerrar un bloque la carta pudo cambiar de categoria. Se revisa fuera del
  // camino critico: el usuario no espera por un correo.
  void checkAchievements(fresh);

  // Los chips deben ser los del bloque que ARRANCA, no los que el modelo sugirio
  // para el bloque que acaba de cerrarse. Sin esto el usuario veia el titulo de
  // "ingresos" con las opciones de "personalidad" debajo.
  const canonical = chipsForStep(state.stepKey);

  return {
    ...state,
    reply: payload.reply,
    microLessonId: payload.microLessonId,
    suggestedChips: canonical.length ? canonical : payload.suggestedChips,
    chipOptions: STEP_CHIP_OPTIONS[state.stepKey] ?? [],
    identityMatrix: completed ? buildIdentityMatrix(fresh, profile) : null,
  };
}

function currentState(profile: IPowerProfile) {
  const step = Math.min(profile.onboarding.currentStep, ONBOARDING_TOTAL_STEPS - 1);
  return {
    step: profile.onboarding.currentStep,
    totalSteps: ONBOARDING_TOTAL_STEPS,
    stepKey: ONBOARDING_STEPS[step],
    completed: profile.onboarding.completed,
    progress: Math.round((profile.onboarding.currentStep / ONBOARDING_TOTAL_STEPS) * 100),
    reply: "",
    suggestedChips: [] as string[],
    chipOptions: [] as { label: string; hint: string }[],
    microLessonId: null as string | null,
    identityMatrix: null as ReturnType<typeof buildIdentityMatrix> | null,
  };
}

/** Primer turno: Alfii habla antes de que el usuario escriba nada. */
export async function onboardingOpener(user: IUser): Promise<OnboardingState> {
  const profile = await ensureProfile(String(user._id));
  const step = Math.min(profile.onboarding.currentStep, ONBOARDING_TOTAL_STEPS - 1);

  const openers: Record<string, string> = {
    PREFERRED_NAME:
      "Estas a punto de activar a tu estratega personal: Alfii. Bienvenido a La Auditoria. " +
      "Antes de seguir, quiero ayudarte bien pero todavia no se como te llamas. Como quieres que me dirija a ti?",
    BIRTH_DATE:
      "Un dato mas y te dejo tranquilo. Cuando naciste? Sirve para calibrar el tono: " +
      "a los 22 y a los 38 no se juega igual, y no quiero darte scripts que suenen prestados.",
    STATUS:
      "Ahora si, la parte que importa. Empecemos por lo concreto: a que te dedicas, " +
      "y que tan bien te va realmente? No me des la version de LinkedIn.",
    ASSETS:
      "Ahora lo incomodo. Que tienes tu que la mayoria no? Se honesto, no modesto. " +
      "Trabajo con activos reales, y si me mientes aqui mis scripts van a fallar en la vida real.",
    PHILOSOPHY:
      "Vamos a lo que define tu marco. Que buscas realmente: algo serio, algo casual, " +
      "o todavia no lo sabes? Esa ultima respuesta tambien es valida.",
    PERSONALITY:
      "Por como has hablado durante esta auditoria ya tengo una lectura de ti, " +
      "pero prefiero que me lo confirmes.",
    INCOME:
      "Tema incomodo, lo se, y te digo para que lo quiero: con esto calibro el nivel de los " +
      "planes que te propongo. Una cita que no puedes sostener te pone en un marco falso, y una " +
      "que te queda corta desperdicia tu palanca. Dame solo un rango mensual, no la cifra. " +
      "Y si prefieres saltarlo, se salta y ya.",
    PHYSIQUE:
      "Ultimo bloque, y no es vanidad: necesito saber cual es tu palanca real. Si el fisico es " +
      "un activo fuerte, la estrategia se apoya ahi; si no, la construyo sobre otra cosa. " +
      "Estatura, peso, y del 1 al 5 como estas hoy. Lo que no quieras decir, lo dejamos.",
  };

  if (profile.onboarding.transcript.length === 0) {
    profile.onboarding.transcript.push({
      role: "alfii",
      content: openers[ONBOARDING_STEPS[step]],
      at: new Date(),
    });
    await profile.save();
  }

  const stepKey = ONBOARDING_STEPS[step];

  /**
   * Historial para poder recargar la pagina sin perder la conversacion.
   *
   * El transcript ya se venia guardando en el perfil, pero el opener no lo
   * devolvia: al refrescar, el usuario veia un hilo vacio y parecia que la
   * Auditoria se habia reiniciado, cuando su progreso seguia intacto en la base.
   * Se filtran los marcadores internos de fin de bloque.
   */
  const history = profile.onboarding.transcript
    .filter((t) => t.content && t.content !== "__BLOCK_END__")
    .slice(-40)
    .map((t) => ({ role: t.role, content: t.content }));

  return {
    ...currentState(profile),
    // Si ya hay conversacion previa no se repite el opener: seria Alfii
    // saludando otra vez a mitad de una charla que ya venia avanzada.
    reply: history.length ? "" : openers[stepKey],
    history,
    // Retomar significa que el usuario YA hablo. El opener tambien vive en el
    // transcript, asi que mirar solo su longitud daba "retomado" en la primera
    // visita de una cuenta nueva.
    resumed: history.some((m) => m.role === "user"),
    suggestedChips: chipsForStep(stepKey),
    chipOptions: STEP_CHIP_OPTIONS[stepKey] ?? [],
  };
}

export { ONBOARDING_PROMPT_VERSION };
