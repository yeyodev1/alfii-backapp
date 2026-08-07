import sharp from "sharp";
import { generateStructured } from "./ai/structured";
import { VISION_SYSTEM } from "../prompts/vision.extract";
import {
  visionExtractionSchema,
  visionResponseSchema,
  type VisionExtraction,
} from "../schemas/vision.schema";
import { CustomError } from "../errors/customError.error";
import { logMetrics } from "../utils/redact";

/**
 * Extraccion del hilo desde la captura.
 *
 * La imagen se comprime, se envia al proveedor con vision y se extrae el texto.
 * El buffer no toca disco ni entra en logs. Su persistencia (Cloudinary) es una
 * decision aparte que toma el controlador segun STORE_SCREENSHOTS: aqui solo se
 * lee.
 *
 * Ojo con el orden: el texto extraido es lo que despues alimenta la memoria del
 * expediente. La imagen no se reenvia en turnos posteriores.
 */
export async function extractFromScreenshot(
  buffer: Buffer,
  mimeType: string
): Promise<VisionExtraction> {
  // Comprimir antes de enviar: una captura de movil moderna pesa 3-6MB y
  // ~1600px de ancho es mas que suficiente para leer texto de chat.
  let processed: Buffer;
  try {
    processed = await sharp(buffer)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    throw new CustomError("No pude leer esa imagen. Prueba con un PNG o JPG.", 400);
  }

  const result = await generateStructured({
    task: "vision",
    system: VISION_SYSTEM,
    parts: [
      { image: { mimeType: "image/jpeg", base64: processed.toString("base64") } },
      { text: "Extrae la conversacion de esta captura." },
    ],
    jsonSchema: visionResponseSchema,
    validator: visionExtractionSchema,
    temperature: 0.1,
    maxOutputTokens: 3000,
  });

  logMetrics("vision.extract", {
    provider: result.provider,
    failedOver: result.failedOver,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
    repaired: result.repaired,
  });

  const extraction = sanitizeThread(result.data);

  if (!extraction.readable || extraction.thread.length === 0) {
    throw new CustomError(
      extraction.issue ||
        "No pude leer esa captura. Asegurate de que se vea la conversacion completa y el nombre de arriba.",
      422,
      { reason: "unreadable" }
    );
  }

  return extraction;
}

/**
 * Saneado del hilo antes de que toque la base de datos.
 *
 * El prompt le pide al modelo que nunca devuelva texto vacio y que marque los
 * mensajes no textuales con [foto], [audio 0:14], etc. Pero un prompt es una
 * peticion, no una garantia: cuando el modelo igual devolvia "" el documento
 * reventaba en Mongoose con "extractedThread.N.text: Path `text` is required",
 * y el usuario perdia el analisis entero por un sticker.
 *
 * Aqui se cierra por contrato: se recupera el mensaje con un marcador generico
 * en vez de descartarlo, porque su POSICION en el hilo importa. Si ella mando
 * algo justo despues de una pregunta incomoda, borrar esa burbuja cambiaria la
 * lectura del subtexto.
 */
function sanitizeThread(extraction: VisionExtraction): VisionExtraction {
  const thread = extraction.thread
    .map((message) => ({
      ...message,
      text: (message.text ?? "").trim() || "[contenido no textual]",
      timestamp: message.timestamp?.trim() || null,
    }))
    // Un hilo entero de marcadores no es una conversacion analizable; si TODOS
    // quedaron sin texto real, se trata como captura ilegible mas abajo.
    .filter((message) => message.text.length > 0);

  const hasRealText = thread.some((m) => m.text !== "[contenido no textual]");

  return {
    ...extraction,
    thread: hasRealText ? thread : [],
    issue: hasRealText
      ? extraction.issue
      : "En esa captura no hay mensajes de texto que pueda leer. Mandame una donde se vea la conversacion escrita.",
  };
}

export function threadToText(thread: VisionExtraction["thread"]): string {
  return thread.map((m) => `${m.speaker === "her" ? "ELLA" : "EL"}: ${m.text}`).join("\n");
}
