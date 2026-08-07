// Entrada serverless para Vercel.
//
// El proceso local (src/index.ts) abre un servidor HTTP de larga vida. En
// Vercel no hay tal cosa: cada request entra a una funcion que puede arrancar
// en frio. Por eso aqui la conexion a Mongo se memoiza en el modulo, que
// sobrevive entre invocaciones del mismo contenedor tibio, y nunca se llama a
// process.exit: un fallo de DB debe devolver 500, no matar la funcion.
import "dotenv/config";

import type { IncomingMessage, ServerResponse } from "http";
import mongoose from "mongoose";

import { createApp } from "../src/app";
import { env, resolveMongoUri } from "../src/config/env";

let connection: Promise<typeof mongoose> | null = null;

function connectOnce() {
  if (!connection) {
    connection = mongoose
      .connect(resolveMongoUri(), {
        dbName: env.DB_NAME,
        serverSelectionTimeoutMS: 10000,
        // Cada contenedor abre su propio pool; mantenerlo chico evita agotar
        // el limite de conexiones de Atlas cuando Vercel escala en paralelo.
        maxPoolSize: 5,
      })
      .catch((error) => {
        // Se limpia el cache para que el proximo request reintente en vez de
        // quedarse pegado a una promesa rechazada para siempre.
        connection = null;
        throw error;
      });
  }
  return connection;
}

const { app } = createApp();

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
) {
  try {
    await connectOnce();
  } catch (error) {
    console.error("[mongo] error de conexion:", error);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ message: "Base de datos no disponible" }));
    return;
  }

  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(
    req,
    res
  );
}
