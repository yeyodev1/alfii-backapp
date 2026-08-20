import { Types } from "mongoose";
import { generateStructured, generateTextStream } from "./ai/structured";
import { routeModel } from "./ai/router";
import { BUNKER_SYSTEM, PROMPT_VERSION } from "../prompts/bunker.system";
import { assembleContext, estimateTokens } from "./context.service";
import { recordAiUsage } from "./usage.service";
import { applyStateUpdate } from "./state.service";
import { maybeCompact } from "./compaction.service";
import { detectCrisis } from "./crisis.service";
import { chatReplySchema, chatResponseSchema, greetingResponseSchema, greetingSchema } from "../schemas/chat.schema";
import { stateUpdateSchema } from "../schemas/analysis.schema";
import { MessageModel } from "../models/message.model";
import { signedScreenshotUrl } from "./media/cloudinary.service";
import { TargetModel, ITarget, HOW_WE_MET, RELATIONSHIP_GOALS } from "../models/target.model";
import { herProfileCompleteness } from "./target.service";
import { personaDirective } from "../prompts/personas";
import { PowerProfileModel } from "../models/powerProfile.model";
import type { IUser } from "../models/user.model";
import { logMetrics } from "../utils/redact";

const CHAT_MODE = `MODO CONVERSACION.
El usuario te escribio sin adjuntar captura. Responde directo, como hablaria un
asesor por mensaje: sin encabezados, sin listas numeradas, sin muros de texto.

Extension: entre 2 y 6 frases de prosa salvo que la pregunta exija mas. No
repitas el analisis completo si ya lo diste: aqui respondes lo que te pregunto.

FORMATO OBLIGATORIO (la app lo pinta; si lo rompes, el usuario ve un bloque
ilegible):
- Parrafos cortos (maximo 3 frases) separados por UNA linea en blanco.
- Mensaje para que EL le envie a ELLA: va SOLO en su propia linea que empieza
  con "> " (mayor que y espacio). Uno por linea, maximo 3. JAMAS lo metas entre
  comillas dentro de un parrafo. Ejemplo:
  > Ok, lista la agenda. Pero hoy tengo ganas de verte: cenamos algo simple?
- Tiempos (cuanto esperar, cuando escribir, plazos, "si no responde en X"):
  SIEMPRE en su propia linea que empieza con "⏱ " y el dato concreto primero.
  Ejemplo: ⏱ Espera 2 horas. Si no responde, no insistas hoy.
  Si el usuario pregunta cuanto esperar, esta linea es OBLIGATORIA y va con
  numero (minutos/horas/dias), nunca "un rato" ni "lo que sientas".
- Pasos u opciones: lineas que empiezan con "• " (maximo 4, una frase cada una).
- Idea clave en negrita con **asi**, maximo 2 por respuesta.
- Cierra SIEMPRE con una linea que empieza con "➜ " con la accion concreta
  ahora mismo (una frase). Ejemplo: ➜ Mandale el mensaje ahora y suelta el telefono.

Si el usuario te cuenta algo que cambia el estado del expediente (acepto una
cita, se enfrio, dejo de responder, se vieron), reflejalo.

Si te pregunta algo que se responderia mejor con una captura, pidesela.`;

/** Como se nombra cada hueco del perfil de ella al modelo. */
const HER_FIELD_LABELS: Record<string, string> = {
  howWeMet: "como se conocieron",
  knownSinceMonths: "cuanto tiempo llevan hablando",
  herAge: "la edad de ella",
  herOccupation: "a que se dedica ella",
  instagram: "el instagram de ella",
  relationshipGoal: "que busca el con ella",
};

const GREETING_MODE = `MODO SALUDO DE REINGRESO.
El usuario abrio el expediente de esta chica despues de un tiempo sin
actividad. Habla tu primero.

Una o dos frases. Retoma con un DATO CONCRETO del expediente (dias sin
actividad, patron de respuesta de ella, cita pendiente, etapa) y cierra con una
pregunta directa. Llamalo por su nombre si lo conoces.

Nada de saludos genericos tipo "hola, como estas?". Un asesor no espera:
pregunta.`;

// ---------------------------------------------------------------------------
// Locking por target: dos mensajes rapidos seguidos no pueden producir
// stateUpdate en conflicto sobre el mismo expediente.
// ---------------------------------------------------------------------------
const locks = new Map<string, Promise<unknown>>();

export async function withTargetLock<T>(targetId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(targetId) ?? Promise.resolve();
  const current = previous.then(fn, fn);
  locks.set(
    targetId,
    current.catch(() => undefined)
  );
  try {
    return await current;
  } finally {
    if (locks.get(targetId) === current) locks.delete(targetId);
  }
}

// ---------------------------------------------------------------------------
// Conversacion con streaming
// ---------------------------------------------------------------------------

export interface ChatStreamEvent {
  type: "meta" | "delta" | "state" | "lesson" | "crisis" | "done" | "error";
  data?: unknown;
}

export async function* streamChat(input: {
  user: IUser;
  target: ITarget;
  message: string;
  forceDeep?: boolean;
}): AsyncGenerator<ChatStreamEvent> {
  const started = Date.now();

  // Capa local de crisis antes de gastar tokens.
  const crisis = detectCrisis(input.message);
  if (crisis.detected && crisis.blocksAdvice) {
    await MessageModel.create({
      userId: input.user._id,
      targetId: input.target._id,
      role: "user",
      kind: "text",
      content: input.message,
    });
    await MessageModel.create({
      userId: input.user._id,
      targetId: input.target._id,
      role: "alfii",
      kind: "text",
      content: crisis.response,
    });

    yield { type: "crisis", data: { kind: crisis.kind, resources: crisis.resources } };
    yield { type: "delta", data: crisis.response };
    yield { type: "done", data: { crisis: true } };
    return;
  }

  const choice = routeModel({
    hasImage: false,
    forceDeep: input.forceDeep,
    message: input.message,
    target: input.target,
  });

  const profile = await PowerProfileModel.findOne({ userId: input.user._id });
  const context = await assembleContext({
    user: input.user,
    profile,
    target: input.target,
  });

  yield { type: "meta", data: { model: choice.model, tier: choice.tier, reason: choice.reason } };

  await MessageModel.create({
    userId: input.user._id,
    targetId: input.target._id,
    role: "user",
    kind: "text",
    content: input.message,
  });

  const parts = [
    {
      text:
        `${context.text}\n\n` +
        `=== MENSAJE ACTUAL DEL USUARIO ===\n${input.message}`,
    },
  ];

  // Huecos del perfil de ella: se le dicen al modelo para que los pida a
  // goteo en la conversacion, nunca como formulario. El extractor de la
  // segunda pasada recoge la respuesta y la guarda solo.
  const missingHer = herProfileCompleteness(input.target)
    .missing.map((f) => HER_FIELD_LABELS[f])
    .filter(Boolean);
  const chatSystem =
    `${BUNKER_SYSTEM}\n\n${CHAT_MODE}` +
    (missingHer.length
      ? `\n\nDATOS QUE TE FALTAN DE ELLA: ${missingHer.join(", ")}. Si fluye de forma ` +
        `natural, pregunta por UNO como maximo por respuesta, conversacionalmente, ` +
        `nunca como formulario ni como lista. No repitas una pregunta que ya hiciste ` +
        `en la conversacion reciente ni fuerces el dato si el tema va por otro lado.`
      : "") +
    personaDirective(input.user.alfiiPersona);

  let full = "";
  let servedBy = choice.model;
  let servedProvider = "desconocido";
  try {
    for await (const chunk of generateTextStream(
      {
        task: choice.tier === "pro" ? "analysis" : "chat",
        system: chatSystem,
        parts,
        temperature: 0.9,
        // Presupuesto holgado: el texto visible de un turno ronda 300-600
        // tokens, pero Gemini descuenta el razonamiento del mismo limite.
        maxOutputTokens: 2400,
        thinkingBudget: choice.tier === "pro" ? 512 : 256,
      },
      (meta) => {
        // El failover es invisible para el usuario, pero no para las metricas:
        // si OpenAI empieza a atender la mayoria de los turnos, hay que saberlo.
        servedBy = meta.model;
        servedProvider = meta.provider;
        if (meta.failedOver.length) {
          console.warn(`[alfii:ai] chat servido por ${meta.provider} tras fallar ${meta.failedOver.join(",")}`);
        }
      }
    )) {
      full += chunk;
      yield { type: "delta", data: chunk };
    }
  } catch (error: any) {
    console.warn(`[alfii:ai] chat stream interrumpido tras ${full.length} chars: ${error?.message}`);
    if (!full.trim()) {
      yield { type: "error", data: { message: "Se corto la conexion con el modelo. Intenta de nuevo." } };
      return;
    }
    // Ya se emitio texto: se conserva lo que llego (y se persiste abajo) en
    // vez de dejar al usuario con una burbuja que desaparece al recargar.
    yield { type: "error", data: { message: "La respuesta se corto. Pideme que continue.", partial: true } };
  }

  if (!full.trim()) {
    yield { type: "error", data: { message: "No pude generar una respuesta. Reformula." } };
    return;
  }

  const latencyMs = Date.now() - started;

  const alfiiMessage = await MessageModel.create({
    userId: input.user._id,
    targetId: input.target._id,
    role: "alfii",
    kind: "text",
    content: full,
    meta: { model: servedBy, promptVersion: PROMPT_VERSION, latencyMs },
  });

  await TargetModel.findByIdAndUpdate(input.target._id, {
    $inc: { messageCount: 2 },
    $set: { lastMessageAt: new Date() },
  });

  logMetrics("chat.stream", {
    model: servedBy,
    latencyMs,
    contextTokens: context.tokens,
    dropped: context.dropped,
  });

  // El streaming no reporta tokens: se estima con la misma regla de ~4 chars
  // por token que usa el presupuesto de contexto. Queda marcado `estimated`
  // para que el portal de administracion no lo venda como dato exacto.
  recordAiUsage({
    userId: String(input.user._id),
    provider: servedProvider,
    model: servedBy,
    task: "chat",
    inputTokens: estimateTokens(chatSystem) + context.tokens + estimateTokens(input.message),
    outputTokens: estimateTokens(full),
    latencyMs,
    estimated: true,
  });

  // El stateUpdate se calcula en una segunda pasada barata: meterlo en el
  // stream obligaria a devolver JSON y perderiamos la sensacion de inmediatez.
  const update = await extractStateUpdate({
    target: input.target,
    userMessage: input.message,
    alfiiReply: full,
  });

  if (update) {
    const applied = await applyStateUpdate(input.target._id, update, undefined);
    if (applied?.changes.length) {
      yield { type: "state", data: { changes: applied.changes, version: applied.target.version } };
      await MessageModel.create({
        userId: input.user._id,
        targetId: input.target._id,
        role: "alfii",
        kind: "stateChange",
        content: applied.changes.map((c) => c.field).join(","),
      });
    }
  }

  void maybeCompact(input.target._id);

  yield { type: "done", data: { messageId: String(alfiiMessage._id), latencyMs } };
}

const STATE_EXTRACTOR_SYSTEM = `Extraes cambios de estado desde un intercambio de asesoria.

Devuelve SOLO los campos que cambiaron de forma clara y verificable segun lo
que el usuario dijo. Si nada cambio, devuelve todos los campos en null.

No inventes progreso. No subas medidores por entusiasmo del usuario: solo por
hechos concretos (acepto una cita, se vieron, hubo contacto fisico, dejo de
responder). Un medidor optimista y falso es lo peor que puedes producir.

Si el usuario menciono datos de ella (edad, ocupacion, instagram, como se
conocieron, cuanto llevan hablando, que busca el), devuelvelos en herProfile
SOLO si el usuario los afirmo de forma explicita. Nunca los deduzcas ni los
inventes; en la duda, null.`;

async function extractStateUpdate(input: {
  target: ITarget;
  userMessage: string;
  alfiiReply: string;
}) {
  try {
    const result = await generateStructured({
      task: "chat",
      system: STATE_EXTRACTOR_SYSTEM,
      parts: [
        {
          text:
            `Estado actual: etapa ${input.target.stage}, medidores ` +
            `beso ${input.target.meters.current.kiss}, cita ${input.target.meters.current.firstDate}, ` +
            `noche ${input.target.meters.current.firstNight}, riesgo ${input.target.riskProfile.level}.\n` +
            `Resumen previo: ${input.target.contextSummary || "(vacio)"}\n` +
            `Perfil declarado de ella (no repitas lo ya conocido): ` +
            `${JSON.stringify(input.target.herProfile ?? {})}\n\n` +
            `USUARIO: ${input.userMessage}\nALFII: ${input.alfiiReply}`,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          stage: { type: "string", nullable: true },
          riskLevel: { type: "string", nullable: true },
          summaryPatch: { type: "string", nullable: true },
          meters: {
            type: "object",
            nullable: true,
            properties: {
              kiss: { type: "number", nullable: true },
              firstDate: { type: "number", nullable: true },
              firstNight: { type: "number", nullable: true },
            },
          },
          herProfile: {
            type: "object",
            nullable: true,
            description:
              "Datos de ella que el usuario afirmo explicitamente en este intercambio. null si no menciono ninguno.",
            properties: {
              herAge: { type: "number", nullable: true },
              herOccupation: { type: "string", nullable: true },
              instagram: { type: "string", nullable: true, description: "handle sin @" },
              howWeMet: { type: "string", enum: [...HOW_WE_MET], nullable: true },
              knownSinceMonths: { type: "number", nullable: true },
              relationshipGoal: { type: "string", enum: [...RELATIONSHIP_GOALS], nullable: true },
            },
          },
        },
      },
      validator: stateUpdateSchema,
      temperature: 0.2,
      maxOutputTokens: 700,
      attribution: { userId: String(input.target.userId) },
    });
    return result.data;
  } catch {
    // Si falla, el turno ya se respondio. El estado se recalibra en el proximo
    // analisis con captura, que es la fuente mas confiable.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Saludo proactivo de reingreso
// ---------------------------------------------------------------------------

export const GREETING_COOLDOWN_HOURS = 24;

export async function maybeGreet(input: {
  user: IUser;
  target: ITarget;
}): Promise<{ greeting: string; messageId: string } | null> {
  const now = Date.now();

  const lastActivity = input.target.lastMessageAt ?? input.target.createdAt;
  const hoursSinceActivity = (now - new Date(lastActivity).getTime()) / 3_600_000;
  if (hoursSinceActivity < GREETING_COOLDOWN_HOURS) return null;

  // Uno por sesion y por chica: si no, se vuelve acoso dentro de la propia app.
  if (input.target.lastGreetingAt) {
    const hoursSinceGreeting =
      (now - new Date(input.target.lastGreetingAt).getTime()) / 3_600_000;
    if (hoursSinceGreeting < GREETING_COOLDOWN_HOURS) return null;
  }

  const profile = await PowerProfileModel.findOne({ userId: input.user._id });
  const context = await assembleContext({
    user: input.user,
    profile,
    target: input.target,
    includeThreads: false,
  });

  try {
    const result = await generateStructured({
      task: "chat",
      system: `${BUNKER_SYSTEM}\n\n${GREETING_MODE}${personaDirective(input.user.alfiiPersona)}`,
      parts: [
        {
          text:
            `${context.text}\n\n` +
            `Dias sin actividad: ${Math.floor(hoursSinceActivity / 24)}.\n` +
            `Genera el saludo de reingreso.`,
        },
      ],
      jsonSchema: greetingResponseSchema,
      validator: greetingSchema,
      temperature: 0.95,
      maxOutputTokens: 400,
      attribution: { userId: String(input.user._id) },
    });

    const message = await MessageModel.create({
      userId: input.user._id,
      targetId: input.target._id,
      role: "alfii",
      kind: "greeting",
      content: result.data.greeting,
      meta: { model: result.model, latencyMs: result.latencyMs },
    });

    await TargetModel.findByIdAndUpdate(input.target._id, {
      $set: { lastGreetingAt: new Date(), lastMessageAt: new Date() },
      $inc: { messageCount: 1 },
    });

    return { greeting: result.data.greeting, messageId: String(message._id) };
  } catch {
    return null;
  }
}

export async function listMessages(input: {
  targetId: string | Types.ObjectId;
  before?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 60);
  const query: Record<string, unknown> = { targetId: input.targetId };

  if (input.before) {
    const cursor = new Date(input.before);
    if (!Number.isNaN(cursor.getTime())) query.createdAt = { $lt: cursor };
  }

  const messages = await MessageModel.find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .populate("analysisId")
    .lean();

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;

  // La URL firmada se genera en cada lectura y caduca. No se persiste ninguna
  // URL: en base de datos solo vive el public_id.
  const withUrls = page.reverse().map((message) => ({
    ...message,
    imageUrl: message.image?.publicId ? signedScreenshotUrl(message.image.publicId) : null,
  }));

  return {
    messages: withUrls,
    hasMore,
    nextCursor: hasMore ? withUrls[0]?.createdAt : null,
  };
}
