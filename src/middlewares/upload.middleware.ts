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
