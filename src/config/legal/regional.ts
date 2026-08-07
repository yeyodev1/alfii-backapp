import { env } from "../env";
import type { LegalSection } from "./disclaimer";

const PRIVACY_EMAIL = env.LEGAL_CONTACT_PRIVACY;
const OPERATOR = env.LEGAL_OPERATOR;

export interface RegionalAnnex {
  id: "eu" | "us" | "latam";
  icon: string;
  label: string;
  intro: string;
  sections: LegalSection[];
}

const EU_ANNEX: RegionalAnnex = {
  id: "eu",
  icon: "earthEurope",
  label: "Europa",
  intro:
    "Anexo aplicable a usuarios residentes en el Espacio Economico Europeo, Suiza y Reino Unido, conforme al Reglamento General de Proteccion de Datos y normativa equivalente.",
  sections: [
    {
      id: "eu-responsable",
      icon: "userShield",
      title: "Responsable y representante",
      body: [
        `Responsable del tratamiento: ${OPERATOR}, establecido fuera de la Union Europea.`,
        `Canal unico para el ejercicio de derechos: ${PRIVACY_EMAIL}.`,
        "Al ofrecer el servicio a residentes en la Union Europea, el responsable esta sujeto al RGPD conforme a su articulo 3.2 y, cuando resulte exigible, designara representante en la Union conforme al articulo 27. Hasta que dicha designacion se publique, todas las solicitudes se atienden por el canal indicado en los plazos del articulo 12.",
      ],
    },
    {
      id: "eu-bases",
      icon: "listCheck",
      title: "Bases juridicas del tratamiento (art. 6)",
      body: [
        "• Prestacion del servicio, autenticacion, generacion de analisis y conservacion del historial: articulo 6.1.b, ejecucion del contrato.",
        "• Personalizacion mediante fecha de nacimiento y perfil estrategico: articulo 6.1.a, consentimiento explicito, revocable en cualquier momento sin afectar la licitud del tratamiento previo.",
        "• Seguridad, prevencion de abuso y cumplimiento de las prohibiciones de uso: articulo 6.1.f, interes legitimo.",
        "• Conservacion del registro de aceptacion legal: articulos 6.1.c y 6.1.f.",
        "No se realiza ningun tratamiento con fines de mercadotecnia directa ni de elaboracion de perfiles comerciales.",
      ],
    },
    {
      id: "eu-derechos",
      icon: "scaleBalanced",
      title: "Derechos de la persona interesada (arts. 15 a 22)",
      body: [
        "Acceso, rectificacion, supresion, limitacion del tratamiento, portabilidad, oposicion, y a no ser objeto de decisiones basadas unicamente en tratamiento automatizado que produzcan efectos juridicos.",
        "Los derechos de portabilidad y supresion estan implementados directamente en la aplicacion y se ejecutan de forma inmediata, sin intermediacion.",
        "Derecho a retirar el consentimiento en cualquier momento respecto de los datos de personalizacion.",
        "Derecho a presentar reclamacion ante la autoridad de control competente de tu Estado miembro de residencia, lugar de trabajo o del lugar de la presunta infraccion.",
        "Plazo de respuesta: un mes desde la recepcion de la solicitud, prorrogable por dos meses adicionales en casos complejos con notificacion motivada.",
      ],
    },
    {
      id: "eu-transferencias",
      icon: "cloud",
      title: "Transferencias internacionales (cap. V)",
      body: [
        "Se producen transferencias de datos personales a Estados Unidos por la intervencion de Google LLC como encargado del procesamiento mediante la API de Gemini, y del proveedor de base de datos.",
        "Mecanismos de garantia: decision de adecuacion aplicable al proveedor cuando este certificado en el marco correspondiente, y en su defecto Clausulas Contractuales Tipo aprobadas por la Comision Europea, complementadas con evaluacion de impacto de la transferencia.",
        "Categorias de datos transferidos: texto de la conversacion aportada por el usuario, datos de perfil aportados por el usuario, e imagen de la captura, que se transmite a los proveedores de inteligencia artificial para la extraccion del texto y se conserva en el proveedor de almacenamiento en modo autenticado.",
        "El usuario es informado de que estas transferencias son inherentes al funcionamiento del servicio.",
      ],
    },
    {
      id: "eu-art22",
      icon: "robot",
      title: "Tratamiento automatizado y perfilado (art. 22)",
      body: [
        "El servicio realiza tratamiento automatizado que incluye la inferencia de rasgos de personalidad y de disposicion emocional de personas a partir del texto de una conversacion.",
        "Logica aplicada: un modelo de lenguaje recibe el texto aportado por el usuario junto con el perfil declarado por el propio usuario y el historial del expediente, y produce una interpretacion de subtexto, una clasificacion tipologica orientativa, una estimacion de riesgo y sugerencias de mensaje.",
        "Importancia y consecuencias previstas: el resultado es orientativo, no produce efectos juridicos ni afecta significativamente a ninguna persona en el sentido del articulo 22.1, no condiciona acceso a derechos, servicios, credito, empleo ni prestaciones, y no se comunica a terceros.",
        "No se tratan categorias especiales de datos del articulo 9 de forma deliberada. El usuario se compromete a no aportar datos de salud, origen etnico, convicciones religiosas, afiliacion sindical, vida sexual u orientacion sexual de terceros. Si aparecieran de forma incidental en el texto aportado, se tratan bajo la misma minimizacion y se eliminan con el resto del contenido.",
      ],
    },
    {
      id: "eu-ai-act",
      icon: "microchip",
      title: "Transparencia sobre inteligencia artificial",
      body: [
        "Conforme a las obligaciones de transparencia del Reglamento Europeo de Inteligencia Artificial, se informa de forma clara y destacada de que:",
        "• El usuario interactua con un sistema de inteligencia artificial y no con una persona.",
        "• Todo el contenido de analisis y las sugerencias de mensaje son generados artificialmente.",
        "• El sistema no se emplea en los contextos de uso prohibido previstos por dicho Reglamento, y en particular no se utiliza en ambitos laborales ni educativos.",
        "• El usuario puede solicitar informacion adicional sobre el funcionamiento del sistema por el canal de privacidad.",
      ],
    },
    {
      id: "eu-conservacion",
      icon: "clockRotateLeft",
      title: "Minimizacion y plazos",
      body: [
        "Principio de minimizacion aplicado por diseno: no se solicitan nombre legal, documento de identidad, telefono, direccion, medios de pago ni geolocalizacion. A las imagenes se les eliminan los metadatos del archivo, incluida la geolocalizacion, antes de almacenarlas.",
        "Plazos concretos, sin formulas indeterminadas: capturas cero segundos; cuenta y contenido mientras la cuenta este activa con supresion automatica a los 24 meses de inactividad; registro de aceptacion legal 6 anos desde la baja; metricas anonimas de forma indefinida.",
      ],
    },
  ],
};

const US_ANNEX: RegionalAnnex = {
  id: "us",
  icon: "flagUsa",
  label: "Estados Unidos",
  intro:
    "Annex applicable to residents of the United States. Anexo aplicable a residentes de los Estados Unidos, conforme a las leyes estatales de privacidad del consumidor.",
  sections: [
    {
      id: "us-notice",
      icon: "listCheck",
      title: "Notice at Collection",
      body: [
        "Categories of personal information collected: identifiers (email address), account credentials (hashed password), user-provided profile information (nickname, optional date of birth, self-declared attributes), user-generated content (text extracted from conversations you upload, generated analyses, chat history), and technical usage metrics.",
        "Purposes: to provide and secure the service, to personalize analyses, and to document acceptance of legal terms.",
        "We do NOT sell personal information. We do NOT share personal information for cross-context behavioral advertising. We do NOT use or disclose sensitive personal information beyond the purposes permitted by applicable law.",
        "Retention: uploaded images are not retained at all. Account content is retained while the account remains active, with automatic deletion after 24 consecutive months of inactivity. Legal acceptance records are retained for 6 years after account closure.",
      ],
    },
    {
      id: "us-rights",
      icon: "scaleBalanced",
      title: "Your rights (CCPA/CPRA and state privacy laws)",
      body: [
        "Residents of California, Virginia, Colorado, Connecticut, Utah, Texas, Oregon, Montana, and other states with comprehensive privacy statutes have the right to: know and access the personal information we hold, request correction of inaccurate information, request deletion, obtain a portable copy, opt out of sale or sharing (not applicable, as we do neither), and be free from unlawful discrimination for exercising these rights.",
        "Access (portability) and deletion are implemented directly in the application and execute immediately.",
        `For all other requests, contact ${PRIVACY_EMAIL}. We respond within 45 days, extendable once by an additional 45 days with notice.`,
        "You may designate an authorized agent to submit requests on your behalf, subject to reasonable verification.",
        "We do not process personal information of individuals we know to be under 18 years of age. The service is restricted to adults.",
      ],
    },
    {
      id: "us-ftc",
      icon: "chartLine",
      title: "No performance claims",
      body: [
        "Consistent with Section 5 of the FTC Act, we make no claims regarding outcomes, success rates, effectiveness percentages, or comparative performance.",
        "The progress indicators shown in the application are AI-generated probabilistic estimates for illustrative purposes only. They are not predictions, forecasts, or representations of likely results.",
        "All analysis is AI-generated and may be inaccurate. The service is entertainment and skills development, not professional advice of any kind.",
      ],
    },
    {
      id: "us-comms",
      icon: "image",
      title: "Communications and recordings",
      body: [
        "Certain states require the consent of all parties to record or intercept communications. Screenshots of conversations in which you are a participant are generally outside the scope of those statutes, but you remain solely responsible for the lawfulness of any content you upload.",
        "You represent that you were a party to every conversation you submit and that you have the legal right to access it. Uploading conversations obtained through unauthorized access to another person's device or account is strictly prohibited and may constitute a crime under federal and state law.",
      ],
    },
    {
      id: "us-liability",
      icon: "shieldHalved",
      title: "Limitation of liability",
      body: [
        "The limitations and indemnity provisions set out in sections 9 and 10 of the Disclaimer apply in full, to the maximum extent permitted by applicable law.",
        "This annex does not currently include a binding arbitration clause or class action waiver. Should such provisions be introduced in the future, they will be presented separately, clearly, and with an opportunity to opt out before taking effect.",
        "Nothing in these terms limits any right that applicable law makes non-waivable.",
      ],
    },
  ],
};

const LATAM_ANNEX: RegionalAnnex = {
  id: "latam",
  icon: "earthAmericas",
  label: "Latinoamerica",
  intro:
    "Anexo aplicable a usuarios residentes en Latinoamerica. Indica la norma y la autoridad competente segun el pais de residencia.",
  sections: [
    {
      id: "latam-ec",
      icon: "flag",
      title: "Ecuador",
      body: [
        "Norma aplicable: Ley Organica de Proteccion de Datos Personales y su reglamento. Jurisdiccion base del servicio.",
        "Autoridad competente: Superintendencia de Proteccion de Datos Personales.",
        "Derechos reconocidos: informacion, acceso, rectificacion y actualizacion, eliminacion, oposicion, portabilidad, anulacion, y a no ser objeto de decisiones automatizadas.",
        `Canal de ejercicio: ${PRIVACY_EMAIL}. Plazo de respuesta: 15 dias conforme a la normativa.`,
      ],
    },
    {
      id: "latam-mx",
      icon: "flag",
      title: "Mexico",
      body: [
        "Norma aplicable: Ley Federal de Proteccion de Datos Personales en Posesion de los Particulares y su reglamento.",
        "Este documento, junto con el Aviso de Privacidad, constituye el aviso de privacidad integral exigido por la normativa mexicana e incluye la identidad del responsable, las finalidades, las opciones para limitar el uso o divulgacion, los medios para ejercer derechos, las transferencias que requieren consentimiento y el procedimiento de cambios.",
        "Derechos ARCO: acceso, rectificacion, cancelacion y oposicion, ademas de la revocacion del consentimiento y la limitacion del uso o divulgacion.",
        `Canal de ejercicio: ${PRIVACY_EMAIL}. Puedes acudir a la autoridad federal competente en materia de proteccion de datos si consideras que tu solicitud no fue atendida.`,
        "Las transferencias internacionales descritas en el Aviso de Privacidad se realizan con tu consentimiento, otorgado al aceptar estos documentos.",
      ],
    },
    {
      id: "latam-br",
      icon: "flag",
      title: "Brasil",
      body: [
        "Norma aplicavel: Lei Geral de Protecao de Dados Pessoais (LGPD).",
        "Autoridade competente: Autoridade Nacional de Protecao de Dados (ANPD).",
        "Bases legais utilizadas: execucao de contrato, consentimento para dados de personalizacao, e legitimo interesse para seguranca e prevencao de abuso.",
        "Direitos do titular: confirmacao da existencia de tratamento, acesso, correcao, anonimizacao, bloqueio ou eliminacao, portabilidade, informacao sobre compartilhamento, revogacao do consentimento e revisao de decisoes automatizadas.",
        `Canal de exercicio de direitos e contato do encarregado: ${PRIVACY_EMAIL}.`,
        "Ha transferencia internacional de dados para os Estados Unidos, conforme descrito no Aviso de Privacidade, amparada em clausulas contratuais especificas.",
      ],
    },
    {
      id: "latam-co",
      icon: "flag",
      title: "Colombia",
      body: [
        "Norma aplicable: Ley 1581 de 2012 y Decreto 1377 de 2013.",
        "Autoridad competente: Superintendencia de Industria y Comercio, Delegatura para la Proteccion de Datos Personales.",
        "Al aceptar estos documentos otorgas autorizacion previa, expresa e informada para el tratamiento de tus datos personales con las finalidades aqui descritas.",
        "Derechos del titular: conocer, actualizar y rectificar tus datos; solicitar prueba de la autorizacion otorgada; ser informado sobre el uso dado a tus datos; presentar quejas ante la autoridad; revocar la autorizacion y solicitar la supresion.",
        `Canal de ejercicio: ${PRIVACY_EMAIL}.`,
      ],
    },
    {
      id: "latam-ar",
      icon: "flag",
      title: "Argentina",
      body: [
        "Norma aplicable: Ley 25.326 de Proteccion de los Datos Personales.",
        "Autoridad competente: Agencia de Acceso a la Informacion Publica.",
        "Derechos de acceso, rectificacion, actualizacion y supresion. El titular puede ejercer el derecho de acceso de forma gratuita a intervalos no inferiores a seis meses, salvo interes legitimo acreditado.",
        `Canal de ejercicio: ${PRIVACY_EMAIL}.`,
      ],
    },
    {
      id: "latam-cl",
      icon: "flag",
      title: "Chile",
      body: [
        "Norma aplicable: legislacion chilena de proteccion de datos personales vigente, en su regimen actualizado y alineado a estandares internacionales.",
        "Derechos de acceso, rectificacion, supresion, oposicion, portabilidad y bloqueo.",
        `Canal de ejercicio: ${PRIVACY_EMAIL}.`,
      ],
    },
    {
      id: "latam-pe",
      icon: "flag",
      title: "Peru",
      body: [
        "Norma aplicable: Ley 29733 de Proteccion de Datos Personales y su reglamento.",
        "Autoridad competente: Autoridad Nacional de Proteccion de Datos Personales.",
        "Derechos de informacion, acceso, actualizacion, inclusion, rectificacion, supresion, oposicion, y a impedir el suministro de datos.",
        `Canal de ejercicio: ${PRIVACY_EMAIL}.`,
      ],
    },
    {
      id: "latam-otros",
      icon: "earthAmericas",
      title: "Otros paises de la region",
      body: [
        "Si resides en un pais de Latinoamerica no listado expresamente, se aplican los derechos y garantias descritos en el Aviso de Privacidad, ademas de los que te reconozca la normativa local de proteccion de datos y de defensa del consumidor.",
        `Puedes ejercer cualquiera de ellos escribiendo a ${PRIVACY_EMAIL}.`,
      ],
    },
  ],
};

export const REGIONAL_ANNEXES: RegionalAnnex[] = [LATAM_ANNEX, US_ANNEX, EU_ANNEX];

const EU_LOCALES = new Set([
  "es-ES", "de", "de-DE", "fr", "fr-FR", "it", "it-IT", "pt-PT", "nl", "nl-NL",
  "pl", "sv", "da", "fi", "el", "cs", "ro", "hu", "bg", "hr", "sk", "sl",
  "et", "lv", "lt", "ga", "mt", "en-GB", "en-IE",
]);

const US_LOCALES = new Set(["en-US", "en"]);

export function detectRegion(locale?: string): RegionalAnnex["id"] {
  if (!locale) return "latam";
  if (EU_LOCALES.has(locale)) return "eu";
  if (US_LOCALES.has(locale)) return "us";
  if (locale.startsWith("pt-BR") || locale.startsWith("es-")) return "latam";
  return "latam";
}
