// Exercise history: past sessions of one exercise, newest first. Ported from app.py.
import type { Db } from "../db/types";
import { type LogSet, loadEntries } from "./day";
import type { Exercise } from "./exercises";
import { checkDate } from "./day";
import { setTotal, signedAdded } from "./bodyweight";
import { formatDuration, formatG, weightLabel } from "./text";

export const HISTORY_LIMIT = 60; // most recent dates shown

export interface Session {
  date: string;
  /** The bodyweight that applies on this date, for bodyweight sets' totals (null: none recorded). */
  bodyweight: number | null;
  workouts: string[];
  sets: LogSet[];
  notes: string[];
}

/**
 * One session per date, newest first (at most HISTORY_LIMIT dates). A session's sets are the
 * ones actually recorded that day (completed, or with any value entered), in order across that
 * day's entries; notes are that day's session notes. Dates with no recorded sets and no note
 * are skipped. `before` limits it to dates earlier than that day.
 */
export async function exerciseHistory(db: Db, exercise: Exercise, before?: string): Promise<Session[]> {
  const entries = before
    ? await loadEntries(db, "lx.exercise_id = ? AND lx.date < ?", [exercise.id, checkDate(before)])
    : await loadEntries(db, "lx.exercise_id = ?", [exercise.id]);
  const sessions: Session[] = [];
  for (const lx of entries) {
    const recorded = lx.sets.filter(
      (s) => s.completed_at !== null || [s.weight, s.reps, s.duration_seconds, s.distance].some((v) => v !== null),
    );
    if (!recorded.length && !lx.note) continue;
    if (sessions.at(-1)?.date !== lx.date) {
      if (sessions.length === HISTORY_LIMIT) break;
      sessions.push({ date: lx.date, bodyweight: lx.bodyweight, workouts: [], sets: [], notes: [] });
    }
    const session = sessions.at(-1)!;
    if (lx.note) session.notes.push(lx.note);
    if (lx.workout_name && !session.workouts.includes(lx.workout_name)) session.workouts.push(lx.workout_name);
    session.sets.push(...recorded);
  }
  return sessions;
}

/**
 * What was done in a set, for the exercise's current modes: "135 lb × 8", "50 lb · 0:45", "25:00 · 3 mi".
 * A bodyweight set shows its total and the added weight: "140 lb (−40) × 8", "180 lb (BW) × 10", or
 * "BW −40 lb × 8" when no bodyweight is recorded.
 */
export function setResult(s: LogSet, exercise: Exercise, bodyweight: number | null = null): string {
  let head = "";
  if (s.uses_bodyweight) {
    const total = setTotal(s.weight, bodyweight);
    head = total === null ? weightLabel(s.weight ?? 0, true) : `${formatG(total)} lb (${signedAdded(s.weight)})`;
  } else if (exercise.tracks.weight && s.weight !== null) head = `${formatG(s.weight)} lb`;
  if (exercise.tracks.reps && s.reps !== null) head = head ? `${head} × ${s.reps}` : `${s.reps} reps`;
  const parts = [
    head,
    exercise.tracks.time ? formatDuration(s.duration_seconds) : "",
    exercise.tracks.distance && s.distance !== null ? `${formatG(s.distance)} mi` : "",
  ];
  return parts.filter(Boolean).join(" · ") || "—";
}
