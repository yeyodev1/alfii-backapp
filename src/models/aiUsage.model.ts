import { Schema, model, Document, Types } from "mongoose";

/**
 * Registro de cada llamada a un modelo de IA, con su costo calculado.
 *
 * Es la fuente del portal de administracion: sin esto los tokens se logueaban
 * a consola y el gasto real por usuario era invisible. Cada documento es una
 * llamada; los agregados (por dia, por usuario, por proveedor) se calculan al
 * leer, nunca se precomputan, porque el volumen lo permite de sobra.
 */
export interface IAiUsage extends Document {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;

  provider: string;
  /** aiModel y no model: `model` choca con el metodo homonimo de Document. */
  aiModel: string;
  task: string;

  inputTokens: number;
  outputTokens: number;
  /** Calculado al registrar con la tabla de precios vigente. */
  costUsd: number;
  latencyMs?: number;
  /** true cuando los tokens son estimacion local (streaming no los reporta). */
  estimated: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const aiUsageSchema = new Schema<IAiUsage>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },

    provider: { type: String, required: true },
    aiModel: { type: String, required: true },
    task: { type: String, required: true },

    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    latencyMs: Number,
    estimated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

aiUsageSchema.index({ createdAt: -1 });
aiUsageSchema.index({ userId: 1, createdAt: -1 });

export const AiUsageModel = model<IAiUsage>("AiUsage", aiUsageSchema);
