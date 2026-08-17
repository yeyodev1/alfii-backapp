import { z } from "zod";

/**
 * Validacion de entorno al arrancar. Falla rapido y con mensaje claro:
 * una variable faltante debe romper el boot, no aparecer como un 500 raro
 * tres endpoints mas adelante.
 */
/**
 * Boolean de env que entiende "false". OJO: z.coerce.boolean() usa Boolean()
 * de JS, donde CUALQUIER cadena no vacia es true — con el, MAIL_ENABLED=false
 * encendia el correo igual. Aqui solo "true"/"1"/"yes" activan.
 */
const envBool = (def: boolean) =>
  z
    .string()
    .default(def ? "true" : "false")
    .transform((v) => ["true", "1", "yes"].includes(v.trim().toLowerCase()));

const envSchema = z.object({
  DB_URI: z.string().min(1, "DB_URI es obligatoria"),
  DB_PASSWORD: z.string().min(1, "DB_PASSWORD es obligatoria"),
  DB_NAME: z.string().min(1).default("alfii_dev"),

  PORT: z.coerce.number().int().positive().default(8100),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET debe tener al menos 32 caracteres"),
  JWT_EXPIRES_IN: z.string().default("30d"),

  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY es obligatoria"),
  GEMINI_BILLING_CONFIRMED: envBool(true),
  GEMINI_MODEL_VISION: z.string().default("gemini-2.5-flash"),
  /**
   * Conversacion: el modelo mas barato del catalogo de Gemini.
   *
   * Precios por 1M tokens (marzo 2026, ai.google.dev/gemini-api/docs/pricing):
   *   gemini-2.5-flash-lite  $0.10 in / $0.40 out   <- este
   *   gemini-2.5-flash       $0.30 in / $2.50 out
   *   gemini-3-flash-preview $0.50 in / $3.00 out
   *   gemini-3.6-flash       $1.50 in / $7.50 out
   * Conversar sale 6x mas barato en salida sin cambiar nada mas: el turno de
   * chat no necesita el modelo que lee subtexto de una captura.
   */
  GEMINI_MODEL_CHAT: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_MODEL_ANALYSIS: z.string().default("gemini-3.6-flash"),

  /**
   * Cadena de proveedores por orden de preferencia. Gemini primero por costo;
   * OpenAI entra solo cuando Gemini falla o bloquea. DeepSeek es texto puro:
   * el gateway lo salta automaticamente en tareas con imagen.
   */
  AI_PROVIDER_CHAIN: z.string().default("gemini,openai"),

  /**
   * Cadenas por tarea. Vacio = hereda AI_PROVIDER_CHAIN.
   *
   * Existen porque los proveedores no son igual de buenos en cada tarea: un
   * modelo puede ser el mas rapido conversando y el peor produciendo el JSON de
   * los 6 bloques. Una sola cadena global obliga a elegir el peor compromiso.
   */
  /**
   * Conversar arranca por DeepSeek: con el system prompt cacheado la entrada
   * cuesta $0.0028/1M frente a los $0.10 de Gemini Flash-Lite. Gemini y OpenAI
   * quedan detras como respaldo, que es justo para lo que existe la cadena.
   */
  AI_CHAIN_CHAT: z.string().default("deepseek,gemini,openai"),
  AI_CHAIN_ANALYSIS: z.string().default(""),
  AI_CHAIN_VISION: z.string().default(""),

  OPENAI_API_KEY: z.string().default(""),
  /**
   * Admin key (sk-admin-) SOLO para el endpoint de costos de la organizacion
   * en el portal admin. Las project keys no pueden leer facturacion. Nunca se
   * usa para inferencia (alli las admin keys fallan con 401, ver aviso abajo).
   */
  OPENAI_ADMIN_KEY: z.string().default(""),
  OPENAI_MODEL_VISION: z.string().default("gpt-5.6-terra"),
  /**
   * Conversacion: el mas barato de OpenAI (platform.openai.com/docs/pricing).
   *   gpt-5.6-luna  $0.20 in / $0.02 cache / $1.20 out   <- este
   *   gpt-5.4-nano  $0.20 in / $0.02 cache / $1.25 out
   *   gpt-5.4-mini  $0.75 in / $0.075 cache / $4.50 out
   * OpenAI solo entra cuando Gemini falla, pero cuando entra cobraba 3.75x de
   * mas en salida sin ninguna razon para un turno de chat.
   */
  OPENAI_MODEL_CHAT: z.string().default("gpt-5.6-luna"),
  OPENAI_MODEL_ANALYSIS: z.string().default("gpt-5.6-terra"),

  DEEPSEEK_API_KEY: z.string().default(""),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
  /** Razonamiento interno. Apagado por defecto: consume del mismo presupuesto
   *  que max_tokens y vaciaba las respuestas cortas. */
  DEEPSEEK_THINKING: envBool(false),
  /**
   * Conversacion: v4-flash, el mas barato de DeepSeek y el unico con Responses
   * API (api-docs.deepseek.com/quick_start/pricing).
   *   deepseek-v4-flash  $0.14 in miss / $0.0028 in hit / $0.28 out   <- este
   *   deepseek-v4-pro    $0.435 in miss / $0.003625 in hit / $0.87 out
   *
   * El precio de cache-hit es lo que lo hace ganar aqui: 50x mas barato que el
   * miss. El system prompt de Alfii se repite identico en cada turno, asi que a
   * partir del segundo mensaje casi toda la entrada entra a $0.0028.
   *
   * AVISO de la propia doc: DeepSeek anuncia una subida "significativa" de
   * precios proxima. Cuando llegue, revisar esta eleccion.
   */
  DEEPSEEK_MODEL_CHAT: z.string().default("deepseek-v4-flash"),
  DEEPSEEK_MODEL_ANALYSIS: z.string().default("deepseek-v4-pro"),

  /**
   * Persistencia de capturas. Con true, la imagen se sube a Cloudinary en modo
   * `authenticated` y queda en el hilo de la chica; con false vuelve al modo
   * efimero original. La copia legal debe coincidir con este valor.
   */
  STORE_SCREENSHOTS: envBool(false),
  CLOUDINARY_CLOUD_NAME: z.string().default(""),
  CLOUDINARY_API_KEY: z.string().default(""),
  CLOUDINARY_API_SECRET: z.string().default(""),
  CLOUDINARY_FOLDER: z.string().default("alfii"),
  /** Vida de la URL firmada que se entrega al cliente. */
  CLOUDINARY_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  /**
   * Correo transaccional (Resend).
   *
   * Regla dura del producto: los correos NUNCA hablan de las chicas. Ni nombres,
   * ni analisis, ni capturas. Un correo se reenvia, aparece en notificaciones
   * del telefono y vive en el servidor del proveedor de mail: es el canal menos
   * privado que tenemos. Solo cuenta, logros del usuario y contrasena.
   */
  RESEND_API_KEY: z.string().default(""),
  MAIL_FROM: z.string().default("Alfii <team@alfii.ec>"),
  MAIL_REPLY_TO: z.string().default("team@alfii.ec"),
  /** Con false los correos se registran en consola y no se envian. */
  MAIL_ENABLED: envBool(false),

  /**
   * Secreto que Vercel manda como "Authorization: Bearer <CRON_SECRET>" al
   * invocar los cron jobs (/cron/*). Sin el, cualquiera podria disparar el
   * barrido de re-enganche y vaciar la cuota de Resend. Vacio = crons apagados.
   */
  CRON_SECRET: z.string().default(""),

  /**
   * Base para los enlaces de los correos. Cada entorno apunta a su frontend:
   * si un enlace de recuperacion de produccion llevara a localhost, el usuario
   * se queda sin poder entrar.
   */
  APP_URL: z.string().default("http://localhost:5173"),

  SLACK_ERROR_WEBHOOK: z.string().default(""),

  /**
   * Correos con acceso al portal /admin (separados por coma). Vacio = nadie:
   * el portal existe pero ningun usuario lo puede abrir hasta configurarlo.
   */
  ADMIN_EMAILS: z.string().default(""),

  LEGAL_CONTACT_PRIVACY: z.string().default("privacidad@alfii.ec"),
  LEGAL_CONTACT_LEGAL: z.string().default("legal@alfii.ec"),
  LEGAL_OPERATOR: z.string().default("alfii.ec"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  console.error(`\n[env] Configuracion invalida:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;

/**
 * Coherencias que el schema no puede expresar por si solo. Se validan aqui,
 * al arrancar, porque cada una de ellas se manifestaria de otro modo como un
 * fallo silencioso en produccion.
 */
if (env.STORE_SCREENSHOTS) {
  const missing = (
    ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const
  ).filter((key) => !env[key]);

  if (missing.length) {
    console.error(
      `\n[env] STORE_SCREENSHOTS=true pero faltan: ${missing.join(", ")}.\n` +
        `      O completas Cloudinary o pones STORE_SCREENSHOTS=false.\n`
    );
    process.exit(1);
  }
}

if (env.MAIL_ENABLED && !env.RESEND_API_KEY) {
  console.error("\n[env] MAIL_ENABLED=true pero falta RESEND_API_KEY.\n");
  process.exit(1);
}

/**
 * Un APP_URL mal puesto no rompe nada al arrancar: rompe el enlace que recibe
 * el usuario cuando ya no puede entrar a su cuenta. Se avisa fuerte.
 */
if (isProductionEnv() && env.APP_URL.includes("localhost")) {
  console.warn(
    "\n[env] APP_URL apunta a localhost en produccion. Los enlaces de\n" +
      "      recuperacion de contrasena no funcionaran para nadie.\n"
  );
}

function isProductionEnv() {
  return env.NODE_ENV === "production";
}

/**
 * Las Admin keys de OpenAI (sk-admin-) sirven para gestionar la organizacion,
 * no para inferencia: /v1/responses las rechaza con 401. Sin este aviso el
 * failover parece "funcionar" y solo se descubre cuando Gemini cae.
 */
if (env.OPENAI_API_KEY.startsWith("sk-admin-")) {
  console.warn(
    "\n[env] OPENAI_API_KEY es una Admin key (sk-admin-). No puede llamar a la\n" +
      "      API de inferencia. Usa una project key (sk-proj-) o el failover a\n" +
      "      OpenAI fallara en el momento en que se necesite.\n"
  );
}

/**
 * La URI de Mongo se guarda con el placeholder <db_password> intacto para
 * poder copiarla tal cual desde Atlas. Aqui se resuelve.
 *
 * encodeURIComponent no es opcional: si la contrasena rotada trae @ / : o #
 * el string se rompe y el error de Mongoose no dice nada util.
 */
export function resolveMongoUri(): string {
  if (!env.DB_URI.includes("<db_password>")) {
    return env.DB_URI;
  }
  return env.DB_URI.replace("<db_password>", encodeURIComponent(env.DB_PASSWORD));
}

export const isProduction = env.NODE_ENV === "production";
