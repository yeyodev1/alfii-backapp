import { env } from "../env";
import type { LegalSection } from "./disclaimer";

const OPERATOR = env.LEGAL_OPERATOR;
const PRIVACY_EMAIL = env.LEGAL_CONTACT_PRIVACY;

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "responsable",
    icon: "userShield",
    title: "1. Quien trata tus datos",
    body: [
      `Responsable del tratamiento: ${OPERATOR}.`,
      `Canal para ejercer derechos y para cualquier consulta de privacidad: ${PRIVACY_EMAIL}.`,
      "Este canal es funcional y atendido. Toda solicitud recibe respuesta en los plazos que exige la normativa aplicable a tu pais de residencia.",
    ],
  },
  {
    id: "que-datos",
    icon: "database",
    title: "2. Que datos tratamos y que NO pedimos",
    body: [
      "Datos que tratamos:",
      "• Correo electronico y contrasena (almacenada solo como hash bcrypt).",
      "• El nombre o apodo con el que quieres que Alfii se dirija a ti. Puede ser ficticio.",
      "• Tu fecha de nacimiento, si decides proporcionarla. Es opcional y sirve unicamente para calibrar el tono de las recomendaciones. La edad se calcula a partir de ella y no se solicita por separado.",
      "• Los datos de tu perfil estrategico: profesion, nivel de exito autodeclarado, cualidades que te atribuyes, lo que buscas, tus limites y tu estilo de personalidad. Todos opcionales.",
      "• El texto extraido de las conversaciones que cargas, los analisis generados y tu historial de chat con Alfii.",
      "• El apodo o nombre que asignas a cada expediente.",
      "• Un hash irreversible de tu direccion IP y tu identificador de navegador, unicamente en el momento de aceptar los documentos legales, para poder acreditar esa aceptacion.",
      "• Metricas tecnicas de uso: numero de analisis, tiempos de respuesta, consumo de procesamiento. Nunca asociadas al contenido.",
      "Datos que NO pedimos ni tratamos:",
      "• Nombre legal completo, apellidos ni documentos de identidad.",
      "• Numero de telefono.",
      "• Direccion fisica.",
      "• Datos de tarjetas o medios de pago.",
      "• Datos de geolocalizacion.",
      "• Contactos de tu dispositivo, agenda, galeria completa ni permisos de fondo.",
    ],
  },
  {
    id: "imagenes",
    icon: "image",
    title: "3. Tratamiento de las capturas de pantalla",
    body: [
      "Este es el punto mas importante de este aviso.",
      "Las capturas que cargas SI se conservan, vinculadas a tu cuenta y al expediente correspondiente, para que puedas releer la conversacion original junto al analisis. El flujo es: la imagen llega al servidor, se comprime y se le eliminan los metadatos del archivo (incluida la geolocalizacion), se transmite al proveedor de inteligencia artificial para extraer el texto, y se almacena en nuestro proveedor de imagenes.",
      "Se almacenan en modo autenticado: no existe ninguna direccion publica que permita verlas. La aplicacion genera un enlace firmado y temporal cada vez que tu abres el expediente, y ese enlace caduca.",
      "No aparecen en registros del sistema, no se indexan, no se comparten con otros usuarios y no se utilizan para entrenar modelos.",
      "Tambien se conserva el TEXTO extraido de la conversacion y el analisis generado, que es lo que permite que Alfii mejore su precision contigo con cada interaccion.",
      "Puedes eliminar todo ese contenido en cualquier momento desde la aplicacion. Al borrar un expediente o tu cuenta, las imagenes asociadas se eliminan tambien del proveedor de almacenamiento.",
    ],
  },
  {
    id: "finalidades",
    icon: "listCheck",
    title: "4. Para que usamos los datos y con que base legal",
    body: [
      "• Prestar el servicio (autenticacion, generar analisis, mantener tu historial y tus expedientes). Base legal: ejecucion del contrato.",
      "• Personalizar las recomendaciones a partir de tu perfil y tu fecha de nacimiento. Base legal: tu consentimiento explicito, revocable en cualquier momento.",
      "• Seguridad, prevencion de abuso y cumplimiento de las prohibiciones de uso. Base legal: interes legitimo.",
      "• Acreditar la aceptacion de los documentos legales. Base legal: cumplimiento de obligacion legal e interes legitimo en la prueba.",
      "• Mejorar el servicio mediante metricas tecnicas agregadas y sin contenido. Base legal: interes legitimo.",
      "NO usamos tus datos para publicidad, para elaborar perfiles comerciales, ni para entrenar modelos de inteligencia artificial.",
      "NO vendemos ni compartimos tus datos personales con terceros con fines comerciales, en ningun caso.",
    ],
  },
  {
    id: "automatizado",
    icon: "robot",
    title: "5. Tratamiento automatizado y elaboracion de perfiles",
    body: [
      "El servicio se basa en tratamiento automatizado mediante modelos de lenguaje. Se te informa expresamente de ello.",
      "Logica del tratamiento: el sistema recibe el texto de la conversacion junto con tu perfil y el historial del expediente, y genera una interpretacion del subtexto, una clasificacion tipologica de la persona analizada, una estimacion de riesgo, una recomendacion de tiempo de respuesta y tres propuestas de mensaje.",
      "Consecuencias: el resultado es una sugerencia orientativa. No produce ningun efecto juridico sobre ti ni sobre terceros, no condiciona el acceso a ningun derecho, servicio o prestacion, y no se utiliza para tomar decisiones sobre ti.",
      "Puedes solicitar en cualquier momento explicacion adicional sobre el tratamiento, oponerte a el, o cancelar tu cuenta.",
    ],
  },
  {
    id: "terceros",
    icon: "users",
    title: "6. Datos de terceras personas",
    body: [
      "Cuando cargas una conversacion, esta contiene datos de otra persona. Tratamos ese contenido unicamente a tu instancia y para prestarte el servicio.",
      "Medidas de minimizacion aplicadas: las imagenes se guardan sin metadatos del archivo y sin acceso publico, y se borran junto con el expediente; no se solicitan ni se almacenan apellidos, telefonos, direcciones ni identificadores de esa persona; el expediente se identifica con el apodo que tu elijas; no se cruzan datos entre usuarios; no se construyen perfiles de personas que no son usuarias del servicio mas alla del expediente privado de tu propia cuenta, accesible solo por ti.",
      "Como usuario, declaras contar con legitimacion para aportar ese contenido y asumes la responsabilidad correspondiente, conforme a la seccion 6 del Descargo de Responsabilidad.",
      `Si eres una persona cuya conversacion pudo haber sido cargada por un tercero y deseas ejercer tus derechos, escribe a ${PRIVACY_EMAIL} y atenderemos tu solicitud en la medida en que sea tecnicamente posible identificar la informacion.`,
    ],
  },
  {
    id: "encargados",
    icon: "cloud",
    title: "7. Encargados y transferencias internacionales",
    body: [
      "Proveedores que intervienen en el tratamiento:",
      "• Google LLC (Gemini API): procesamiento del texto y de las imagenes para generar el analisis. Infraestructura ubicada, entre otros paises, en Estados Unidos.",
      "• OpenAI, L.L.C.: procesamiento del texto y de las imagenes cuando el proveedor principal no esta disponible. Infraestructura ubicada, entre otros paises, en Estados Unidos. Los datos enviados a traves de la API no se utilizan para entrenar sus modelos.",
      "• Cloudinary Ltd.: almacenamiento de las capturas en modo autenticado, con entrega mediante enlaces firmados y temporales.",
      "• MongoDB Atlas: almacenamiento de la base de datos.",
      "• Proveedor de alojamiento del servidor de la aplicacion.",
      "Existen transferencias internacionales de datos hacia Estados Unidos. Se amparan en los mecanismos previstos por la normativa aplicable: decisiones de adecuacion o marcos equivalentes cuando resulten aplicables, y clausulas contractuales tipo con los encargados.",
      "Ninguno de estos proveedores esta autorizado a utilizar tus datos para finalidades propias.",
    ],
  },
  {
    id: "conservacion",
    icon: "clockRotateLeft",
    title: "8. Plazos de conservacion",
    body: [
      "• Imagenes de capturas: no se conservan. Cero segundos de persistencia.",
      "• Cuenta, perfil, expedientes, analisis e historial: mientras la cuenta este activa. Si no registras actividad durante 24 meses consecutivos, se eliminan de forma automatica previo aviso al correo registrado.",
      "• Registro de aceptacion de documentos legales: 6 anos desde la baja de la cuenta, por su valor probatorio.",
      "• Metricas tecnicas agregadas y sin contenido ni identificadores: de forma indefinida en formato anonimo.",
      "• Tras solicitar la eliminacion: el borrado es inmediato y no reversible. No conservamos copias de respaldo del contenido eliminado mas alla de 30 dias por rotacion tecnica de respaldos.",
    ],
  },
  {
    id: "derechos",
    icon: "scaleBalanced",
    title: "9. Tus derechos",
    body: [
      "Puedes ejercer en cualquier momento los derechos de: acceso, rectificacion, eliminacion, portabilidad, oposicion, limitacion del tratamiento, retirada del consentimiento y a no ser objeto de decisiones exclusivamente automatizadas con efectos juridicos.",
      "Dos de ellos son inmediatos y estan implementados en la propia aplicacion, sin necesidad de escribir a nadie:",
      "• Exportar todos tus datos en formato estructurado y legible por maquina.",
      "• Eliminar de forma permanente tu cuenta y todo su contenido.",
      `Para el resto, escribe a ${PRIVACY_EMAIL}.`,
      "Si consideras que tus derechos no fueron atendidos correctamente, puedes reclamar ante la autoridad de proteccion de datos de tu pais. El anexo regional indica cual es la competente en tu caso.",
    ],
  },
  {
    id: "seguridad",
    icon: "lock",
    title: "10. Seguridad y una advertencia honesta",
    body: [
      "Medidas aplicadas: transmision cifrada, contrasenas solo como hash bcrypt, aislamiento estricto por usuario en cada consulta, limites de frecuencia de uso, registros de sistema que no contienen contenido de conversaciones, y almacenamiento de las capturas en modo autenticado, sin direccion publica y con entrega solo mediante enlaces firmados de vida corta.",
      "Advertencia honesta y deliberada: Alfii NO utiliza cifrado de extremo a extremo, y no seria veraz afirmar lo contrario. El servidor necesita leer el texto de la conversacion para poder analizarlo. Lo que si garantizamos es que ese contenido no se usa para otra finalidad, que no se comparte, que no aparece en registros, y que puedes eliminarlo por completo cuando quieras.",
      "Preferimos decirte esto con precision antes que ofrecerte una promesa absoluta que la arquitectura no puede cumplir.",
      "Ningun sistema es invulnerable. En caso de una brecha que afecte a tus datos, se te notificara y se comunicara a la autoridad competente en los plazos legales.",
    ],
  },
  {
    id: "menores",
    icon: "cakeCandles",
    title: "11. Menores de edad",
    body: [
      "El servicio esta dirigido exclusivamente a personas mayores de 18 anos y no se ofrece ni se comercializa a menores.",
      "No recabamos de forma consciente datos de personas menores de edad. Si detectamos o se nos informa de una cuenta de un menor, se elimina de inmediato junto con todos sus datos.",
    ],
  },
  {
    id: "cambios",
    icon: "fileSignature",
    title: "12. Cambios en este aviso",
    body: [
      "Este aviso puede actualizarse. Cada version lleva identificador y huella digital verificable.",
      "Cuando se publique una version nueva se solicitara tu aceptacion antes de continuar utilizando el servicio, y podras consultar y descargar el registro de que version aceptaste y en que fecha.",
    ],
  },
];
