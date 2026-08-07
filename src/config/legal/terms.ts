import { env } from "../env";
import type { LegalSection } from "./disclaimer";

const OPERATOR = env.LEGAL_OPERATOR;
const LEGAL_EMAIL = env.LEGAL_CONTACT_LEGAL;

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "aceptacion",
    icon: "fileSignature",
    title: "1. Aceptacion de los terminos",
    body: [
      `Al crear una cuenta o utilizar Alfii, operado por ${OPERATOR}, aceptas estos Terminos de Uso, el Aviso de Privacidad y el Descargo de Responsabilidad, que forman un unico acuerdo.`,
      "Si no estas de acuerdo con alguna parte, no utilices el servicio.",
      "La aceptacion queda registrada con la version del documento, su huella digital y la fecha, para que ambas partes puedan acreditar exactamente que se acepto y cuando.",
    ],
  },
  {
    id: "elegibilidad",
    icon: "cakeCandles",
    title: "2. Elegibilidad y edad minima",
    body: [
      "Alfii es un servicio exclusivamente para personas mayores de 18 anos.",
      "Al registrarte confirmas expresamente que tienes 18 anos o mas y capacidad legal para obligarte por este acuerdo.",
      "Si detectamos o recibimos indicios razonables de que un usuario es menor de edad, la cuenta se cancela de inmediato y se eliminan sus datos.",
      "Queda terminantemente prohibido utilizar el servicio en relacion con personas menores de edad, sea cual sea el contexto.",
    ],
  },
  {
    id: "cuenta",
    icon: "key",
    title: "3. Cuenta y seguridad",
    body: [
      "Para conservar tu historial necesitas una cuenta. Solo pedimos un correo electronico y una contrasena. No pedimos nombre legal, documento de identidad, telefono ni datos de pago.",
      "El nombre con el que Alfii se dirige a ti puede ser un apodo. No requerimos que sea tu nombre real.",
      "Eres responsable de mantener la confidencialidad de tu contrasena y de toda la actividad realizada desde tu cuenta.",
      "Las contrasenas se almacenan unicamente como hash con algoritmo bcrypt. No podemos recuperarlas ni conocerlas.",
      "Notifica de inmediato cualquier uso no autorizado de tu cuenta.",
    ],
  },
  {
    id: "licencia",
    icon: "fileContract",
    title: "4. Licencia de uso",
    body: [
      "Se concede una licencia personal, limitada, revocable, no exclusiva y no transferible para usar Alfii con fines personales y no comerciales.",
      "No puedes: revender el acceso, automatizar el uso mediante scripts o bots, realizar ingenieria inversa, extraer los prompts o la logica del sistema, ni utilizar el servicio para entrenar modelos propios.",
      "No puedes utilizar el servicio para prestar servicios de asesoria a terceros ni para operaciones comerciales de ningun tipo sin autorizacion expresa por escrito.",
    ],
  },
  {
    id: "contenido-usuario",
    icon: "image",
    title: "5. Contenido del usuario",
    body: [
      "Conservas la titularidad de todo el contenido que cargas.",
      "Nos concedes unicamente la licencia tecnica minima e indispensable para procesar ese contenido y prestarte el servicio: transmitirlo al proveedor de inteligencia artificial, extraer el texto y generar el analisis.",
      "No usamos tu contenido para entrenar modelos, no lo vendemos, no lo cedemos con fines publicitarios y no lo compartimos con terceros distintos de los proveedores tecnicos indispensables.",
      "Las imagenes se conservan en tu expediente privado, en almacenamiento autenticado y sin acceso publico. Se borran cuando borras el expediente o la cuenta.",
    ],
  },
  {
    id: "conducta",
    icon: "hand",
    title: "6. Conducta prohibida",
    body: [
      "Aplican integramente las prohibiciones de la seccion 5 del Descargo de Responsabilidad, que forman parte de estos terminos.",
      "Adicionalmente queda prohibido: intentar vulnerar la seguridad del servicio, sobrecargarlo de forma deliberada, acceder a cuentas de otros usuarios, o intentar identificar a otros usuarios o a las personas mencionadas en sus conversaciones.",
    ],
  },
  {
    id: "ia-terceros",
    icon: "robot",
    title: "7. Proveedores de inteligencia artificial",
    body: [
      "Alfii utiliza modelos de lenguaje de Google (Gemini) para el procesamiento del texto y de las imagenes, y de OpenAI como proveedor de respaldo cuando el principal no esta disponible.",
      "Ese proveedor actua como subencargado del tratamiento. El contenido se transmite para su procesamiento y se rige adicionalmente por las politicas de uso del proveedor.",
      "El procesamiento se realiza en infraestructura ubicada, entre otros paises, en los Estados Unidos de America. Consulta el Aviso de Privacidad para el detalle de las transferencias internacionales.",
      "Alfii no controla el funcionamiento interno de esos modelos y no responde por sus resultados mas alla de lo previsto en el Descargo de Responsabilidad.",
    ],
  },
  {
    id: "precio",
    icon: "tag",
    title: "8. Precio y cambios en el servicio",
    body: [
      "La version actual del servicio se ofrece sin costo.",
      "Si en el futuro se introducen funciones de pago, se informara con claridad antes de cualquier cobro y nunca se cobrara sin autorizacion expresa.",
      "Las funciones pueden cambiar, ampliarse o retirarse. Se procurara dar aviso previo de cambios sustanciales.",
    ],
  },
  {
    id: "propiedad",
    icon: "copyright",
    title: "9. Propiedad intelectual",
    body: [
      `La aplicacion, su nombre, su identidad visual, su codigo, sus prompts y su metodologia son propiedad de ${OPERATOR} y estan protegidos por la legislacion aplicable.`,
      "Nada en estos terminos transfiere derechos de propiedad intelectual al usuario.",
    ],
  },
  {
    id: "modificaciones",
    icon: "gavel",
    title: "10. Modificaciones, ley aplicable y contacto",
    body: [
      "Estos terminos pueden actualizarse. Cada version lleva identificador y huella digital, y se solicitara tu aceptacion antes de continuar usando el servicio.",
      "Aplican la ley y la jurisdiccion indicadas en la seccion 12 del Descargo de Responsabilidad.",
      "Si alguna clausula resulta invalida o inaplicable, el resto conserva plena vigencia.",
      `Contacto: ${LEGAL_EMAIL}.`,
    ],
  },
];
