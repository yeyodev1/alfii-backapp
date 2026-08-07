/**
 * Enums del dominio. Fuente unica de verdad: los modelos de Mongoose, los
 * schemas de validacion y los schemas que se le pasan a Gemini leen de aqui.
 */

export const ARCHETYPES = [
  "KOAKUMA",
  "HIMEDERE",
  "ONEE_SAN",
  "TSUN_KUUDERE",
  "DEREDERE",
  "DANDERE",
  "YANDERE",
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  KOAKUMA: "La Diablilla",
  HIMEDERE: "La Princesa",
  ONEE_SAN: "La Sofisticada",
  TSUN_KUUDERE: "La Fria",
  DEREDERE: "La Dulce",
  DANDERE: "La Timida",
  YANDERE: "La Intensa",
};

export const STAGES = [
  "APERTURA",
  "CALIBRACION",
  "ESCALADA",
  "CITA_AGENDADA",
  "POST_CITA",
  "ENFRIADO",
  "CERRADO",
] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Hitos de la relacion. El usuario los marca a mano cuando ocurren.
 *
 * Los medidores son una PREDICCION del modelo; esto es un HECHO declarado por el
 * usuario. Son cosas distintas y por eso viven separadas: cuando el usuario
 * marca un hito, deja de tener sentido que Alfii siga estimando su probabilidad.
 *
 * El lenguaje es deliberadamente sobrio. "Primera noche juntos" dice lo mismo
 * que la alternativa explicita sin convertir el expediente de una persona real
 * en un marcador de conquistas.
 */
export const MILESTONE_KEYS = ["firstDate", "firstKiss", "firstNight", "relationship"] as const;
export type MilestoneKey = (typeof MILESTONE_KEYS)[number];

export const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  firstDate: "Primera salida",
  firstKiss: "Primer beso",
  firstNight: "Primera noche juntos",
  relationship: "Relacion",
};

/** Medidor que queda resuelto al marcar cada hito. `relationship` no tiene
 *  medidor propio: es un estado, no una probabilidad. */
export const MILESTONE_METER: Record<MilestoneKey, "kiss" | "firstDate" | "firstNight" | null> = {
  firstDate: "firstDate",
  firstKiss: "kiss",
  firstNight: "firstNight",
  relationship: null,
};

export const RISK_LEVELS = ["LIMPIO", "VIGILAR", "ALTO", "ABORTAR"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const SCRIPT_STYLES = ["PODER", "CABALLERO", "PICARO"] as const;
export type ScriptStyle = (typeof SCRIPT_STYLES)[number];

export const OUTCOMES = [
  "SIN_REPORTAR",
  "RESPONDIO_POSITIVO",
  "RESPONDIO_NEUTRO",
  "RESPONDIO_FRIO",
  "NO_RESPONDIO",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const PERSONALITY_STYLES = [
  "TIBURON_CORPORATIVO",
  "CREATIVO_BOHEMIO",
  "LIDER_CARISMATICO",
  "CABALLERO_CLASICO",
  "ESTRATEGA_SILENCIOSO",
] as const;
export type PersonalityStyle = (typeof PERSONALITY_STYLES)[number];

export const PERSONALITY_LABELS: Record<PersonalityStyle, string> = {
  TIBURON_CORPORATIVO: "Tiburon corporativo",
  CREATIVO_BOHEMIO: "Creativo bohemio",
  LIDER_CARISMATICO: "Lider carismatico",
  CABALLERO_CLASICO: "Caballero clasico",
  ESTRATEGA_SILENCIOSO: "Estratega silencioso",
};

export const PLATFORMS = [
  "whatsapp",
  "instagram",
  "tinder",
  "telegram",
  "bumble",
  "other",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const MESSAGE_KINDS = [
  "text",
  "screenshot",
  "analysis",
  "greeting",
  "lesson",
  "stateChange",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const ACCENT_COLORS = ["red", "cream", "plum", "sage", "navy"] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

export const FINANCE_STANCES = ["PAGO_SIEMPRE", "DIVIDIMOS", "DEPENDE"] as const;
export type FinanceStance = (typeof FINANCE_STANCES)[number];

export const SEEKING = ["SERIO", "CASUAL", "ABIERTO", "NO_LO_SE"] as const;
export type Seeking = (typeof SEEKING)[number];

/** Rangos de ingreso mensual autoreportado. Se guarda el rango y no la cifra
 *  exacta: baja la friccion de un dato sensible y es suficiente para calibrar
 *  el nivel de los scripts. */
export const INCOME_RANGES = [
  "MENOS_500",
  "500_1000",
  "1000_2500",
  "2500_5000",
  "MAS_5000",
] as const;
export type IncomeRange = (typeof INCOME_RANGES)[number];

export const INCOME_RANGE_LABELS: Record<IncomeRange, string> = {
  MENOS_500: "Menos de 500",
  "500_1000": "Entre 500 y 1000",
  "1000_2500": "Entre 1000 y 2500",
  "2500_5000": "Entre 2500 y 5000",
  MAS_5000: "Mas de 5000",
};

/** Pasos del recorrido de datos. 0-1 son identidad, 2-7 la Matriz de Identidad. */
export const ONBOARDING_STEPS = [
  "PREFERRED_NAME",
  "BIRTH_DATE",
  "STATUS",
  "ASSETS",
  "PHILOSOPHY",
  "PERSONALITY",
  "INCOME",
  "PHYSIQUE",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const ONBOARDING_TOTAL_STEPS = ONBOARDING_STEPS.length;

/** Campos omitibles con friccion (SkipDataModal). */
export const SKIPPABLE_FIELDS = [
  "preferredName",
  "birthDate",
  "status",
  "assets",
  "philosophy",
  "personality",
  "income",
  "physique",
] as const;
export type SkippableField = (typeof SKIPPABLE_FIELDS)[number];

/** Lecciones contextuales. Se muestran una sola vez por usuario. */
export const LESSON_IDS = [
  "shit-test",
  "marco",
  "riesgo-transaccional",
  "timing",
  "activos-reales",
  "lineas-rojas",
  "arq-koakuma",
  "arq-himedere",
  "arq-onee-san",
  "arq-tsun-kuudere",
  "arq-deredere",
  "arq-yandere",
] as const;
export type LessonId = (typeof LESSON_IDS)[number];

/** Maximo de lecciones que se auto-abren por sesion. Sin esto, el primer
 *  analisis dispara cinco sheets seguidos y el usuario abandona. */
export const MAX_AUTO_LESSONS_PER_SESSION = 2;
