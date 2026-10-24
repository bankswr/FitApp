import { describe, expect, it } from "vitest";
import { exportBackup, importBackup } from "../src/db/backup";
import { migrate, MIGRATIONS } from "../src/db/schema";
import { loadWorkout } from "../src/logic/day";
import { getDayWorkout, listDayWorkouts } from "../src/logic/dayWorkouts";
import { saveExercise } from "../src/logic/exercises";
import { syncMuscleGroups } from "../src/logic/muscles";
import { average, progressRatings } from "../src/logic/progress";
import { faceValue, nearestFace, nearestStars, setRating, starValue } from "../src/logic/ratings";
import { saveRoutine } from "../src/logic/routines";
import { saveWorkout } from "../src/logic/workouts";
import { openTestDb } from "./sqljs";

// Workouts A (in routine R) and B, each loaded on the given dates. Returns the log_workout ids in load order.
async function setup(loads: [string, "A" | "B"][]) {
  const db = await openTestDb();
  await migrate(db);
  await syncMuscleGroups(db);
  const ex = await saveExercise(db, null, { name: "Bench", tracking: ["weight", "reps"], primary: ["Chest"], ancillary: [], note: "" });
  if (!ex.ok) throw new Error();
  const plan = JSON.stringify([{ exercise_id: ex.id, superset_next: false,
    sets: [{ min: 8, max: 12, amrap: false, weight: null, time: null, distance: null }] }]);
  const a = await saveWorkout(db, null, "A", plan);
  const b = await saveWorkout(db, null, "B", plan);
  if (!a.ok || !b.ok) throw new Error();
  const r = await saveRoutine(db, null, { name: "R", workout_ids: [a.id], cycle_days: "7", targets: {} });
  if (!r.ok) throw new Error(r.errors.join());
  const ids: number[] = [];
  for (const [date, name] of loads) {
    await loadWorkout(db, date, name === "A" ? a.id : b.id);
    ids.push((await listDayWorkouts(db, date)).at(-1)!.id);
  }
  return { db, ids, a: a.id, b: b.id, routine: r.id };
}

describe("workout ratings", () => {
  it("maps every entry method onto 0–1 and back to the nearest choice", () => {
    expect([0, 1, 2].map(faceValue)).toEqual([0, 0.5, 1]);
    expect([1, 2, 3, 4, 5].map(starValue)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect([0, 0.24, 0.25, 0.6, 0.74, 0.75, 1].map(nearestFace)).toEqual([0, 0, 1, 1, 1, 2, 2]);
    expect([0, 0.12, 0.13, 0.5, 0.62, 0.63, 1].map(nearestStars)).toEqual([1, 1, 2, 3, 3, 4, 5]);
    for (let s = 1; s <= 5; s++) expect(nearestStars(starValue(s))).toBe(s);
    expect(average([])).toBeNull();
    expect(average([0.5, 1])).toBe(0.75);
  });

  it("stores recovery and effort on the day's workout, rounded to 0.01, and clears them", async () => {
    const { db, ids: [id] } = await setup([["2026-10-01", "A"]]);
    expect(await getDayWorkout(db, id)).toMatchObject({ recovery: null, effort: null });
    await setRating(db, id, "recovery", 0.756);
    await setRating(db, id, "effort", 1);
    expect(await getDayWorkout(db, id)).toMatchObject({ recovery: 0.76, effort: 1 });
    await setRating(db, id, "recovery", null);
    expect(await getDayWorkout(db, id)).toMatchObject({ recovery: null, effort: 1 });
    await expect(setRating(db, id, "effort", 1.5)).rejects.toThrow(/between 0 and 1/);
    await expect(setRating(db, id, "effort", NaN)).rejects.toThrow(/between 0 and 1/);
    await expect(setRating(db, id, "mood" as "effort", 0.5)).rejects.toThrow(/Unknown rating/);
    await expect(setRating(db, id + 99, "effort", 0.5)).rejects.toThrow(/no longer on this day/);
    await expect(db.run("UPDATE log_workout SET effort = -0.1 WHERE id = ?", [id])).rejects.toThrow(/CHECK/);
  });

  it("charts only rated days, each workout's value plus the day's average, under the Progress filter", async () => {
    const { db, ids, a, b, routine } = await setup([
      ["2026-10-01", "A"], ["2026-10-01", "B"], ["2026-10-02", "A"], ["2026-10-03", "B"], ["2026-10-05", "A"],
    ]);
    await setRating(db, ids[0], "recovery", 0.5);
    await setRating(db, ids[0], "effort", 1);
    await setRating(db, ids[1], "recovery", 1);
    await setRating(db, ids[3], "effort", 0.25);
    await setRating(db, ids[4], "recovery", 0); // outside the range below
    const all = await progressRatings(db, "2026-10-01", "2026-10-04");
    expect(all).toEqual([
      { date: "2026-10-01", recovery: [0.5, 1], effort: [1] },
      { date: "2026-10-03", recovery: [], effort: [0.25] },
    ]);
    expect(average(all[0].recovery)).toBe(0.75);
    expect(await progressRatings(db, "2026-10-01", "2026-10-04", { kind: "workout", id: b })).toEqual([
      { date: "2026-10-01", recovery: [1], effort: [] },
      { date: "2026-10-03", recovery: [], effort: [0.25] },
    ]);
    expect(await progressRatings(db, "2026-10-01", "2026-10-05", { kind: "routine", id: routine })).toEqual([
      { date: "2026-10-01", recovery: [0.5], effort: [1] },
      { date: "2026-10-05", recovery: [0], effort: [] },
    ]);
    expect(await progressRatings(db, "2026-10-01", "2026-10-05", { kind: "workout", id: a + b + 99 })).toEqual([]);
  });

  it("travels in backups, and migration 8 leaves existing workouts unrated", async () => {
    const { db, ids: [id] } = await setup([["2026-10-01", "A"]]);
    await setRating(db, id, "effort", 0.75);
    const backup = await exportBackup(db);
    expect(backup.tables.log_workout[0]).toMatchObject({ recovery: null, effort: 0.75 });
    const copy = await openTestDb();
    await migrate(copy);
    await importBackup(copy, backup);
    expect(await getDayWorkout(copy, id)).toMatchObject({ recovery: null, effort: 0.75 });

    const old = await openTestDb();
    for (const m of MIGRATIONS.slice(0, 7)) {
      if (typeof m === "string") await old.exec(m);
      else await m(old);
    }
    await old.exec(`PRAGMA user_version = 7;
      INSERT INTO log_workout (id, date, name) VALUES (1, '2026-10-01', 'A');`);
    await migrate(old);
    expect(await old.all("SELECT recovery, effort FROM log_workout")).toEqual([{ recovery: null, effort: null }]);
  });
});
