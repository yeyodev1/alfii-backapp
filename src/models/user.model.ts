import { Schema, model, Document, Types } from "mongoose";
import { SKIPPABLE_FIELDS } from "../schemas/enums";

export interface ILegalAcceptance {
  version: string;
  docHash: string;
  acceptedAt: Date;
  ipHash?: string;
  userAgent?: string;
  locale?: string;
  jurisdiction?: string;
}

export interface IDataSkip {
  field: string;
  skippedAt: Date;
  sessionId?: string;
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  email?: string;
  passwordHash?: string;
  isAnonymous: boolean;
  anonymousId: string;

  /** Afirmacion de mayoria de edad. Va dentro del checkbox legal unico. */
  confirm18: boolean;
  legalAcceptances: ILegalAcceptance[];

  /** Fase C: el unico dato que se pide al entrar. */
  preferredName?: string;
  /** Fase D: omitible con friccion. La edad se deriva, nunca se pide. */
  birthDate?: Date;

  /**
   * Recuperacion de contrasena. Se guarda el HASH del token, nunca el token:
   * quien lea la base de datos no debe poder entrar en ninguna cuenta.
   */
  passwordResetTokenHash?: string;
  passwordResetExpiresAt?: Date;

  /** Logros ya notificados por correo, para no repetir el mismo aviso. */
  notifiedAchievements: string[];

  dataSkips: IDataSkip[];
  analysisCount: number;
  lastActiveAt: Date;
  plan: "free" | "pro";
  createdAt: Date;
  updatedAt: Date;
}

const legalAcceptanceSchema = new Schema<ILegalAcceptance>(
  {
    version: { type: String, required: true },
    docHash: { type: String, required: true },
    acceptedAt: { type: Date, required: true },
    ipHash: String,
    userAgent: String,
    locale: String,
    jurisdiction: String,
  },
  { _id: false }
);

const dataSkipSchema = new Schema<IDataSkip>(
  {
    field: { type: String, required: true, enum: [...SKIPPABLE_FIELDS] },
    skippedAt: { type: Date, required: true },
    sessionId: String,
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    passwordHash: String,
    isAnonymous: { type: Boolean, default: true },
    anonymousId: { type: String, required: true, unique: true, index: true },

    confirm18: { type: Boolean, default: false },
    legalAcceptances: { type: [legalAcceptanceSchema], default: [] },

    preferredName: { type: String, trim: true, maxlength: 40 },
    birthDate: Date,

    // select:false para que el hash del token no salga en consultas normales:
    // no hay ningun caso en que la app necesite leerlo por accidente.
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },

    notifiedAchievements: { type: [String], default: [] },

    dataSkips: { type: [dataSkipSchema], default: [] },
    analysisCount: { type: Number, default: 0 },
    lastActiveAt: { type: Date, default: Date.now },
    plan: { type: String, enum: ["free", "pro"], default: "free" },
  },
  { timestamps: true }
);

export const UserModel = model<IUser>("User", userSchema);
