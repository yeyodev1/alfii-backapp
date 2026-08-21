import { Schema, model, Document, Types } from "mongoose";
import {
  ARCHETYPES,
  OUTCOMES,
  PLATFORMS,
  RISK_LEVELS,
  SCRIPT_STYLES,
} from "../schemas/enums";
import type { AnalysisPayload } from "../schemas/analysis.schema";

/**
 * El artefacto estructurado de los 6 bloques.
 *
 * Con STORE_SCREENSHOTS=true la captura queda referenciada en `image` como
 * public_id de Cloudinary (entrega firmada, nunca publica) y se muestra en el
 * hilo junto al analisis. Con STORE_SCREENSHOTS=false el campo queda vacio y el
 * comportamiento es el original: solo texto extraido. El descargo legal debe
 * describir el modo realmente activo.
 */
export interface IAnalysisImage {
  provider: "cloudinary";
  publicId: string;
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
}

export interface IAnalysis extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  targetId?: Types.ObjectId;

  sourceType: "screenshot" | "text";
  platform?: string;
  detectedName?: string;
  image?: IAnalysisImage;
  extractedThread: { speaker: "her" | "him"; text: string; timestamp?: string; dateLabel?: string }[];

  /**
   * Resumen del historial importado de WhatsApp cuando el export supero la
   * ventana de 80 mensajes. Vive aqui hasta que el usuario confirma el
   * expediente: createTargetFromAnalysis lo copia al Target.
   */
  importedHistory?: {
    summary: string;
    messageCount: number;
    firstMessageAt?: Date;
    lastMessageAt?: Date;
  };

  payload: AnalysisPayload;
  scriptFeedback: { style: string; outcome: string; at: Date }[];

  aiModel: string;
  promptVersion: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;

  createdAt: Date;
  updatedAt: Date;
}

const analysisSchema = new Schema<IAnalysis>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetId: { type: Schema.Types.ObjectId, ref: "Target", index: true },

    sourceType: { type: String, enum: ["screenshot", "text"], default: "screenshot" },
    platform: { type: String, enum: [...PLATFORMS] },
    detectedName: String,

    image: {
      type: new Schema<IAnalysisImage>(
        {
          provider: { type: String, enum: ["cloudinary"], default: "cloudinary" },
          publicId: { type: String, required: true },
          format: String,
          width: Number,
          height: Number,
          bytes: Number,
        },
        { _id: false }
      ),
      required: false,
    },

    extractedThread: {
      type: [
        new Schema(
          {
            speaker: { type: String, enum: ["her", "him"], required: true },
            text: { type: String, required: true },
            timestamp: String,
            dateLabel: String,
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    importedHistory: {
      type: new Schema(
        {
          summary: { type: String, required: true, maxlength: 4000 },
          messageCount: { type: Number, required: true },
          firstMessageAt: Date,
          lastMessageAt: Date,
        },
        { _id: false }
      ),
      required: false,
    },

    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },

    scriptFeedback: {
      type: [
        new Schema(
          {
            style: { type: String, enum: [...SCRIPT_STYLES], required: true },
            outcome: { type: String, enum: [...OUTCOMES], required: true },
            at: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    aiModel: String,
    promptVersion: String,
    latencyMs: Number,
    inputTokens: Number,
    outputTokens: Number,
  },
  { timestamps: true }
);

analysisSchema.index({ targetId: 1, createdAt: -1 });

export const AnalysisModel = model<IAnalysis>("Analysis", analysisSchema);
export { ARCHETYPES, RISK_LEVELS };
