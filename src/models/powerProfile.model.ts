import { Schema, model, Document, Types } from "mongoose";
import {
  FINANCE_STANCES,
  FinanceStance,
  INCOME_RANGES,
  IncomeRange,
  ONBOARDING_STEPS,
  PERSONALITY_STYLES,
  PersonalityStyle,
  SEEKING,
  Seeking,
} from "../schemas/enums";

/**
 * La Matriz de Identidad del usuario (Fase 0 del prompt base).
 * Se inyecta como datos en cada analisis, asi Alfii nunca vuelve a pedirla.
 */
export interface IPowerProfile extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;

  status: {
    profession?: string;
    successLevel?: number;
    socioeconomic?: string;
  };
  attractionAssets: { asset: string; selfRating: number; verifiedByAlfii: boolean }[];
  philosophy: {
    seeking?: Seeking;
    redLines: string[];
    financeStance?: FinanceStance;
  };
  personalityStyle?: PersonalityStyle;

  /** selfReported queda siempre en true mientras el dato venga de La Auditoria:
   *  deja la puerta abierta a una futura verificacion sin migrar el schema. */
  income: {
    monthlyRange?: IncomeRange;
    currency?: string;
    selfReported: boolean;
  };
  physique: {
    heightCm?: number;
    weightKg?: number;
    buildSelfRating?: number;
  };

  onboarding: {
    completed: boolean;
    currentStep: number;
    transcript: { role: "user" | "alfii"; content: string; at: Date }[];
    extractedAt?: Date;
  };

  /** Calidad de marco observada. Baja cuando Alfii lo corrige. */
  frameScore: number;

  education: {
    seenLessons: string[];
    lastLessonAt?: Date;
  };

  createdAt: Date;
  updatedAt: Date;
}

const powerProfileSchema = new Schema<IPowerProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },

    status: {
      profession: String,
      successLevel: { type: Number, min: 1, max: 5 },
      socioeconomic: String,
    },
    attractionAssets: {
      type: [
        new Schema(
          {
            asset: { type: String, required: true },
            selfRating: { type: Number, min: 1, max: 5, default: 3 },
            verifiedByAlfii: { type: Boolean, default: false },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    philosophy: {
      seeking: { type: String, enum: [...SEEKING] },
      redLines: { type: [String], default: [] },
      financeStance: { type: String, enum: [...FINANCE_STANCES] },
    },
    personalityStyle: { type: String, enum: [...PERSONALITY_STYLES] },

    income: {
      monthlyRange: { type: String, enum: [...INCOME_RANGES] },
      currency: String,
      selfReported: { type: Boolean, default: true },
    },
    // Los limites evitan que una extraccion mal parseada del modelo (por
    // ejemplo pies en vez de centimetros) entre a la base como si fuera valida.
    physique: {
      heightCm: { type: Number, min: 120, max: 250 },
      weightKg: { type: Number, min: 35, max: 300 },
      buildSelfRating: { type: Number, min: 1, max: 5 },
    },

    onboarding: {
      completed: { type: Boolean, default: false },
      currentStep: { type: Number, default: 0, min: 0, max: ONBOARDING_STEPS.length },
      transcript: {
        type: [
          new Schema(
            {
              role: { type: String, enum: ["user", "alfii"], required: true },
              content: { type: String, required: true },
              at: { type: Date, default: Date.now },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
      extractedAt: Date,
    },

    frameScore: { type: Number, default: 70, min: 0, max: 100 },

    education: {
      seenLessons: { type: [String], default: [] },
      lastLessonAt: Date,
    },
  },
  { timestamps: true }
);

export const PowerProfileModel = model<IPowerProfile>("PowerProfile", powerProfileSchema);
