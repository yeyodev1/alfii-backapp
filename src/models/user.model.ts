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
   * Desde donde habla. La pista inicial se deduce de la IP de la peticion
   * (headers de Vercel/Cloudflare) y queda con confirmed=false; pasa a true
   * solo cuando el propio usuario la confirma o corrige en conversacion.
   */
  location?: { country?: string; city?: string; confirmed: boolean };

  /** Con que voz le habla Alfii (HARVEY, HITCH, BOND, BARNEY, STARK). */
  alfiiPersona?: string;

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
  /** Secuencia de correos de re-enganche: etapa alcanzada (0-3) y ultimo
   *  envio. Si el usuario vuelve (lastActiveAt > lastSentAt) la etapa se
   *  reinicia: la proxima ausencia arranca la secuencia desde cero. */
  reengagement: { stage: number; lastSentAt?: Date };
  /** Que correos acepta. Por defecto todos; la baja es por tipo. */
  emailPrefs?: { reengagement?: boolean; achievements?: boolean; updatedAt?: Date };
  /** Quiere aviso cuando Alfii este en WhatsApp. */
  whatsappWaitlist?: { joined: boolean; at?: Date };
  plan: "free" | "pro";
  /** Acceso pro sin pagar, otorgado por el admin. Su gasto se registra igual. */
  isVip: boolean;
  /** Acceso al portal /admin otorgado desde el portal. Los correos de
   *  ADMIN_EMAILS son admins SIEMPRE, con o sin este flag: el env es el
   *  respaldo que garantiza que nadie se bloquea a si mismo. */
  isAdmin: boolean;
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

    alfiiPersona: { type: String, trim: true, maxlength: 20 },

    location: {
      type: new Schema(
        {
          country: { type: String, trim: true, maxlength: 60 },
          city: { type: String, trim: true, maxlength: 80 },
          confirmed: { type: Boolean, default: false },
        },
        { _id: false }
      ),
      required: false,
    },

    // select:false para que el hash del token no salga en consultas normales:
    // no hay ningun caso en que la app necesite leerlo por accidente.
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },

    notifiedAchievements: { type: [String], default: [] },

    dataSkips: { type: [dataSkipSchema], default: [] },
    analysisCount: { type: Number, default: 0 },
    lastActiveAt: { type: Date, default: Date.now },
    reengagement: {
      stage: { type: Number, default: 0 },
      lastSentAt: { type: Date },
    },
    emailPrefs: {
      reengagement: { type: Boolean, default: true },
      achievements: { type: Boolean, default: true },
      updatedAt: { type: Date },
    },
    whatsappWaitlist: {
      joined: { type: Boolean, default: false },
      at: { type: Date },
    },
    plan: { type: String, enum: ["free", "pro"], default: "free" },
    isVip: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const UserModel = model<IUser>("User", userSchema);
