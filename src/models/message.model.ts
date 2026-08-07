import { Schema, model, Document, Types } from "mongoose";
import { MESSAGE_KINDS, MessageKind } from "../schemas/enums";

/**
 * El hilo de conversacion por chica.
 *
 * Regla central del agente: el historial que ve el USUARIO y el contexto que
 * ve el MODELO son dos cosas distintas. El usuario ve todo, siempre. El modelo
 * recibe un contexto compuesto y acotado. Los mensajes con compacted=true
 * siguen visibles en la UI pero salen del contexto del modelo.
 *
 * La captura subida vive en `image` como referencia a Cloudinary (public_id),
 * nunca como URL: la URL se firma en cada lectura y caduca. Al modelo se le
 * sigue enviando el TEXTO extraido, no la imagen: reenviar la captura en cada
 * turno multiplicaria el costo sin aportar nada que el hilo extraido no diga.
 */
export interface IMessageImage {
  provider: "cloudinary";
  publicId: string;
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
}

export interface IMessage extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  targetId: Types.ObjectId;

  role: "user" | "alfii";
  kind: MessageKind;
  content: string;
  analysisId?: Types.ObjectId;
  image?: IMessageImage;

  compacted: boolean;

  meta: {
    model?: string;
    promptVersion?: string;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
  };

  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetId: { type: Schema.Types.ObjectId, ref: "Target", required: true },

    role: { type: String, enum: ["user", "alfii"], required: true },
    kind: { type: String, enum: [...MESSAGE_KINDS], default: "text" },
    content: { type: String, default: "" },
    analysisId: { type: Schema.Types.ObjectId, ref: "Analysis" },

    image: {
      type: new Schema<IMessageImage>(
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

    compacted: { type: Boolean, default: false },

    meta: {
      model: String,
      promptVersion: String,
      inputTokens: Number,
      outputTokens: Number,
      latencyMs: Number,
    },
  },
  { timestamps: true }
);

// El indice que sostiene la paginacion por cursor del historial.
messageSchema.index({ targetId: 1, createdAt: -1 });

export const MessageModel = model<IMessage>("Message", messageSchema);
