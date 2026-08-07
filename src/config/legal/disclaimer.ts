import { env } from "../env";

const OPERATOR = env.LEGAL_OPERATOR;
const PRIVACY_EMAIL = env.LEGAL_CONTACT_PRIVACY;
const LEGAL_EMAIL = env.LEGAL_CONTACT_LEGAL;

export interface LegalSection {
  id: string;
  icon: string;
  title: string;
  body: string[];
}

/**
 * Descargo de Responsabilidad - 12 secciones.
 *
 * Este documento protege en la medida en que el CODIGO lo respalde. Lo que aqui
 * se afirme sobre el tratamiento de capturas debe coincidir con el valor real de
 * STORE_SCREENSHOTS y con lo que hace media/cloudinary.service. Esa coherencia
 * es la parte que si controlamos.
 */
export const DISCLAIMER_SECTIONS: LegalSection[] = [
  {
    id: "naturaleza",
    icon: "userDoctor",
    title: "1. Naturaleza del servicio",
    body: [
      `Alfii es una herramienta de entretenimiento y desarrollo de habilidades de comunicacion interpersonal, operada por ${OPERATOR}.`,
      "Alfii NO es, ni pretende ser, un servicio de asesoria psicologica, psiquiatrica, terapeutica, medica, legal, financiera ni de trabajo social.",
      "El uso de Alfii no crea ninguna relacion profesional-paciente, terapeuta-cliente, abogado-cliente ni de asesoria fiduciaria de ningun tipo.",
      "Si necesitas apoyo en salud mental, atraviesas una crisis emocional, o enfrentas una situacion que afecta tu bienestar, acude a un profesional acreditado en tu jurisdiccion. Alfii no sustituye esa atencion en ninguna circunstancia.",
    ],
  },
  {
    id: "ia",
    icon: "robot",
    title: "2. Contenido generado por inteligencia artificial",
    body: [
      "Todo el analisis, diagnostico de arquetipo, evaluacion de riesgo, recomendacion de tiempos y texto sugerido que entrega Alfii es generado automaticamente por modelos de lenguaje de inteligencia artificial.",
      "Ese contenido puede ser inexacto, incompleto, sesgado, desactualizado o simplemente equivocado. No constituye juicio humano, evaluacion profesional ni diagnostico de ninguna clase.",
      "Los modelos de IA no conocen a las personas analizadas, no tienen acceso a informacion mas alla del texto que el usuario proporciona, y pueden interpretar erroneamente el contexto, la ironia, el sarcasmo, las referencias culturales o el historial de una relacion.",
      "El usuario es la unica persona que decide que hacer con la informacion que recibe, y lo hace bajo su propio criterio y riesgo.",
      "Se informa expresamente que el usuario interactua con un sistema automatizado y no con una persona.",
    ],
  },
  {
    id: "resultados",
    icon: "chartLine",
    title: "3. Ausencia de garantia de resultados",
    body: [
      "Alfii NO garantiza ningun resultado romantico, sexual, social, emocional ni de ninguna otra naturaleza.",
      "Los indicadores de progreso que muestra la aplicacion (primer beso, primera cita, primera noche) son estimaciones probabilisticas generadas por inteligencia artificial con fines exclusivamente orientativos e ilustrativos. NO son predicciones, pronosticos ni promesas, y no deben interpretarse como tales.",
      "No se realiza ninguna afirmacion sobre tasas de exito, porcentajes de efectividad, numero de resultados obtenidos por otros usuarios ni comparaciones de desempeno.",
      "Cualquier resultado que un usuario obtenga depende de innumerables factores fuera del control de Alfii, incluidas las decisiones libres de terceras personas.",
    ],
  },
  {
    id: "responsabilidad-usuario",
    icon: "scaleBalanced",
    title: "4. Responsabilidad exclusiva del usuario",
    body: [
      "Todas las decisiones, mensajes, conductas y acciones que el usuario adopte son exclusivamente suyas.",
      `${OPERATOR} no asume responsabilidad alguna por consecuencias emocionales, sentimentales, sociales, reputacionales, economicas, laborales, familiares o legales derivadas del uso de la aplicacion o de la aplicacion de sus sugerencias.`,
      "El usuario reconoce que las sugerencias de Alfii son opciones a considerar, no instrucciones a ejecutar, y que conserva en todo momento la responsabilidad de evaluar si son apropiadas para su situacion concreta.",
    ],
  },
  {
    id: "usos-prohibidos",
    icon: "hand",
    title: "5. Usos prohibidos",
    body: [
      "Queda expresamente prohibido utilizar Alfii para:",
      "• Acosar, hostigar, intimidar, amenazar o perseguir a cualquier persona.",
      "• Vigilar, rastrear, espiar o monitorear a cualquier persona sin su conocimiento y consentimiento.",
      "• Coaccionar, chantajear, extorsionar o presionar a cualquier persona.",
      "• Suplantar la identidad de otra persona o crear perfiles falsos.",
      "• Manipular a personas en situacion de vulnerabilidad, incluidas personas con discapacidad cognitiva, bajo los efectos de sustancias, o en estado de crisis emocional.",
      "• Interactuar de cualquier forma con personas menores de 18 anos.",
      "• Obtener, generar, solicitar o difundir contenido intimo sin consentimiento.",
      "• Planificar o facilitar violencia fisica, sexual o psicologica.",
      "• Eludir una negativa expresa o tacita de otra persona.",
      "El incumplimiento de cualquiera de estas prohibiciones da lugar a la terminacion inmediata de la cuenta, sin reembolso, y al reporte a las autoridades competentes cuando la conducta pueda constituir delito.",
    ],
  },
  {
    id: "datos-terceros",
    icon: "image",
    title: "6. Contenido de terceros y capturas de pantalla",
    body: [
      "Al cargar una captura de pantalla o transcribir una conversacion, el usuario DECLARA Y GARANTIZA que:",
      "• Participo legitimamente en esa conversacion como una de las partes.",
      "• Tiene derecho legal a acceder a ese contenido.",
      "• No esta cargando conversaciones ajenas, obtenidas sin autorizacion, mediante acceso no consentido a dispositivos o cuentas de terceros, ni obtenidas por medios ilicitos.",
      "• Asume responsabilidad exclusiva por el contenido que carga y por el tratamiento de los datos personales de terceros contenidos en el.",
      `${OPERATOR} actua como proveedor de una herramienta de procesamiento a instancia del usuario. El usuario es responsable de la licitud del contenido que aporta.`,
      "Las imagenes cargadas se conservan asociadas a tu cuenta y al expediente, sin metadatos del archivo, en almacenamiento autenticado sin direccion publica: solo se sirven mediante enlaces firmados y temporales generados para ti. No aparecen en registros de sistema ni se comparten con otros usuarios.",
      "El usuario puede eliminar la totalidad de su historial y de su cuenta en cualquier momento desde la propia aplicacion.",
    ],
  },
  {
    id: "consentimiento",
    icon: "handHoldingHeart",
    title: "7. Consentimiento y prohibicion de manipulacion",
    body: [
      "Alfii se ofrece como herramienta para COMPRENDER la comunicacion interpersonal y DETECTAR senales de riesgo, no para vencer la voluntad de otra persona.",
      "Toda interaccion interpersonal exige consentimiento libre, informado, especifico y revocable en cualquier momento. Una negativa es definitiva y no es un obstaculo a superar.",
      "El sistema esta configurado para negarse a asistir cuando detecta intencion de presionar, insistir sobre una negativa, coaccionar o manipular.",
      "El usuario reconoce que utilizar la herramienta con esos fines constituye un incumplimiento grave de estos terminos, con independencia de las responsabilidades legales que pueda generar.",
    ],
  },
  {
    id: "salud-mental",
    icon: "lifeRing",
    title: "8. Salud mental y situaciones de crisis",
    body: [
      "Si en cualquier momento el usuario, o la persona cuya conversacion se analiza, manifiesta ideacion suicida, intencion de autolesion, riesgo de violencia, o cualquier otra senal de crisis, Alfii interrumpe la asesoria y deriva a recursos de ayuda profesional.",
      "Esta interrupcion es una medida de seguridad y no es negociable ni omitible por el usuario.",
      "Alfii no puede evaluar riesgo clinico, no tiene capacidad de intervencion en crisis y no monitorea a los usuarios. Si existe peligro inmediato para la vida o la integridad de alguien, contacta a los servicios de emergencia de tu pais.",
      "Recursos de referencia: Ecuador 171 (opcion 6) y ECU 911; Mexico 800 911 2000; Colombia 106; Espana 024; Estados Unidos 988; directorio internacional en findahelpline.com.",
    ],
  },
  {
    id: "limitacion",
    icon: "shieldHalved",
    title: "9. Limitacion de responsabilidad",
    body: [
      `En la maxima medida permitida por la ley aplicable, ${OPERATOR} no sera responsable por danos indirectos, incidentales, especiales, consecuenciales, punitivos ni ejemplares, ni por lucro cesante, perdida de oportunidad, dano moral, dano reputacional o perdida de datos, derivados del uso o de la imposibilidad de uso de la aplicacion.`,
      `La responsabilidad total y agregada de ${OPERATOR} frente al usuario, por cualquier causa y bajo cualquier teoria de responsabilidad, no excedera el mayor de: (a) el monto efectivamente pagado por el usuario en los doce meses anteriores al hecho que origina el reclamo, o (b) cincuenta dolares de los Estados Unidos de America (USD 50).`,
      "El servicio se proporciona TAL CUAL y SEGUN DISPONIBILIDAD, sin garantias de ningun tipo, expresas o implicitas, incluidas de forma no limitativa las garantias de comerciabilidad, idoneidad para un fin determinado, precision, disponibilidad continua o ausencia de errores.",
      "Algunas jurisdicciones no permiten determinadas exclusiones o limitaciones de responsabilidad. En esos casos, las limitaciones anteriores se aplicaran en la maxima medida permitida y no afectaran los derechos que la ley reconozca de forma irrenunciable al consumidor.",
    ],
  },
  {
    id: "indemnidad",
    icon: "userShield",
    title: "10. Indemnidad",
    body: [
      `El usuario se obliga a mantener indemne y a defender a ${OPERATOR}, asi como a las personas que operan el servicio, frente a cualquier reclamo, demanda, denuncia, sancion, dano, perdida, costo o gasto (incluidos honorarios legales razonables) que derive de:`,
      "• El uso que el usuario haga de la aplicacion.",
      "• El contenido que el usuario cargue, incluidas conversaciones y datos personales de terceros.",
      "• Reclamos formulados por personas cuyas conversaciones el usuario haya cargado.",
      "• El incumplimiento por parte del usuario de estos terminos o de la ley aplicable.",
    ],
  },
  {
    id: "terminacion",
    icon: "ban",
    title: "11. Suspension y terminacion",
    body: [
      `${OPERATOR} puede suspender o cancelar el acceso de un usuario, con o sin aviso previo, en caso de incumplimiento de estos terminos, uso prohibido, riesgo para terceros o requerimiento de autoridad competente.`,
      "El usuario puede cancelar su cuenta en cualquier momento desde la aplicacion. La cancelacion elimina de forma permanente su historial, expedientes y analisis.",
      "Antes de la cancelacion, el usuario puede exportar sus datos desde la propia aplicacion.",
      "El servicio puede modificarse, suspenderse o discontinuarse en cualquier momento. Cuando sea razonablemente posible, se dara aviso previo.",
    ],
  },
  {
    id: "jurisdiccion",
    icon: "gavel",
    title: "12. Ley aplicable, jurisdiccion y modificaciones",
    body: [
      "Estos terminos se rigen por las leyes de la Republica del Ecuador, sin perjuicio de las normas imperativas de proteccion al consumidor y de proteccion de datos personales del pais de residencia habitual del usuario, que se aplicaran cuando resulten mas favorables para el.",
      "Cualquier controversia se sometera a los jueces y tribunales competentes de la Republica del Ecuador, salvo que la ley del domicilio del usuario disponga un foro irrenunciable distinto.",
      "Estos documentos pueden actualizarse. Cada version tiene un identificador y una huella digital verificable. Cuando se publique una version nueva, se solicitara la aceptacion del usuario antes de continuar utilizando el servicio, y quedara registro de que version acepto y en que fecha.",
      `Contacto legal: ${LEGAL_EMAIL}. Contacto de privacidad: ${PRIVACY_EMAIL}.`,
    ],
  },
];

/** Resumen en lenguaje claro. Va ANTES del texto formal: el RGPD exige
 *  lenguaje claro y sencillo, y un resumen honesto refuerza la validez del
 *  consentimiento en lugar de debilitarla. */
export const PLAIN_SUMMARY = {
  title: "Lo esencial, en 30 segundos",
  points: [
    { icon: "robot", text: "Todo el analisis lo genera una inteligencia artificial. Puede equivocarse." },
    { icon: "userDoctor", text: "No es terapia ni asesoria profesional de ningun tipo." },
    { icon: "chartLine", text: "No garantizamos ningun resultado. Los porcentajes son estimaciones, no predicciones." },
    { icon: "hand", text: "Prohibido usarlo para acosar, presionar, vigilar o manipular a nadie." },
    { icon: "image", text: "Solo subes conversaciones en las que tu participaste." },
    { icon: "userShield", text: "Tus capturas quedan solo en tu expediente privado. Puedes borrar todo cuando quieras." },
    { icon: "scaleBalanced", text: "Las decisiones y sus consecuencias son tuyas." },
    { icon: "cakeCandles", text: "Servicio exclusivo para personas mayores de 18 anos." },
  ],
};
