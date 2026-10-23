// Bodyweight exercises (user requirement, 2026-10-23; agent-notes/bodyweight.md). Not in Flask.
// An exercise marked uses_bodyweight logs the weight added (+) or the assistance (−); the set's
// total is the day's bodyweight plus that. Each set records whether it counts bodyweight
// (log_set.uses_bodyweight), so history logged before an exercise was marked keeps its volume.
import { type Db, get } from "../db/types";
import { formatG, parseLogValue, round2, ValidationError } from "./text";

/** Built-in exercises that come marked (user-approved list). */
export const DEFAULT_BODYWEIGHT_EXERCISES = ["Pullup", "Neutral Pullup", "Chinup", "Dips", "Hyperextension"];
export const BODYWEIGHT_MAX = 1000; // lb

/** A set nothing has been recorded in yet: its flag still follows the exercise's setting. */
export const UNRECORDED_SET_SQL =
  "completed_at IS NULL AND weight IS NULL AND reps IS NULL AND duration_seconds IS NULL AND distance IS NULL";

/**
 * Marks the default bodyweight exercises (by exact name) and their unrecorded sets. Used by
 * migration 6 and when importing an older backup.
 */
export async function markDefaultBodyweightExercises(db: Db): Promise<void> {
  const names = DEFAULT_BODYWEIGHT_EXERCISES;
  await db.run(
    `UPDATE exercise SET uses_bodyweight = 1, tracks_weight = 1 WHERE name IN (${names.map(() => "?").join(",")})`, names,
  );
  await db.run(
    `UPDATE log_set SET uses_bodyweight = 1 WHERE ${UNRECORDED_SET_SQL} AND log_exercise_id IN
       (SELECT lx.id FROM log_exercise lx JOIN exercise e ON e.id = lx.exercise_id WHERE e.uses_bodyweight)`,
  );
}

/**
 * The weight one set moves, in SQL (needs aliases `ls` for log_set and `lx` for log_exercise):
 * bodyweight + added for a set that counts bodyweight (never below 0; blank added = 0; no
 * bodyweight recorded = the added weight alone), else the logged weight.
 */
export const SET_LOAD_SQL = `CASE WHEN ls.uses_bodyweight THEN MAX(0, COALESCE(ls.weight, 0) + COALESCE(
    (SELECT b.weight FROM bodyweight b WHERE b.date <= lx.date ORDER BY b.date DESC LIMIT 1),
    (SELECT b.weight FROM bodyweight b ORDER BY b.date LIMIT 1), 0)) ELSE ls.weight END`;

export interface BodyweightEntry {
  date: string;
  weight: number;
}

/** Every recorded bodyweight, oldest first. */
export async function listBodyweights(db: Db): Promise<BodyweightEntry[]> {
  return (await db.all("SELECT date, weight FROM bodyweight ORDER BY date")) as BodyweightEntry[];
}

/**
 * The bodyweight that applies on `date`: that day's, else the latest earlier one, else the
 * earliest one recorded (for days before the first entry). Null when none is recorded.
 * `entries` is oldest first.
 */
export function bodyweightOn(entries: BodyweightEntry[], date: string): BodyweightEntry | null {
  let found: BodyweightEntry | null = null;
  for (const e of entries) {
    if (e.date > date) break;
    found = e;
  }
  return found ?? entries[0] ?? null;
}

/** The bodyweight entered for exactly `date`, or null. */
export async function dayBodyweight(db: Db, date: string): Promise<number | null> {
  return ((await get(db, "SELECT weight FROM bodyweight WHERE date = ?", [date]))?.weight as number | undefined) ?? null;
}

/** Saves the day's bodyweight from the text typed; blank removes it. Throws ValidationError. */
export async function setBodyweight(db: Db, date: string, raw: unknown): Promise<number | null> {
  const weight = parseLogValue(typeof raw === "string" ? raw.trim() : raw, "Bodyweight", { integer: false, maximum: BODYWEIGHT_MAX });
  if (weight === 0) throw new ValidationError("Bodyweight must be above 0.");
  if (weight === null) await db.run("DELETE FROM bodyweight WHERE date = ?", [date]);
  else await db.run("INSERT OR REPLACE INTO bodyweight (date, weight) VALUES (?, ?)", [date, weight]);
  return weight;
}

/** A set's total: bodyweight + added (blank = 0), or null when no bodyweight is known. */
export function setTotal(added: number | null, bodyweight: number | null): number | null {
  return bodyweight === null ? null : round2(bodyweight + (added ?? 0));
}

/** Added weight with its sign: "+10", "−40", or "BW" for none. */
export function signedAdded(added: number | null): string {
  if (!added) return "BW";
  return added > 0 ? `+${formatG(added)}` : `−${formatG(-added)}`;
}
