// Corrida manual del barrido de re-enganche, para probar en local.
// Con MAIL_ENABLED=false los envios solo se registran en consola.
import "dotenv/config";

import mongoose from "mongoose";

import { env, resolveMongoUri } from "../config/env";
import { runReengagementSweep } from "../services/reengagement.service";

async function main() {
  await mongoose.connect(resolveMongoUri(), {
    dbName: env.DB_NAME,
    serverSelectionTimeoutMS: 10000,
  });
  const r = await runReengagementSweep();
  console.log("[sweep]", JSON.stringify(r));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
