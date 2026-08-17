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
import { personaDirective } from "../prompts/personas";
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
  // Descriptivos y no "1..5": el numero lo infiere el modelo de lo que el
  // usuario elige o cuenta. Pedir la cifra convertia el bloque en formulario.
  PHYSIQUE: [
    { label: "Fuera de forma", hint: "Y lo sabes, sin drama: se trabaja desde ahi" },
    { label: "Podria cuidarme mas", hint: "Nada grave, pero hay margen evidente" },
    { label: "Normal", hint: "Ni destacas ni desentonas" },
    { label: "En forma", hint: "Se te nota que te cuidas" },
    { label: "En mi mejor momento", hint: "El fisico es una de tus palancas" },
    { label: "Prefiero no decirlo", hint: "Se salta sin coste y seguimos" },
  ],
};

function chipsForStep(stepKey: string): string[] {
  return (STEP_CHIP_OPTIONS[stepKey] ?? []).map((o) => o.label);
}

/**
 * Filtra las opciones improvisadas por el modelo antes de mandarlas a pantalla.
 *
 * PORQUE: el modelo se cuela y devuelve el identificador interno del enum
 * (CABALLERO_CLASICO, MENOS_500) como etiqueta. En pantalla eso es un boton que
 * el usuario no entiende. Se descartan esas y se corta a 6, que es lo que cabe
 * comodo en el modal sin que haya que scrollear para verlas todas.
 */
const ENUM_LOOKING = /^[A-Z0-9]+(_[A-Z0-9]+)+$/;

function sanitizeChipOptions(
  options: { label: string; hint: string }[]
): { label: string; hint: string }[] {
  const seen = new Set<string>();
  const clean: { label: string; hint: string }[] = [];

  for (const opt of options) {
    const label = String(opt.label ?? "").trim();
    if (!label || ENUM_LOOKING.test(label)) continue;

    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    clean.push({ label, hint: String(opt.hint ?? "").trim() });
    if (clean.length === 6) break;
  }

  return clean;
}

/**
 * ¿El titulo de pregunta que mando el modelo corresponde al reply?
 *
 * PORQUE existe: el modelo a veces pone en `question` la pregunta que PLANEA
 * hacer (p. ej. la de ubicacion que le sugerimos "para un momento natural")
 * mientras su reply termina preguntando otra cosa. En pantalla eso es un
 * titulo que no tiene nada que ver con la burbuja del chat. Heuristica barata:
 * si ninguna palabra significativa del titulo aparece en el reply, se descarta
 * y el cliente cae al titulo canonico del bloque, que siempre es coherente.
 */
function questionMatchesReply(question: string, reply: string): boolean {
  const normalize = (text: string) =>
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ");

  const replyWords = new Set(normalize(reply).split(/\s+/).filter(Boolean));
  const significant = normalize(question)
    .split(/\s+/)
    .filter((w) => w.length > 3);

  // Sin palabras significativas (titulo ultracorto tipo "¿Y tu?"): se acepta,
  // no hay con que comparar y descartarlo seria puro azar.
  if (!significant.length) return true;

  return significant.some((w) => replyWords.has(w));
}

/**
 * Texto con el que arranca cada bloque.
 *
 * Vive a nivel de modulo y no dentro de onboardingOpener porque `advance` los
 * necesita: al cerrar un bloque hay que enunciar la pregunta del siguiente en
 * el mismo turno, o el hilo queda con una pregunta del bloque viejo mientras
 * las opciones de abajo ya son las del nuevo.
 */
/**
 * Varias variantes por bloque y se elige una al azar: el mismo parrafo
 * palabra por palabra en cada cuenta suena a grabacion, no a alguien
 * hablandote. El tono es de amigo que sabe del tema, no de coach ni de
 * formulario.
 */
const BLOCK_OPENERS: Record<string, string[]> = {
  PREFERRED_NAME: [
    "Listo, aqui empieza lo bueno. Soy Alfii, tu estratega personal, y esto funciona " +
      "mejor si hablamos como amigos. Asi que primero: ¿como te digo? Nombre, apodo, " +
      "como te digan tus panas.",
    "Bienvenido. Soy Alfii y voy a estar de tu lado en esto. Pero antes de nada, " +
      "dime como te llamo: tu nombre o el apodo que uses con tu gente.",
  ],
  BIRTH_DATE: [
    "Una rapida y te dejo: ¿cuando naciste? No es igual aconsejarle a alguien de 22 " +
      "que de 38, y quiero hablarte en tu idioma, no sonar como tu tio.",
    "Dato express: tu fecha de nacimiento. Es solo para calibrar el tono, que un " +
      "consejo con palabras prestadas se nota a kilometros.",
  ],
  STATUS: [
    "Ya, ahora si, cuentame de ti. ¿En que andas, de que vives? Dimelo como se lo " +
      "contarias a un amigo en la mesa, no como en una entrevista.",
    "Va la primera de verdad: ¿a que te dedicas? Olvidate de titulos y cargos, " +
      "cuentamelo como es, que aqui nadie te esta evaluando.",
  ],
  ASSETS: [
    "Ahora lo bueno: ¿que tienes tu que la mayoria no? Entre nosotros, sin modestia. " +
      "Si me endulzas esto, mis consejos fallan alla afuera, y eso no nos sirve.",
    "Hablemos de tus armas. ¿Que es lo que mejor te funciona con la gente: la labia, " +
      "la presencia, el humor? Se honesto, que de eso vive todo lo que te voy a dar.",
  ],
  PHILOSOPHY: [
    "Otra importante: ¿que buscas realmente? ¿Algo serio, algo casual, o todavia lo " +
      "estas viendo? Cualquiera de las tres vale, incluida la ultima.",
    "¿Y tu que quieres de todo esto? Serio, casual, o ni idea todavia. Decirmelo " +
      "claro me evita empujarte a donde no quieres ir.",
  ],
  PERSONALITY: [
    "Por como hablas ya me hago una idea de como eres, pero prefiero que me lo " +
      "confirmes tu.",
    "Llevo un rato leyendote y tengo una teoria de tu estilo. Dejame comprobarla contigo.",
  ],
  INCOME: [
    "Esta es incomoda y te explico para que la quiero: con un rango de lo que ganas " +
      "al mes calibro los planes que te propongo. Ni una cita que te apriete, ni una " +
      "que te quede corta. Solo el rango, y si prefieres saltarla, cero drama.",
    "Tema personal y lo puedes saltar sin problema: ¿en que rango andan tus ingresos " +
      "al mes? No es para juzgar tu billetera, es para proponerte planes que te calcen.",
  ],
  PHYSIQUE: [
    "Ultima y tranquilo, que esto no es un casting: ¿cuanto mides y cuanto pesas, mas " +
      "o menos? Es para saber sobre que construimos, no para ponerte nota. Lo que no " +
      "quieras decir, lo dejamos.",
    "Cerramos con lo fisico, sin juicios: estatura y peso aproximado, y listo. Con eso " +
      "se cual es tu palanca real y donde apoyar la estrategia.",
  ],
};

function pickOpener(stepKey: string): string {
  const variants = BLOCK_OPENERS[stepKey] ?? [];
  if (!variants.length) return "";
  return variants[Math.floor(Math.random() * variants.length)] ?? "";
}

/**
 * Todo lo que Alfii ya sabe del usuario, en texto plano para el prompt.
 *
 * PORQUE existe: al modelo solo se le mandaban las ultimas 10 lineas del
 * transcript. Con 8 bloques de hasta 3 turnos, lo que el usuario conto en el
 * bloque 3 ya se habia salido de esa ventana para cuando llega al 7. El
 * resultado es un onboarding que pregunta como si fuera la primera vez: no
 * puede conectar el bloque de personalidad con los activos que le acaban de
 * dar, ni las lineas rojas con lo que dijo que busca. Con esto Alfii arrastra
 * la Matriz completa en cada turno y puede referirse a lo que ya le contaron,
 * que es lo unico que hace que la conversacion se sienta viva y no un
 * formulario troceado.
 */
function matrixBrief(user: IUser, profile: IPowerProfile): string {
  const lines: string[] = [];

  if (user.preferredName) lines.push(`- Le dices ${user.preferredName}.`);

  if (user.birthDate) {
    const years = Math.floor(
      (Date.now() - new Date(user.birthDate).getTime()) / (365.25 * 24 * 3600 * 1000)
    );
    if (years > 0 && years < 120) lines.push(`- Tiene ${years} anios.`);
  }

  if (user.location?.country || user.location?.city) {
    const place = [user.location.city, user.location.country].filter(Boolean).join(", ");
    lines.push(
      user.location.confirmed
        ? `- Esta en ${place} (confirmado por el).`
        : `- Probablemente esta en ${place} (deducido de la conexion, SIN confirmar).`
    );
  }

  const status = profile.status ?? {};
  if (status.profession) {
    const level = status.successLevel ? `, se puntua ${status.successLevel}/5 en como le va` : "";
    lines.push(`- Se dedica a: ${status.profession}${level}.`);
  }
  if (status.socioeconomic) lines.push(`- Contexto socioeconomico: ${status.socioeconomic}.`);

  if (profile.attractionAssets?.length) {
    const assets = profile.attractionAssets
      .map((a) => `${a.asset} (${a.selfRating}/5)`)
      .join(", ");
    lines.push(`- Dice que sus activos son: ${assets}.`);
  }

  const philosophy = profile.philosophy ?? { redLines: [] };
  if (philosophy.seeking) lines.push(`- Busca: ${philosophy.seeking}.`);
  if (philosophy.redLines?.length) {
    lines.push(`- Sus lineas rojas: ${philosophy.redLines.join(", ")}.`);
  }
  if (philosophy.financeStance) lines.push(`- En las citas: ${philosophy.financeStance}.`);

  if (profile.personalityStyle) lines.push(`- Estilo confirmado: ${profile.personalityStyle}.`);
  if (profile.income?.monthlyRange) lines.push(`- Rango de ingreso: ${profile.income.monthlyRange}.`);

  const physique = profile.physique ?? {};
  if (physique.heightCm || physique.buildSelfRating) {
    const parts = [
      physique.heightCm ? `${physique.heightCm} cm` : null,
      physique.weightKg ? `${physique.weightKg} kg` : null,
      physique.buildSelfRating ? `se ve ${physique.buildSelfRating}/5` : null,
    ].filter(Boolean);
    lines.push(`- Fisico: ${parts.join(", ")}.`);
  }

  lines.push(`- Marco actual: ${profile.frameScore}/100.`);

  return lines.join("\n");
}

/**
 * La nota de continuidad al ABRIR un bloque.
 *
 * PORQUE no la escribe el modelo: la contextNote que devuelve pertenece al
 * bloque que acaba de cerrar, y pintarla junto a la pregunta del bloque nuevo
 * seria el mismo desfase que ya rompio el flujo una vez. Esta se arma con lo que
 * el usuario dijo, citandolo, para que el salto entre bloques no se lea como
 * "siguiente pagina del formulario" sino como alguien que sigue el hilo.
 * Vacia cuando todavia no hay nada que citar: mejor sin nota que con una frase
 * de relleno.
 */
function openerNote(user: IUser, profile: IPowerProfile, stepKey: string): string {
  const name = user.preferredName;
  const profession = profile.status?.profession;
  // El activo que el usuario mejor se puntua: es el que el reconoce como suyo.
  const topAsset = [...(profile.attractionAssets ?? [])].sort(
    (a, b) => (b.selfRating ?? 0) - (a.selfRating ?? 0)
  )[0]?.asset;
  const seeking = profile.philosophy?.seeking;
  const redLines = profile.philosophy?.redLines ?? [];

  switch (stepKey) {
    case "BIRTH_DATE":
      return name ? `Encantado, ${name}. Vamos con lo siguiente.` : "";
    case "STATUS":
      return name ? `${name}, ahora lo que de verdad me sirve.` : "";
    case "ASSETS":
      return profession ? `Ya se que te dedicas a ${profession}. Vamos a lo tuyo.` : "";
    case "PHILOSOPHY":
      return topAsset ? `Tu activo mas fuerte es ${topAsset}. Ahora el marco.` : "";
    case "PERSONALITY":
      if (redLines.length) return `Con tus lineas rojas claras, te leo el estilo.`;
      return seeking ? `Buscas ${seeking}. Esto define como lo pides.` : "";
    case "INCOME":
      return profession ? `Por lo de ${profession} me hago una idea, pero dimelo tu.` : "";
    case "PHYSIQUE":
      return topAsset ? `Tu palanca hoy es ${topAsset}. Falta medir esta.` : "";
    default:
      return "";
  }
}

/**
 * Quita la pregunta final de un cierre de bloque forzado.
 *
 * Cuando el servidor corta el bloque por limite de turnos, el modelo ya escribio
 * su respuesta pensando que seguia en el bloque anterior y suele rematar con una
 * pregunta mas. Esa pregunta ya no tiene donde contestarse: las opciones de
 * abajo son las del bloque siguiente. Se corta la ultima oracion interrogativa
 * y el opener del bloque nuevo ocupa su lugar.
 */
function dropTrailingQuestion(reply: string): string {
  const trimmed = reply.trim();
  if (!trimmed.endsWith("?")) return trimmed;

  // Se busca el cierre de la oracion anterior para saber donde empieza la
  // pregunta. Sin ningun cierre previo, el texto entero ES la pregunta y no hay
  // nada que conservar.
  const lastBreak = Math.max(
    trimmed.lastIndexOf(". ", trimmed.length - 2),
    trimmed.lastIndexOf("! ", trimmed.length - 2),
    trimmed.lastIndexOf("? ", trimmed.length - 2)
  );
  if (lastBreak === -1) return "";

  return trimmed.slice(0, lastBreak + 1).trim();
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
  /** La frase que conecta esta pregunta con algo que el usuario ya dijo. Se
   *  pinta junto a la pregunta, no dentro del hilo, para que siga visible
   *  mientras elige. */
  contextNote?: string;
  /** Titulo de la sub-pregunta de ESTE turno. Vacio al abrir bloque: ahi el
   *  titulo canonico del bloque es el correcto y lo pone el cliente. */
  question?: string;
  /** Voz elegida por el usuario (clave de PERSONAS) o null si aun no elige. */
  persona?: string | null;
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
  /** Pista de ubicacion deducida de la IP de esta peticion. Nunca un hecho. */
  geo?: { country?: string; city?: string } | null;
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
        "Tranquilo, lo saltamos. Solo ten presente que en ese punto voy a trabajar " +
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
      reply: "Listo, anotado.",
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

  // Un solo booleano para el aviso al modelo y para el cierre del servidor.
  // Estaban desalineados por uno (`>=` contra `+ 1 >=`): en el turno del corte
  // el modelo no recibia el aviso, hacia otra pregunta del bloque, y el servidor
  // cerraba igual. Resultado: Alfii preguntando por activos con las opciones de
  // filosofia debajo.
  const limitReached = turnsInBlock + 1 >= MAX_TURNS_PER_BLOCK;

  // La pista de IP se guarda SIN confirmar en cuanto aparece: asi el resto de
  // la app puede calibrar con un "probable" mientras el usuario no lo confirme.
  if (input.geo?.country && !input.user.location?.country) {
    input.user.location = {
      country: input.geo.country,
      city: input.geo.city,
      confirmed: false,
    };
    await UserModel.findByIdAndUpdate(input.user._id, {
      $set: { location: input.user.location },
    });
  }

  // Que hacer con la ubicacion en ESTE turno. Nunca es un bloque propio: se
  // confirma de pasada, sin frenar el bloque actual ni interrogar.
  const loc = input.user.location;
  const locationDirective = loc?.confirmed
    ? ""
    : loc?.country
      ? `\nUBICACION: la conexion sugiere que te habla desde ` +
        `${[loc.city, loc.country].filter(Boolean).join(", ")}, pero NO esta confirmado ` +
        `(las VPN mienten). En un momento natural de tu reply, confirmalo de pasada como ` +
        `lectura tuya ("¿me hablas desde ${loc.city || loc.country}?"). Si lo confirma o ` +
        `lo corrige, extrae country y city. No frenes el bloque actual por esto ni lo ` +
        `conviertas en interrogatorio. Para esta confirmacion NO mandes chipOptions: es ` +
        `pregunta abierta. Y solo cuenta si la haces DENTRO del reply de este turno: si tu ` +
        `reply no la pregunta, no la pongas en question ni la dejes para "despues".\n`
      : `\nUBICACION: no sabes desde donde te habla. Si surge natural, pregunta de pasada ` +
        `su ciudad o pais (sirve para calibrar planes, referencias y costumbres locales) y ` +
        `extrae country y city cuando lo diga. Nunca lo inventes y NO mandes chipOptions ` +
        `para esta pregunta: es abierta, no adivines ciudades. Solo cuenta si la preguntas ` +
        `DENTRO del reply de este turno: jamas la pongas en question si tu reply no la hace.\n`;

  const history = profile.onboarding.transcript
    .slice(-10)
    .map((t) => `${t.role === "user" ? "USUARIO" : "ALFII"}: ${t.content}`)
    .join("\n");

  const result = await generateStructured({
    task: "chat",
    system: `${ONBOARDING_SYSTEM}\n\n${stepInstruction(step)}${personaDirective(input.user.alfiiPersona)}`,
    parts: [
      {
        text:
          `Bloque ${step + 1} de ${ONBOARDING_TOTAL_STEPS}. ` +
          `Turnos ya usados en este bloque: ${turnsInBlock}/${MAX_TURNS_PER_BLOCK}.\n` +
          (limitReached
            ? "LIMITE ALCANZADO: este es tu ultimo turno del bloque. Cierra con lo que " +
              "tengas y marca blockComplete true. NO hagas ninguna pregunta mas de este " +
              "bloque: el usuario ya no va a poder contestarla.\n"
            : "") +
          `LO QUE YA SABES DE EL (usalo, no lo repreguntes):\n` +
          `${matrixBrief(input.user, profile) || "- Todavia nada, es el primer bloque."}\n` +
          locationDirective +
          `\nConversacion reciente:\n${history}`,
      },
    ],
    jsonSchema: onboardingResponseSchema,
    validator: onboardingReplySchema,
    temperature: 0.9,
    maxOutputTokens: 1200,
    attribution: { userId: String(input.user._id) },
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

  if (data.blockComplete || limitReached) {
    return advance(input.user, profile, {
      // Si el corte lo impuso el servidor y el modelo aun asi remato con una
      // pregunta, esa pregunta se descarta: pertenece a un bloque que ya cerro.
      reply:
        limitReached && !data.blockComplete
          ? dropTrailingQuestion(data.reply)
          : data.reply,
      microLessonId: data.microLessonId ?? null,
      suggestedChips: data.chipOptions.map((o) => o.label),
    });
  }

  await profile.save();

  // Dentro del bloque mandan las opciones del MODELO, no el catalogo canonico.
  //
  // El catalogo esta atado al bloque; varios bloques encadenan sub-preguntas.
  // PHILOSOPHY pregunta primero que buscas y despues cuales son tus lineas
  // rojas: con el catalogo fijo, el usuario veia "Algo serio / Algo casual"
  // debajo de una pregunta sobre lineas rojas, tocaba una, y Alfii le respondia
  // que no era eso. El modelo es el unico que sabe que acaba de preguntar.
  // El canonico queda de red: si el modelo no manda nada utilizable, al menos
  // hay opciones del bloque en vez de dejar al usuario solo con el teclado.
  const state = currentState(profile);
  const modelOptions = sanitizeChipOptions(data.chipOptions);
  // Los bloques de identidad son preguntas abiertas (nombre libre, fecha con
  // selector propio): un chip aqui es siempre un invento del modelo ("Ver las
  // 5 opciones" sobre "¿como te llamo?" no significa nada). Se suprimen.
  const OPEN_STEPS = new Set(["PREFERRED_NAME", "BIRTH_DATE"]);
  const options = OPEN_STEPS.has(state.stepKey)
    ? []
    : modelOptions.length
      ? modelOptions
      : STEP_CHIP_OPTIONS[state.stepKey] ?? [];

  return {
    ...state,
    reply: data.reply,
    microLessonId: data.microLessonId ?? null,
    suggestedChips: options.map((o) => o.label),
    chipOptions: options,
    contextNote: data.contextNote,
    question:
      data.question && questionMatchesReply(data.question, data.reply)
        ? data.question.trim()
        : "",
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

  // Ubicacion confirmada POR EL USUARIO: pisa la pista de IP y queda firme.
  if (extracted.country || extracted.city) {
    const current = user.location ?? { confirmed: false as const };
    const next = {
      country: extracted.country ? String(extracted.country).slice(0, 60) : current.country,
      city: extracted.city ? String(extracted.city).slice(0, 80) : current.city,
      confirmed: true,
    };
    await UserModel.findByIdAndUpdate(user._id, { $set: { location: next } });
    user.location = next;
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

  // El cierre del bloque y la apertura del siguiente van en el MISMO turno: el
  // usuario no vuelve a hablar entre uno y otro, asi que si el texto no enuncia
  // la nueva pregunta, las opciones de abajo aparecen sin que nadie las haya
  // pedido. Se guarda tambien en el transcript para que al recargar la pagina el
  // hilo se vea igual que en vivo.
  const opener = completed ? "" : pickOpener(state.stepKey);
  // Si viene opener, el cierre NO puede terminar preguntando: dos preguntas en
  // el mismo turno (la del modelo + la del bloque nuevo) y el usuario solo
  // puede contestar una. La pregunta valida es siempre la del opener.
  const closing = opener ? dropTrailingQuestion(payload.reply.trim()) : payload.reply.trim();
  const reply = [closing, opener].filter(Boolean).join("\n\n");

  if (opener) {
    profile.onboarding.transcript.push({ role: "alfii", content: opener, at: new Date() });
    await profile.save();
  }

  return {
    ...state,
    reply,
    microLessonId: payload.microLessonId,
    suggestedChips: canonical.length ? canonical : payload.suggestedChips,
    chipOptions: STEP_CHIP_OPTIONS[state.stepKey] ?? [],
    contextNote: completed ? "" : openerNote(fresh, profile, state.stepKey),
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
    contextNote: "",
    question: "",
    microLessonId: null as string | null,
    identityMatrix: null as ReturnType<typeof buildIdentityMatrix> | null,
  };
}

/** Primer turno: Alfii habla antes de que el usuario escriba nada. */
export async function onboardingOpener(user: IUser): Promise<OnboardingState> {
  const profile = await ensureProfile(String(user._id));
  const step = Math.min(profile.onboarding.currentStep, ONBOARDING_TOTAL_STEPS - 1);

  if (profile.onboarding.transcript.length === 0) {
    profile.onboarding.transcript.push({
      role: "alfii",
      content: pickOpener(ONBOARDING_STEPS[step] ?? "PREFERRED_NAME"),
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
    reply: history.length ? "" : pickOpener(stepKey ?? "PREFERRED_NAME"),
    // Para que el cliente sepa si ya eligio voz o toca ofrecer el selector.
    persona: user.alfiiPersona ?? null,
    history,
    // Retomar significa que el usuario YA hablo. El opener tambien vive en el
    // transcript, asi que mirar solo su longitud daba "retomado" en la primera
    // visita de una cuenta nueva.
    resumed: history.some((m) => m.role === "user"),
    suggestedChips: chipsForStep(stepKey),
    chipOptions: STEP_CHIP_OPTIONS[stepKey] ?? [],
    // Al retomar tras cerrar la pestania, la nota es la prueba de que no se
    // perdio nada: Alfii vuelve citando lo que el usuario ya le habia contado.
    contextNote: openerNote(user, profile, stepKey),
  };
}

export { ONBOARDING_PROMPT_VERSION };
