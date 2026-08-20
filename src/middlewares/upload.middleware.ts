import multer from "multer";
import { CustomError } from "../errors/customError.error";

/**
 * memoryStorage NO es una preferencia de rendimiento: es el mecanismo que hace
 * verdadera la frase "no guardamos tus capturas". Con diskStorage la imagen
 * tocaria el disco y el descargo legal se volveria prueba en contra.
 */
export const uploadScreenshot = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new CustomError("Solo acepto imagenes JPG, PNG, WEBP o HEIC.", 400));
    }
    cb(null, true);
  },
}).single("screenshot");

/**
 * Export .txt de WhatsApp ("Exportar chat > Sin archivos"). Tambien memoria:
 * el texto crudo jamas se persiste, solo el resumen y el hilo extraido.
 *
 * Acepta octet-stream ademas de text/plain porque el share sheet de moviles
 * manda el .txt con mimetype generico; el nombre del archivo desambigua.
 */
export const uploadTextExport = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const okMime = ["text/plain", "application/octet-stream"].includes(file.mimetype);
    const okName = /\.txt$/i.test(file.originalname || "");
    if (!okMime && !okName) {
      return cb(new CustomError("Solo acepto el export .txt de WhatsApp o texto plano.", 400));
    }
    cb(null, true);
  },
}).single("export");

/**
 * Nota de voz para transcribir. Memoria, como todo lo demas: el audio no se
 * guarda, solo el texto. 25 MB cubre audios largos de WhatsApp (opus ~1.6 KB/s
 * = horas) y m4a de iPhone razonables. Octet-stream permitido porque los
 * share sheets moviles mandan el .opus sin MIME; la extension desambigua.
 */
export const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const okMime = /^(audio\/|video\/webm|video\/mp4|application\/ogg)/.test(file.mimetype);
    const okName = /\.(opus|ogg|oga|m4a|mp4|aac|mp3|wav|webm|flac|amr)$/i.test(file.originalname || "");
    if (!okMime && !(file.mimetype === "application/octet-stream" && okName)) {
      return cb(new CustomError("Solo acepto audios (opus, ogg, m4a, mp3, wav, webm).", 400));
    }
    cb(null, true);
  },
}).single("audio");
