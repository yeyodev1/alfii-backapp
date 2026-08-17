// Lista compacta de usuarios: para ubicar cuentas de prueba antes de borrar.
import "dotenv/config";

import mongoose from "mongoose";

import { env, resolveMongoUri } from "../config/env";
import { UserModel } from "../models/user.model";

async function main() {
  await mongoose.connect(resolveMongoUri(), {
    dbName: env.DB_NAME,
    serverSelectionTimeoutMS: 10000,
  });

  const users = await UserModel.find({})
    .select("email preferredName isAnonymous analysisCount createdAt")
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  console.log(`[listUsers] base "${env.DB_NAME}" — ${users.length} usuarios (max 50):`);
  for (const u of users) {
    console.log(
      `  ${u._id} email=${u.email ?? "-"} name=${u.preferredName ?? "-"} ` +
        `anon=${u.isAnonymous} analisis=${u.analysisCount} ${new Date(u.createdAt).toISOString().slice(0, 10)}`
    );
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("[listUsers] fallo:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
