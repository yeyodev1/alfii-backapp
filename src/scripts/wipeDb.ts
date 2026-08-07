// Vacia todos los documentos de la base configurada. Las colecciones y sus
// indices quedan en pie: se borra el contenido, no la estructura.
//
// Es irreversible y no pregunta dos veces, asi que exige CONFIRM_WIPE=yes por
// entorno. Un `ts-node wipeDb.ts` distraido no debe poder borrar produccion.
import "dotenv/config";

import mongoose from "mongoose";

import { env, resolveMongoUri } from "../config/env";

async function main() {
  if (process.env.CONFIRM_WIPE !== "yes") {
    console.error(
      "[wipe] abortado: falta CONFIRM_WIPE=yes. Uso:\n" +
        "  CONFIRM_WIPE=yes npx ts-node --transpile-only src/scripts/wipeDb.ts"
    );
    process.exit(1);
  }

  await mongoose.connect(resolveMongoUri(), {
    dbName: env.DB_NAME,
    serverSelectionTimeoutMS: 10000,
  });

  const db = mongoose.connection.db;
  if (!db) throw new Error("sin handle de base de datos");

  // Se leen las colecciones reales y no los modelos registrados: asi tambien
  // caen las que quedaron de modelos renombrados o borrados del codigo.
  const collections = await db.listCollections().toArray();

  console.log(`[wipe] base "${env.DB_NAME}" — ${collections.length} colecciones`);

  let total = 0;
  for (const { name } of collections) {
    if (name.startsWith("system.")) continue;
    const before = await db.collection(name).countDocuments();
    const { deletedCount } = await db.collection(name).deleteMany({});
    total += deletedCount ?? 0;
    console.log(`  ${name}: ${before} -> 0 (borrados ${deletedCount})`);
  }

  console.log(`[wipe] listo. ${total} documentos eliminados.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("[wipe] fallo:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
