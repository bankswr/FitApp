// Autoregulation (user requirement, 2026-10-04; not in Flask). A routine with autoregulate on
// adjusts each loaded set's rep and weight targets from the last time the workout was done:
// beat the rep target -> reps + 1; fell short -> what was reached; past the range -> + one weight
// step at the range minimum; under the minimum -> - one step at the minimum. The step is the
// exercise's own, else the Settings default (5 lb unless changed). Deload days are never the reference.
import { type Db, get } from "../db/types";
import { ValidationError } from "./text";
import { type WorkoutSet, type WorkoutSlot, workingSets } from "./workouts";

export const DEFAULT_REP_RANGE = { min: 8, max: 15 };
export const WEIGHT_STEP = 5; // lb, the default until Settings changes it

/** The weight-step ladder the +/− buttons move along (user requirement, 2026-10-15). Any positive value can be typed. */
export const WEIGHT_STEPS = [1.25, 2.5, 5, 10, 25, 45];
/** The next ladder value above / below `value` (null when there's none). */
export const stepUp = (value: number) => WEIGHT_STEPS.find((s) => s > value) ?? null;
export const stepDown = (value: number) => [...WEIGHT_STEPS].reverse().find((s) => s < value) ?? null;
export const WEIGHT_STEP_MAX = 1000;

/** A typed weight step: blank → null (use the default); otherwise a positive number up to 1000, 2 decimals. */
export function parseWeightStep(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0 || n > WEIGHT_STEP_MAX) {
    throw new ValidationError(`The weight step should be a number above 0 and up to ${WEIGHT_STEP_MAX}.`);
  }
  return Math.round(n * 100) / 100;
}

/**
 * How the day's loaders autoregulate: false (off, Flask parity), true (on with the 5 lb default),
 * or on with Settings' default step. An exercise's own step always wins over the default.
 */
export type Autoregulate = boolean | { weightStep: number };
export const defaultStepOf = (a: Autoregulate) => (typeof a === "object" ? a.weightStep : WEIGHT_STEP);

/** The rep range autoregulation works within: the plan's, with a blank end defaulting to 8–15. */
export function repRange(set: Pick<WorkoutSet, "reps_min" | "reps_max">): { min: number; max: number } {
  const min = set.reps_min ?? Math.min(DEFAULT_REP_RANGE.min, set.reps_max ?? DEFAULT_REP_RANGE.min);
  return { min, max: set.reps_max ?? Math.max(DEFAULT_REP_RANGE.max, min) };
}

export interface SetTargets {
  reps: number | null;
  weight: number | null;
}

/** The previous session's set, as stored in log_set. */
export interface PreviousSet {
  reps: number | null;
  weight: number | null;
  completed_at: string | null;
  target_reps: number | null;
  target_weight: number | null;
}

/**
 * The next targets for one set, from the same set last time. `plan` gives the rep range and the
 * fallback weight; `tracksWeight` is false for exercises that only track reps. For a bodyweight
 * exercise (agent-notes/bodyweight.md) the weight is the added weight: blank counts as 0 and it
 * may go below 0 (assistance), so the total follows the step.
 */
export function nextTargets(
  prev: PreviousSet, plan: Pick<WorkoutSet, "reps_min" | "reps_max" | "is_amrap" | "weight">, tracksWeight: boolean, step = WEIGHT_STEP,
  bodyweight = false,
): SetTargets {
  const { min, max } = repRange(plan);
  // Not checked off (or no reps typed): carry the previous targets forward unchanged.
  if (prev.completed_at === null || prev.reps === null) {
    return { reps: prev.target_reps ?? null, weight: tracksWeight ? (prev.target_weight ?? plan.weight) : plan.weight };
  }
  const weight: number | null = tracksWeight ? (prev.weight ?? prev.target_weight ?? plan.weight ?? (bodyweight ? 0 : null)) : null;
  const reps: number = prev.reps;
  // AMRAP (user requirement): reps follow the same +1 / match rule with no range, and the weight
  // is carried over unchanged. Changing it is left to the user.
  if (plan.is_amrap) return { reps: reps >= (prev.target_reps ?? reps) ? reps + 1 : reps, weight };
  const target: number = prev.target_reps ?? min; // the first autoregulated session compares with the minimum
  if (reps < min) return { reps: min, weight: weight === null ? null : bodyweight ? weight - step : Math.max(0, weight - step) };
  const next = reps >= target ? reps + 1 : reps;
  if (next > max) {
    // No weight to raise (bodyweight): hold at the top of the range instead.
    return weight === null ? { reps: max, weight: null } : { reps: min, weight: weight + step };
  }
  return { reps: next, weight: tracksWeight ? weight : plan.weight };
}

export async function isDeload(db: Db, date: string): Promise<boolean> {
  return Boolean(await get(db, "SELECT 1 AS x FROM deload_day WHERE date = ?", [date]));
}

/** Marks or unmarks a day as a deload, which autoregulation then skips as a reference. */
export async function setDeload(db: Db, date: string, on: boolean): Promise<void> {
  await db.run(on ? "INSERT OR IGNORE INTO deload_day (date) VALUES (?)" : "DELETE FROM deload_day WHERE date = ?", [date]);
}

export const NOT_DELOAD = "date NOT IN (SELECT date FROM deload_day)";

/**
 * Targets for every set of the workout's slots when it's loaded on `date`, or null for a set that
 * keeps the plan's targets. The reference is the workout's latest earlier non-deload session (a
 * log_workout; the later one when it was done twice on a day); its exercises are matched to the slots by exercise, in order, so a
 * rearranged workout still lines up. A slot whose exercise wasn't in that session (replaced) uses
 * the exercise's own latest earlier non-deload entry. Never done before: the plan, unchanged.
 */
export async function autoregulatedTargets(
  db: Db, date: string, workoutId: number, slots: WorkoutSlot[], defaultStep = WEIGHT_STEP,
): Promise<(SetTargets | null)[][]> {
  const planOnly = slots.map((wx) => wx.sets.map(() => null));
  const last = await get(db,
    `SELECT lw.id FROM log_workout lw JOIN log_exercise lx ON lx.log_workout_id = lw.id
     WHERE lw.workout_id = ? AND lw.date < ? AND lw.date NOT IN (SELECT date FROM deload_day)
     GROUP BY lw.id ORDER BY lw.date DESC, MIN(lx.position) DESC LIMIT 1`, [workoutId, date]);
  if (!last) return planOnly;
  const previous = await db.all("SELECT id, exercise_id FROM log_exercise WHERE log_workout_id = ? ORDER BY position", [last.id]);
  const used = new Set<number>();
  const result: (SetTargets | null)[][] = [];
  for (const wx of slots) {
    let entry = previous.find((p) => p.exercise_id === wx.exercise.id && !used.has(p.id));
    if (entry) used.add(entry.id);
    else {
      entry = await get(
        db, `SELECT id FROM log_exercise WHERE exercise_id = ? AND date < ? AND ${NOT_DELOAD} ORDER BY date DESC, position DESC LIMIT 1`,
        [wx.exercise.id, date],
      );
    }
    // Working sets match by position among working sets; warmups are never adjusted or a reference.
    const prevSets = entry
      ? await db.all("SELECT * FROM log_set WHERE log_exercise_id = ? AND NOT is_warmup ORDER BY position", [entry.id]) : [];
    const working = workingSets(wx.sets);
    result.push(wx.sets.map((ws) => {
      const prev = prevSets[working.indexOf(ws)];
      if (ws.is_warmup || !prev || !wx.exercise.tracks.reps) return null;
      return nextTargets(
        prev as PreviousSet, ws, wx.exercise.tracks.weight, wx.exercise.weight_step ?? defaultStep, wx.exercise.uses_bodyweight,
      );
    }));
  }
  return result;
}
