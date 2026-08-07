/**
 * Detector de crisis.
 *
 * La seccion 8 del descargo legal declara que si aparece riesgo de autolesion,
 * violencia o crisis, Alfii deriva a recursos de ayuda y no continua con la
 * asesoria. Escribirlo en el documento sin implementarlo convierte el descargo
 * en prueba en contra. Esto es la implementacion.
 *
 * Dos capas: una heuristica local que corta ANTES de gastar una llamada al
 * modelo, y el flag crisisDetected que el propio modelo puede levantar.
 */

const CRISIS_PATTERNS: { pattern: RegExp; kind: CrisisKind }[] = [
  // Autolesion / suicidio
  { pattern: /\bme\s+quiero\s+(morir|matar)\b/i, kind: "SELF_HARM" },
  { pattern: /\bquiero\s+(morirme|suicidarme|matarme)\b/i, kind: "SELF_HARM" },
  { pattern: /\bsuicid(arme|io|arse)\b/i, kind: "SELF_HARM" },
  { pattern: /\bno\s+quiero\s+(seguir\s+)?vivir\b/i, kind: "SELF_HARM" },
  { pattern: /\b(cortarme|lastimarme)\b/i, kind: "SELF_HARM" },
  { pattern: /\bacabar\s+con\s+(mi\s+vida|todo)\b/i, kind: "SELF_HARM" },
  { pattern: /\bella\s+se\s+quiere\s+(morir|matar)\b/i, kind: "SELF_HARM_THIRD" },

  // Violencia hacia terceros
  { pattern: /\b(la|le)\s+voy\s+a\s+(matar|golpear|pegar|hacer\s+dano)\b/i, kind: "VIOLENCE" },
  { pattern: /\bhacerle\s+dano\b/i, kind: "VIOLENCE" },
  { pattern: /\bvengarme\s+de\s+ella\b/i, kind: "VIOLENCE" },

  // Acoso / vigilancia / coercion
  { pattern: /\b(seguirla|vigilarla|espiarla|rastrearla)\b/i, kind: "STALKING" },
  { pattern: /\bdonde\s+vive\s+para\s+ir\b/i, kind: "STALKING" },
  { pattern: /\b(chantaje|extorsion)\b/i, kind: "COERCION" },
  { pattern: /\b(filtrar|publicar|difundir)\s+(sus\s+)?(fotos|nudes|videos)\b/i, kind: "NCII" },
  { pattern: /\b(emborracharla|drogarla|dormirla)\b/i, kind: "COERCION" },
  { pattern: /\bno\s+acepta(r)?\s+un\s+no\b/i, kind: "COERCION" },

  // Menores
  { pattern: /\b(tiene|es\s+de)\s+(1[0-7]|1[0-7]\s+anos)\b/i, kind: "MINOR" },
  { pattern: /\b(menor\s+de\s+edad|es\s+menor)\b/i, kind: "MINOR" },
  { pattern: /\b(colegiala|de\s+colegio|va\s+al\s+colegio)\b/i, kind: "MINOR" },
];

export type CrisisKind =
  | "SELF_HARM"
  | "SELF_HARM_THIRD"
  | "VIOLENCE"
  | "STALKING"
  | "COERCION"
  | "NCII"
  | "MINOR";

export interface CrisisDetection {
  detected: boolean;
  kind?: CrisisKind;
  response: string;
  resources: { region: string; label: string; contact: string }[];
  blocksAdvice: boolean;
}

const RESOURCES = [
  { region: "Ecuador", label: "Linea de apoyo psicologico (MSP)", contact: "171 opcion 6" },
  { region: "Ecuador", label: "Emergencias / ECU 911", contact: "911" },
  { region: "Mexico", label: "Linea de la Vida", contact: "800 911 2000" },
  { region: "Colombia", label: "Linea 106 - salud mental", contact: "106" },
  { region: "Espana", label: "Linea de atencion a la conducta suicida", contact: "024" },
  { region: "Estados Unidos", label: "988 Suicide & Crisis Lifeline", contact: "988" },
  { region: "Internacional", label: "Directorio de lineas de crisis", contact: "findahelpline.com" },
];

const RESPONSES: Record<CrisisKind, string> = {
  SELF_HARM: `Voy a parar aca, y no por protocolo.

Lo que acabas de decir esta por encima de cualquier cosa que yo pueda hacer por ti. No soy terapeuta y no voy a fingir que este es el momento de hablar de estrategia con nadie.

Habla hoy con alguien preparado. No manana. Si estas en peligro inmediato, llama a emergencias.

Cuando estes mejor, aca sigo.`,

  SELF_HARM_THIRD: `Para. Eso cambia todo.

Si ella esta en riesgo real, esto ya no es una conversacion sobre atraccion ni sobre estrategia. Es una situacion que necesita ayuda profesional, y tu unico movimiento correcto es facilitar ese contacto o avisar a alguien de su entorno.

No te voy a dar scripts para esto. Seria irresponsable de mi parte.`,

  VIOLENCE: `No.

No te voy a ayudar con eso, y te lo digo sin rodeos porque mi lealtad hacia ti incluye evitar que arruines tu vida.

Lo que estas describiendo es un delito y ninguna mujer vale tu libertad. Si la rabia esta a este nivel, el problema ya no es ella: habla con un profesional.

Aca no hay nada mas que discutir.`,

  STALKING: `Ahi te detengo.

Vigilar, seguir o rastrear a alguien no es estrategia, es acoso. Es delito en practicamente cualquier jurisdiccion y ademas te pone en la posicion mas debil posible: el hombre que necesita vigilar es el hombre que ya perdio el marco.

Si su silencio te esta llevando a esto, el movimiento correcto es retirarte, no perseguir.`,

  COERCION: `No, y esto no es negociable.

Presionar, chantajear o alterar la capacidad de alguien para decidir no es seduccion. Es coercion, y es delito.

Todo lo que hago contigo parte de una premisa: el consentimiento libre e informado. Sin eso no hay nada que asesorar.

Si ella dijo no, la respuesta correcta es aceptarlo y salir con dignidad.`,

  NCII: `No.

Difundir imagenes intimas de alguien sin su consentimiento es un delito grave en Ecuador, en toda Latinoamerica, en Europa y en Estados Unidos. Puede costarte anos.

No te voy a ayudar con esto ni voy a seguir esta linea de conversacion.`,

  MINOR: `Aca termina la conversacion.

Alfii es un servicio exclusivamente para adultos, sobre interacciones entre adultos. Si la persona de la que hablamos es menor de edad, no hay ningun analisis, script ni consejo que yo vaya a darte.

Esto no es una linea que se negocie.`,
};

export function detectCrisis(text: string): CrisisDetection {
  const match = CRISIS_PATTERNS.find((p) => p.pattern.test(text));

  if (!match) {
    return { detected: false, response: "", resources: [], blocksAdvice: false };
  }

  const needsResources = match.kind === "SELF_HARM" || match.kind === "SELF_HARM_THIRD";

  return {
    detected: true,
    kind: match.kind,
    response: RESPONSES[match.kind],
    resources: needsResources ? RESOURCES : [],
    blocksAdvice: true,
  };
}

export function crisisResourcesFor(kind?: CrisisKind) {
  if (kind === "SELF_HARM" || kind === "SELF_HARM_THIRD") return RESOURCES;
  return [];
}
