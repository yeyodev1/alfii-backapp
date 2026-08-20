import { Schema, model, Document, Types } from "mongoose";
import {
  ACCENT_COLORS,
  AccentColor,
  ARCHETYPES,
  Archetype,
  MILESTONE_KEYS,
  MilestoneKey,
  OUTCOMES,
  Outcome,
  RISK_LEVELS,
  RiskLevel,
  SCRIPT_STYLES,
  ScriptStyle,
  STAGES,
  Stage,
} from "../schemas/enums";

/**
 * Enums de contexto de la relacion.
 *
 * PORQUE viven aqui y no en schemas/enums.ts: son datos declarados por el
 * usuario sobre ella, solo los consume este documento y su serializacion. No
 * participan del contrato con el modelo ni de la maquina de estados, asi que
 * meterlos en el enum global obligaria a tocar un archivo compartido para algo
 * que nadie mas necesita.
 */
export const HOW_WE_MET = [
  "APP_CITAS",
  "TRABAJO",
  "AMIGOS",
  "GYM",
  "UNIVERSIDAD",
  "FIESTA",
  "REDES",
  "CALLE",
  "OTRO",
] as const;
export type HowWeMet = (typeof HOW_WE_MET)[number];

export const RELATIONSHIP_GOALS = ["ALGO_SERIO", "CASUAL", "NO_LO_SE"] as const;
export type RelationshipGoal = (typeof RELATIONSHIP_GOALS)[number];

/**
 * Datos que el usuario declara sobre ella.
 *
 * PORQUE todo es opcional: se piden en cualquier momento, nunca como formulario
 * bloqueante. Un campo obligatorio aqui convertiria el expediente en un tramite
 * y el usuario abandonaria antes del primer analisis.
 */
export interface IHerProfile {
  howWeMet?: HowWeMet;
  knownSinceMonths?: number;
  herAge?: number;
  herOccupation?: string;
  /** Handle sin @: se normaliza al guardar para poder construir la URL. */
  instagram?: string;
  relationshipGoal?: RelationshipGoal;
  notes?: string;
}

/**
 * La Chica. Cada Target es una instancia del agente con su propia memoria.
 *
 * Este documento NO es memoria del modelo: es estado de base de datos que se
 * inyecta como datos en cada turno. Por eso Alfii no puede alucinar el
 * arquetipo de una chica: no lo esta recordando, se lo estamos entregando.
 */
export interface ITarget extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;

  displayName: string;
  nameConfirmed: boolean;
  accentColor: AccentColor;
  avatarInitial: string;

  /** Contexto declarado por el usuario. Se inyecta al modelo en cada turno. */
  herProfile?: IHerProfile;

  archetype: {
    primary?: Archetype;
    hybrid: Archetype[];
    confidence: number;
    history: {
      primary: Archetype;
      hybrid: Archetype[];
      confidence: number;
      analysisId?: Types.ObjectId;
      at: Date;
    }[];
  };

  riskProfile: {
    level: RiskLevel;
    transactionalRisk: number;
    flags: {
      code: string;
      description: string;
      severity: number;
      firstSeenAt: Date;
      occurrences: number;
    }[];
  };

  /** Hitos declarados por el usuario. Un hito marcado gana siempre a la
   *  estimacion del modelo: es un hecho, no una prediccion. */
  milestones: Record<MilestoneKey, { achieved: boolean; at?: Date }>;

  meters: {
    current: { kiss: number; firstDate: number; firstNight: number };
    history: {
      kiss: number;
      firstDate: number;
      firstNight: number;
      analysisId?: Types.ObjectId;
      at: Date;
    }[];
  };

  timingPattern: {
    herTypicalReplyMinutes?: number;
    herActiveHours: number[];
    recommendedDelayMinutes?: number;
    lastRecommendedAt?: Date;
  };

  scriptsUsed: {
    style: ScriptStyle;
    outcome: Outcome;
    analysisId?: Types.ObjectId;
    at: Date;
  }[];

  stage: Stage;

  /** Resumen rodante. Se reescribe completo, nunca se concatena. */
  contextSummary: string;

  /**
   * Resumen del historial importado de WhatsApp (export .txt). Distinto del
   * contextSummary: este es lo que paso ANTES de conocer a Alfii, aquel es lo
   * que va pasando con Alfii. Un import nuevo lo sobreescribe entero.
   */
  importedHistory?: {
    summary: string;
    messageCount: number;
    firstMessageAt?: Date;
    lastMessageAt?: Date;
    importedAt: Date;
  };

  analysisCount: number;
  messageCount: number;
  lastAnalysisAt?: Date;
  lastMessageAt?: Date;
  lastGreetingAt?: Date;
  isArchived: boolean;

  /** Concurrencia optimista: dos mensajes rapidos no pueden pisar el dossier. */
  version: number;

  /** Ficha tecnica cacheada. `version` es la del dossier con la que se
   *  genero: si difiere de la actual, esta desactualizada. */
  herCard?: {
    data: any;
    version: number;
    generatedAt: Date;
    model?: string;
  };

  createdAt: Date;
  updatedAt: Date;
}

const targetSchema = new Schema<ITarget>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    nameConfirmed: { type: Boolean, default: false },
    accentColor: { type: String, enum: [...ACCENT_COLORS], default: "red" },
    avatarInitial: { type: String, maxlength: 2, default: "?" },

    /**
     * Subdocumento sin default: si el usuario no declaro nada, el campo no
     * existe. Un objeto vacio por defecto haria imposible distinguir "no lo
     * conto" de "lo conto y esta vacio" al serializar el dossier.
     */
    herProfile: {
      type: new Schema<IHerProfile>(
        {
          howWeMet: { type: String, enum: [...HOW_WE_MET] },
          // Limites amplios pero finitos: sin max, un typo mete 99999 meses al
          // prompt y el modelo razona sobre una relacion de 8000 anios.
          knownSinceMonths: { type: Number, min: 0, max: 1200 },
          herAge: { type: Number, min: 18, max: 99 },
          herOccupation: { type: String, trim: true, maxlength: 80 },
          instagram: { type: String, trim: true, lowercase: true, maxlength: 30 },
          relationshipGoal: { type: String, enum: [...RELATIONSHIP_GOALS] },
          notes: { type: String, trim: true, maxlength: 500 },
        },
        { _id: false }
      ),
      required: false,
    },

    archetype: {
      primary: { type: String, enum: [...ARCHETYPES] },
      hybrid: { type: [String], enum: [...ARCHETYPES], default: [] },
      confidence: { type: Number, default: 0, min: 0, max: 1 },
      history: {
        type: [
          new Schema(
            {
              primary: { type: String, enum: [...ARCHETYPES], required: true },
              hybrid: { type: [String], enum: [...ARCHETYPES], default: [] },
              confidence: { type: Number, default: 0 },
              analysisId: { type: Schema.Types.ObjectId, ref: "Analysis" },
              at: { type: Date, default: Date.now },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
    },

    riskProfile: {
      level: { type: String, enum: [...RISK_LEVELS], default: "LIMPIO" },
      transactionalRisk: { type: Number, default: 0, min: 0, max: 100 },
      flags: {
        type: [
          new Schema(
            {
              code: { type: String, required: true },
              description: { type: String, required: true },
              severity: { type: Number, min: 1, max: 5, default: 1 },
              firstSeenAt: { type: Date, default: Date.now },
              occurrences: { type: Number, default: 1 },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
    },

    // Un subdocumento por hito, generado desde el enum para que anadir un hito
    // nuevo no obligue a tocar el schema en dos sitios.
    milestones: {
      type: new Schema(
        Object.fromEntries(
          MILESTONE_KEYS.map((key) => [
            key,
            {
              type: new Schema(
                { achieved: { type: Boolean, default: false }, at: Date },
                { _id: false }
              ),
              default: () => ({ achieved: false }),
            },
          ])
        ),
        { _id: false }
      ),
      default: () => ({}),
    },

    meters: {
      current: {
        kiss: { type: Number, default: 0, min: 0, max: 100 },
        firstDate: { type: Number, default: 0, min: 0, max: 100 },
        firstNight: { type: Number, default: 0, min: 0, max: 100 },
      },
      history: {
        type: [
          new Schema(
            {
              kiss: Number,
              firstDate: Number,
              firstNight: Number,
              analysisId: { type: Schema.Types.ObjectId, ref: "Analysis" },
              at: { type: Date, default: Date.now },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
    },

    timingPattern: {
      herTypicalReplyMinutes: Number,
      herActiveHours: { type: [Number], default: [] },
      recommendedDelayMinutes: Number,
      lastRecommendedAt: Date,
    },

    scriptsUsed: {
      type: [
        new Schema(
          {
            style: { type: String, enum: [...SCRIPT_STYLES], required: true },
            outcome: { type: String, enum: [...OUTCOMES], default: "SIN_REPORTAR" },
            analysisId: { type: Schema.Types.ObjectId, ref: "Analysis" },
            at: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    stage: { type: String, enum: [...STAGES], default: "APERTURA" },

    contextSummary: { type: String, default: "", maxlength: 1400 },

    importedHistory: {
      type: new Schema(
        {
          summary: { type: String, required: true, maxlength: 4000 },
          messageCount: { type: Number, required: true },
          firstMessageAt: Date,
          lastMessageAt: Date,
          importedAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
      required: false,
    },

    analysisCount: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    lastAnalysisAt: Date,
    lastMessageAt: Date,
    lastGreetingAt: Date,
    isArchived: { type: Boolean, default: false },

    version: { type: Number, default: 0 },

    herCard: {
      type: new Schema(
        {
          data: { type: Schema.Types.Mixed, required: true },
          version: { type: Number, required: true },
          generatedAt: { type: Date, default: Date.now },
          model: String,
        },
        { _id: false }
      ),
      required: false,
    },
  },
  { timestamps: true }
);

targetSchema.index({ userId: 1, isArchived: 1, lastMessageAt: -1 });

export const TargetModel = model<ITarget>("Target", targetSchema);
