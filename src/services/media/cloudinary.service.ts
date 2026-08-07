import { v2 as cloudinary } from "cloudinary";
import sharp from "sharp";
import { env } from "../../config/env";
import { CustomError } from "../../errors/customError.error";

/**
 * Almacenamiento de capturas.
 *
 * Decision de producto (2026-08-07): las capturas se conservan dentro del hilo
 * de cada chica para que el usuario pueda releer la conversacion original junto
 * al analisis. Eso cambia la promesa anterior de "no guardamos nada", asi que:
 *
 *  - se sube en modo `authenticated`: el asset NO es accesible por URL publica
 *  - el cliente solo recibe URLs firmadas de vida corta
 *  - borrar el expediente borra tambien los assets (deleteMany)
 *  - si STORE_SCREENSHOTS=false el sistema vuelve al modo efimero original
 *
 * La copia legal y la del Home deben decir exactamente esto.
 */

let configured = false;

function ensureConfigured() {
  if (configured) return;

  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

export function screenshotStorageEnabled(): boolean {
  return env.STORE_SCREENSHOTS && !!env.CLOUDINARY_CLOUD_NAME;
}

export interface StoredScreenshot {
  publicId: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Sube la captura ya normalizada. Se reusa la misma compresion que se le manda
 * al modelo (1600px, JPEG 82) en vez del original: pesa una fraccion y no
 * conserva metadatos EXIF del telefono, que aqui serian datos personales
 * innecesarios (geolocalizacion incluida).
 */
export async function storeScreenshot(input: {
  buffer: Buffer;
  userId: string;
  targetId?: string;
}): Promise<StoredScreenshot> {
  if (!screenshotStorageEnabled()) {
    throw new CustomError("El almacenamiento de capturas esta desactivado.", 503, {
      reason: "storage_disabled",
    });
  }

  ensureConfigured();

  let normalized: Buffer;
  try {
    normalized = await sharp(input.buffer)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    throw new CustomError("No pude procesar esa imagen.", 400);
  }

  const folder = [env.CLOUDINARY_FOLDER, "users", input.userId, input.targetId ?? "unfiled"]
    .filter(Boolean)
    .join("/");

  return new Promise<StoredScreenshot>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        type: "authenticated",
        overwrite: false,
        // Sin metadatos derivados ni analisis de contenido: es material privado.
        image_metadata: false,
        invalidate: true,
      },
      (error, result) => {
        if (error || !result) {
          return reject(
            new CustomError("No pude guardar la captura.", 502, {
              reason: "cloudinary_upload_failed",
              detail: error?.message,
            })
          );
        }
        resolve({
          publicId: result.public_id,
          format: result.format,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
        });
      }
    );

    stream.end(normalized);
  });
}

/**
 * URL firmada de vida corta. Se genera en cada lectura: no se persiste ninguna
 * URL en base de datos, solo el public_id.
 */
export function signedScreenshotUrl(publicId: string): string {
  ensureConfigured();

  return cloudinary.url(publicId, {
    type: "authenticated",
    resource_type: "image",
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + env.CLOUDINARY_SIGNED_URL_TTL_SECONDS,
  });
}

/** Borrado real en Cloudinary. Se llama al eliminar un expediente o una cuenta. */
export async function deleteScreenshots(publicIds: string[]): Promise<void> {
  if (!publicIds.length || !screenshotStorageEnabled()) return;
  ensureConfigured();

  try {
    await cloudinary.api.delete_resources(publicIds, { type: "authenticated", resource_type: "image" });
  } catch (error: any) {
    // No se propaga: el borrado del expediente en Mongo no puede quedar a medias
    // porque Cloudinary este caido. Queda registrado para reconciliar.
    console.error(`[alfii:media] fallo el borrado de ${publicIds.length} assets: ${error?.message}`);
  }
}
