// Debe ser la PRIMERA linea del proceso: cualquier modulo que lea process.env
// al importarse necesita que .env ya este cargado.
import "dotenv/config";

import { env } from "./config/env";
import { dbConnect } from "./config/mongo";
import { createApp } from "./app";
import { verifyGeminiTier } from "./services/ai/gemini.client";
import { logProviderChain } from "./services/ai/gateway";
import { screenshotStorageEnabled } from "./services/media/cloudinary.service";

async function main() {
  await dbConnect();
  await verifyGeminiTier();
  logProviderChain();

  console.log(
    `[alfii:media] capturas: ${
      screenshotStorageEnabled()
        ? "se guardan en Cloudinary (entrega firmada)"
        : "modo efimero, no se guardan"
    }`
  );

  const { server } = createApp();

  server.timeout = 10 * 60 * 1000;

  server.listen(env.PORT, () => {
    console.log(`[alfii] servidor en puerto ${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch((error) => {
  console.error("[alfii] fallo al arrancar:", error);
  process.exit(1);
});
