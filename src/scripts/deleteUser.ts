// Borra usuarios concretos con todo su contenido (mensajes, analisis,
// expedientes, perfil). A diferencia del purge del endpoint, aqui el documento
// de usuario tambien se elimina: es para cuentas de prueba, no para el derecho
// al olvido de un usuario real.
//
// Uso:
//   npx ts-node --transpile-only src/scripts/deleteUser.ts <id1> <id2> ...
//     -> DRY RUN: muestra que borraria, no toca nada
//   CONFIRM_DELETE=yes npx ts-node --transpile-only src/scripts/deleteUser.ts <id1> ...
//     -> borra de verdad
//
// Cada <id> se busca por email exacto o por preferredName exacto (ambos
// case-insensitive).
import "dotenv/config";

import mongoose from "mongoose";

import { env, resolveMongoUri } from "../config/env";
import { UserModel } from "../models/user.model";
import { PowerProfileModel } from "../models/powerProfile.model";
import { TargetModel } from "../models/target.model";
import { AnalysisModel } from "../models/analysis.model";
import { MessageModel } from "../models/message.model";

async function main() {
  const identifiers = process.argv.slice(2).filter(Boolean);
  if (!identifiers.length) {
    console.error("[deleteUser] uso: deleteUser.ts <email o preferredName> ...");
    process.exit(1);
  }

  const confirmed = process.env.CONFIRM_DELETE === "yes";

  await mongoose.connect(resolveMongoUri(), {
    dbName: env.DB_NAME,
    serverSelectionTimeoutMS: 10000,
  });

  const exact = (value: string) =>
    new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

  const users = await UserModel.find({
    $or: identifiers.flatMap((id) => [{ email: exact(id) }, { preferredName: exact(id) }]),
  });

  if (!users.length) {
    console.log(`[deleteUser] ningun usuario coincide con: ${identifiers.join(", ")}`);
    await mongoose.disconnect();
    return;
  }

  for (const user of users) {
    const [messages, analyses, targets, profiles] = await Promise.all([
      MessageModel.countDocuments({ userId: user._id }),
      AnalysisModel.countDocuments({ userId: user._id }),
      TargetModel.countDocuments({ userId: user._id }),
      PowerProfileModel.countDocuments({ userId: user._id }),
    ]);

    console.log(
      `[deleteUser] ${user._id} email=${user.email ?? "(sin email)"} ` +
        `preferredName=${user.preferredName ?? "(sin nombre)"} anon=${user.isAnonymous} -> ` +
        `${messages} mensajes, ${analyses} analisis, ${targets} expedientes, ${profiles} perfiles`
    );

    if (!confirmed) continue;

    await Promise.all([
      MessageModel.deleteMany({ userId: user._id }),
      AnalysisModel.deleteMany({ userId: user._id }),
      TargetModel.deleteMany({ userId: user._id }),
      PowerProfileModel.deleteMany({ userId: user._id }),
    ]);
    await UserModel.deleteOne({ _id: user._id });
    console.log(`[deleteUser]   borrado.`);
  }

  if (!confirmed) {
    console.log(
      "\n[deleteUser] DRY RUN: nada se borro. Repite con CONFIRM_DELETE=yes para ejecutar."
    );
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("[deleteUser] fallo:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
