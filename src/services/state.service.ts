import { Types } from "mongoose";
import { TargetModel, ITarget, IHerProfile } from "../models/target.model";
import type { StateUpdate } from "../schemas/analysis.schema";
import { ARCHETYPES, RISK_LEVELS, STAGES } from "../schemas/enums";
import { logEvent } from "../utils/redact";

/**
 * El modelo PROPONE, el backend DECIDE.
 *
 * Esta es la restriccion que evita el fallo clasico de los agentes con estado:
 * que el modelo, en un turno cualquiera, infle los medidores al 95% porque el
 * usuario le conto algo con entusiasmo. Todo stateUpdate pasa por limites
 * duros y concurrencia optimista. El LLM nunca escribe en Mongo.
 */

/** Un medidor no puede saltar mas de esto en un solo turno. */
export const MAX_METER_DELTA = 25;
/** Ni el riesgo puede bajar mas de un nivel por turno: subir es rapido,
 *  bajar debe ser lento. Una red flag no se borra porque tuvo un buen dia. */
const RISK_ORDER = ["LIMPIO", "VIGILAR", "ALTO", "ABORTAR"] as const;

export interface AppliedChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface ApplyResult {
  target: ITarget;
  changes: AppliedChange[];
  rejected: string[];
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function limitDelta(current: number, proposed: number, max = MAX_METER_DELTA): number {
  const delta = proposed - current;
  if (Math.abs(delta) <= max) return clamp(proposed);
  return clamp(current + Math.sign(delta) * max);
}

export async function applyStateUpdate(
  targetId: string | Types.ObjectId,
  update: StateUpdate | null | undefined,
  analysisId?: Types.ObjectId
): Promise<ApplyResult | null> {
  if (!update) return null;

  const target = await TargetModel.findById(targetId);
  if (!target) return null;

  const changes: AppliedChange[] = [];
  const rejected: string[] = [];

  // --- etapa ---
  if (update.stage && STAGES.includes(update.stage)) {
    if (update.stage !== target.stage) {
      changes.push({ field: "stage", from: target.stage, to: update.stage });
      target.stage = update.stage;
    }
  } else if (update.stage) {
    rejected.push(`stage:${update.stage}`);
  }

  // --- medidores, con tope de salto por turno ---
  if (update.meters) {
    const current = target.meters.current;
    const next = {
      kiss: current.kiss,
      firstDate: current.firstDate,
      firstNight: current.firstNight,
    };
    let touched = false;

    for (const key of ["kiss", "firstDate", "firstNight"] as const) {
      const proposed = update.meters[key];
      if (typeof proposed !== "number") continue;
      const limited = limitDelta(current[key], proposed);
      if (limited !== proposed) rejected.push(`meters.${key}:capped(${proposed}->${limited})`);
      if (limited !== current[key]) {
        next[key] = limited;
        touched = true;
      }
    }

    if (touched) {
      changes.push({ field: "meters", from: { ...current }, to: { ...next } });
      target.meters.current = next;
      target.meters.history.push({ ...next, analysisId, at: new Date() });
      if (target.meters.history.length > 60) {
        target.meters.history = target.meters.history.slice(-60);
      }
    }
  }

  // --- arquetipo ---
  if (update.archetypeShift && ARCHETYPES.includes(update.archetypeShift.primary)) {
    const shift = update.archetypeShift;
    const changedPrimary = target.archetype.primary !== shift.primary;
    const hybrid = (shift.hybrid || []).filter((h) => ARCHETYPES.includes(h)).slice(0, 2);

    if (changedPrimary || shift.confidence !== target.archetype.confidence) {
      changes.push({
        field: "archetype",
        from: target.archetype.primary ?? null,
        to: shift.primary,
      });
      target.archetype.primary = shift.primary;
      target.archetype.hybrid = hybrid;
      target.archetype.confidence = clamp(shift.confidence, 0, 1);

      if (changedPrimary) {
        target.archetype.history.push({
          primary: shift.primary,
          hybrid,
          confidence: target.archetype.confidence,
          analysisId,
          at: new Date(),
        });
        if (target.archetype.history.length > 40) {
          target.archetype.history = target.archetype.history.slice(-40);
        }
      }
    }
  } else if (update.archetypeShift) {
    rejected.push("archetypeShift:invalid");
  }

  // --- red flags: se acumulan, nunca se sobreescriben ---
  if (update.newRiskFlags?.length) {
    for (const flag of update.newRiskFlags) {
      const existing = target.riskProfile.flags.find((f) => f.code === flag.code);
      if (existing) {
        existing.occurrences += 1;
        existing.severity = Math.max(existing.severity, flag.severity);
      } else {
        target.riskProfile.flags.push({
          code: flag.code,
          description: flag.description,
          severity: flag.severity,
          firstSeenAt: new Date(),
          occurrences: 1,
        });
        changes.push({ field: "riskFlag", from: null, to: flag.code });
      }
    }
    if (target.riskProfile.flags.length > 20) {
      target.riskProfile.flags = target.riskProfile.flags
        .sort((a, b) => b.severity - a.severity)
        .slice(0, 20);
    }
  }

  // --- nivel de riesgo: subir es libre, bajar es de a un nivel ---
  if (update.riskLevel && RISK_LEVELS.includes(update.riskLevel)) {
    const currentIdx = RISK_ORDER.indexOf(target.riskProfile.level as any);
    const proposedIdx = RISK_ORDER.indexOf(update.riskLevel as any);

    let finalIdx = proposedIdx;
    if (proposedIdx < currentIdx - 1) {
      finalIdx = currentIdx - 1;
      rejected.push(`riskLevel:slowed(${update.riskLevel}->${RISK_ORDER[finalIdx]})`);
    }

    if (finalIdx !== currentIdx) {
      changes.push({
        field: "riskLevel",
        from: target.riskProfile.level,
        to: RISK_ORDER[finalIdx],
      });
      target.riskProfile.level = RISK_ORDER[finalIdx];
    }
  }

  // --- timing observado: media movil, no reemplazo brusco ---
  if (update.timingObserved?.herReplyMinutes != null) {
    const observed = Math.max(0, update.timingObserved.herReplyMinutes);
    const previous = target.timingPattern.herTypicalReplyMinutes;
    target.timingPattern.herTypicalReplyMinutes = previous
      ? Math.round(previous * 0.65 + observed * 0.35)
      : Math.round(observed);
  }
  if (update.timingObserved?.herActiveHours?.length) {
    const merged = new Set([
      ...(target.timingPattern.herActiveHours || []),
      ...update.timingObserved.herActiveHours,
    ]);
    target.timingPattern.herActiveHours = [...merged].slice(0, 24);
  }

  // --- datos declarados sobre ella: solo llenan huecos, JAMAS sobreescriben.
  // Lo que el usuario declaro a mano gana siempre a lo que el extractor creyo
  // oir; si extrajo mal, el usuario corrige via PATCH her-profile. ---
  if (update.herProfile) {
    const currentHer: IHerProfile = target.herProfile ?? {};
    const nextHer: IHerProfile = { ...currentHer };
    let herTouched = false;

    for (const key of Object.keys(update.herProfile) as (keyof IHerProfile)[]) {
      const value = (update.herProfile as Record<string, unknown>)[key];
      if (value == null || value === "") continue;
      if (currentHer[key] !== undefined) {
        rejected.push(`herProfile.${key}:exists`);
        continue;
      }
      (nextHer as Record<string, unknown>)[key] = value;
      changes.push({ field: `herProfile.${key}`, from: null, to: value });
      herTouched = true;
    }

    if (herTouched) {
      target.herProfile = nextHer;
      target.markModified("herProfile");
    }
  }

  // --- resumen rodante: se REESCRIBE completo, nunca se concatena ---
  if (update.summaryPatch) {
    target.contextSummary = update.summaryPatch.slice(0, 1200);
  }

  target.version += 1;

  await target.save();

  logEvent("state.applied", {
    targetId: String(target._id),
    changes: changes.map((c) => c.field),
    rejected,
    version: target.version,
  });

  return { target, changes, rejected };
}

/** Registra que script eligio el usuario y con que resultado. Esto es el
 *  activo mas valioso del expediente: es lo que hace que el consejo 12 sea
 *  mejor que el 1. */
export async function recordScriptOutcome(
  targetId: string | Types.ObjectId,
  style: string,
  outcome: string,
  analysisId?: Types.ObjectId
) {
  await TargetModel.findByIdAndUpdate(targetId, {
    $push: {
      scriptsUsed: { $each: [{ style, outcome, analysisId, at: new Date() }], $slice: -40 },
    },
  });
}
