import express from "express";
import cors from "cors";
import http from "http";
import routerApi from "./routes";
import { globalErrorHandler } from "./middlewares/globalErrorHandler.middleware";
import { isProduction } from "./config/env";

const whitelist = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:8100",
  "http://localhost:8101",
  "https://alfii.ec",
  "https://www.alfii.ec",
  // Frontend desplegado en Vercel (dominio estable del proyecto).
  "https://alfii-frontapp.vercel.app",
  // CORS_ORIGINS permite sumar origenes sin redeploy de codigo: los deploys de
  // preview de Vercel cambian de URL en cada commit y no se pueden hardcodear.
  ...(process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || whitelist.includes(origin)) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(cors(corsOptions));
  app.use(express.json({ limit: "2mb" }));

  app.get("/", (_req, res) => {
    res.json({ service: "alfii", status: "alive" });
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, env: isProduction ? "production" : "development" });
  });

  routerApi(app);

  app.use((_req, res) => {
    res.status(404).json({ message: "Ruta no encontrada" });
  });

  app.use(globalErrorHandler);

  const server = http.createServer(app);

  return { app, server };
}
