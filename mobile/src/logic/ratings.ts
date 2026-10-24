// Workout ratings (user requirement, 2026-10-24; agent-notes/ratings.md): recovery going into a
// loaded workout and effort during it. Stored on log_workout as 0–1 whatever the entry method;
// 1 is fully recovered / maximum effort.
import type { Db } from "../db/types";
import { getDayWorkout } from "./dayWorkouts";
import { ValidationError } from "./text";

export const RATING_KINDS = ["recovery", "effort"] as const;
export type RatingKind = (typeof RATING_KINDS)[number];

export const RATING_METHODS = ["faces", "stars", "slider"] as const;
export type RatingMethod = (typeof RATING_METHODS)[number];

/** Faces 😞 😐 🙂 are 0, 0.5 and 1. */
export const FACES = ["😞", "😐", "🙂"] as const;
export const faceValue = (i: number) => i / 2;
/** The face nearest a stored value (0.25 and 0.75 round up). */
export const nearestFace = (v: number) => Math.min(2, Math.floor(v * 2 + 0.5));

/** Stars 1–5 are (stars − 1) ÷ 4: 0, 0.25, 0.5, 0.75, 1. */
export const STARS = 5;
export const starValue = (stars: number) => (stars - 1) / (STARS - 1);
/** The star count nearest a stored value. */
export const nearestStars = (v: number) => Math.min(STARS, Math.floor(v * (STARS - 1) + 0.5) + 1);

/** Slider values are kept to 0.01. */
export const roundRating = (v: number) => Math.round(v * 100) / 100;

/** Sets (or, with null, clears) one rating of a workout on a day. */
export async function setRating(db: Db, logWorkoutId: number, kind: RatingKind, value: number | null): Promise<void> {
  if (!RATING_KINDS.includes(kind)) throw new ValidationError("Unknown rating.");
  if (value !== null && !(Number.isFinite(value) && value >= 0 && value <= 1)) throw new ValidationError("A rating is between 0 and 1.");
  await getDayWorkout(db, logWorkoutId); // NotFoundError if it's gone
  await db.run(`UPDATE log_workout SET ${kind} = ? WHERE id = ?`, [value === null ? null : roundRating(value), logWorkoutId]);
}
