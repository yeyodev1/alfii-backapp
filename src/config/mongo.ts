import mongoose from "mongoose";
import { env, resolveMongoUri } from "./env";

export async function dbConnect() {
  const uri = resolveMongoUri();

  try {
    await mongoose.connect(uri, {
      dbName: env.DB_NAME,
      serverSelectionTimeoutMS: 10000,
    });
    console.log(`[mongo] conectado a la base "${env.DB_NAME}"`);
  } catch (error) {
    console.error("[mongo] error de conexion:", error);
    process.exit(1);
  }
}

export async function dbDisconnect() {
  await mongoose.disconnect();
}
