import { describe, expect, it } from "vitest";
import { exportBackup, importBackup } from "../src/db/backup";
import { migrate, MIGRATIONS } from "../src/db/schema";
import { nextTargets } from "../src/logic/autoregulation";
import { bodyweightOn, setBodyweight, setTotal, signedAdded } from "../src/logic/bodyweight";
import { addExercises, addLogSet, autoregulateEntry, clearDay, dayEntries, targetValues, updateSet } from "../src/logic/day";
import { listDayWorkouts } from "../src/logic/dayWorkouts";
import { getExercise, saveExercise, seedDefaultExercises } from "../src/logic/exercises";
import { exerciseHistory, setResult } from "../src/logic/history";
import { syncMuscleGroups } from "../src/logic/muscles";
import { progressData } from "../src/logic/progress";
import { saveWorkout, slotSummary, getWorkout } from "../src/logic/workouts";
import { loadWorkout } from "../src/logic/day";
import { openTestDb } from "./sqljs";

async function setup() {
  const db = await openTestDb();
  await migrate(db);
  await syncMuscleGroups(db);
  const ex = async (name: string, uses_bodyweight: boolean, tracking = ["weight", "reps"]) => {
    const r = await saveExercise(db, null, { name, tracking, primary: ["Lats"], ancillary: [], note: "", uses_bodyweight });
    if (!r.ok) throw new Error(r.errors.join());
    return r.id;
  };
  return { db, pullup: await ex("Pull", true), row: await ex("Row", false) };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
const entry = async ({ db }: Ctx, date: string, exerciseId: number) =>
  (await dayEntries(db, date)).find((lx) => lx.exercise.id === exerciseId)!;
async function log(c: Ctx, date: string, exerciseId: number, values: [number, number | null][]) {
  const s = (await entry(c, date, exerciseId)).sets;
  for (const [n, [reps, weight]] of values.entries()) await updateSet(c.db, s[n].id, { reps, weight: weight ?? "", completed: true });
}

describe("bodyweight helpers", () => {
  it("applies the day's bodyweight, else the latest earlier one, else the earliest", () => {
    const rows = [{ date: "2026-10-05", weight: 180 }, { date: "2026-10-10", weight: 178 }];
    expect(bodyweightOn(rows, "2026-10-01")?.weight).toBe(180);
    expect(bodyweightOn(rows, "2026-10-07")?.weight).toBe(180);
    expect(bodyweightOn(rows, "2026-10-10")?.weight).toBe(178);
    expect(bodyweightOn(rows, "2026-12-01")).toEqual({ date: "2026-10-10", weight: 178 });
    expect(bodyweightOn([], "2026-10-01")).toBeNull();
  });

  it("totals and labels added weight", () => {
    expect(setTotal(-40, 180)).toBe(140);
    expect(setTotal(null, 180)).toBe(180);
    expect(setTotal(10, null)).toBeNull();
    expect([signedAdded(10), signedAdded(-40), signedAdded(0), signedAdded(null)]).toEqual(["+10", "−40", "BW", "BW"]);
  });

  it("steps added weight through zero and below it (assistance)", () => {
    const plan = { reps_min: 8, reps_max: 12, is_amrap: false, weight: null };
    const done = (reps: number, weight: number | null) => ({ reps, weight, completed_at: "x", target_reps: reps, target_weight: weight });
    expect(nextTargets(done(12, null), plan, true, 5, true)).toEqual({ reps: 8, weight: 5 }); // blank = 0 added
    expect(nextTargets(done(12, -5), plan, true, 5, true)).toEqual({ reps: 8, weight: 0 });
    expect(nextTargets(done(6, 0), plan, true, 5, true)).toEqual({ reps: 8, weight: -5 }); // more assistance
    expect(nextTargets(done(6, 0), plan, true, 5, false)).toEqual({ reps: 8, weight: 0 }); // plain: floor at 0
  });
});

describe("bodyweight exercises", () => {
  it("flags new sets, allows negative added weight only there, and fills 0 on a blank check-off", async () => {
    const c = await setup();
    await addExercises(c.db, "2026-10-01", [c.pullup, c.row]);
    const pull = await entry(c, "2026-10-01", c.pullup);
    expect(pull.sets.every((s) => s.uses_bodyweight)).toBe(true);
    expect(await updateSet(c.db, pull.sets[0].id, { weight: -40 })).toMatchObject({ weight: -40 });
    expect(targetValues(pull.sets[1]).weight).toBe(0);
    const row = await entry(c, "2026-10-01", c.row);
    expect(row.sets.some((s) => s.uses_bodyweight)).toBe(false);
    await expect(updateSet(c.db, row.sets[0].id, { weight: -5 })).rejects.toThrow("between 0 and");
    await addLogSet(c.db, pull.id);
    expect((await entry(c, "2026-10-01", c.pullup)).sets.at(-1)!.uses_bodyweight).toBe(true);
  });

  it("counts the total in volume, and the added weight alone when no bodyweight is recorded", async () => {
    const c = await setup();
    await addExercises(c.db, "2026-10-01", [c.pullup, c.row]);
    await log(c, "2026-10-01", c.pullup, [[10, -40], [8, 10], [6, null]]);
    await log(c, "2026-10-01", c.row, [[10, 100]]);
    // No bodyweight: -40 counts as 0 (never below), +10 counts 10, blank 0.
    expect((await progressData(c.db, "2026-10-01", "2026-10-01")).totalVolume).toBe(80 + 1000);
    await setBodyweight(c.db, "2026-10-05", "180"); // later entry also covers earlier days
    const volume = 140 * 10 + 190 * 8 + 180 * 6 + 1000;
    expect((await progressData(c.db, "2026-10-01", "2026-10-01")).totalVolume).toBe(volume);
    await setBodyweight(c.db, "2026-10-01", "170");
    expect((await progressData(c.db, "2026-10-01", "2026-10-01")).totalVolume).toBe(volume - 10 * 24);
  });

  it("includes bodyweight in a day workout's volume", async () => {
    const c = await setup();
    const w = await saveWorkout(c.db, null, "Pull day", JSON.stringify([
      { exercise_id: c.pullup, superset_next: false, sets: [{ min: 8, max: 12, amrap: false, weight: null, time: null, distance: null }] },
    ]));
    if (!w.ok) throw new Error();
    await setBodyweight(c.db, "2026-10-01", "180");
    await loadWorkout(c.db, "2026-10-01", w.id);
    await log(c, "2026-10-01", c.pullup, [[10, -30]]);
    expect((await listDayWorkouts(c.db, "2026-10-01"))[0].volume).toBe(1500);
  });

  it("shows totals in history", async () => {
    const c = await setup();
    await addExercises(c.db, "2026-10-01", [c.pullup]);
    await log(c, "2026-10-01", c.pullup, [[8, -40], [6, null]]);
    const exercise = await getExercise(c.db, c.pullup);
    let [session] = await exerciseHistory(c.db, exercise);
    expect(session.sets.map((s) => setResult(s, exercise, session.bodyweight))).toEqual(["BW −40 lb × 8", "BW × 6"]);
    await setBodyweight(c.db, "2026-10-01", "180");
    [session] = await exerciseHistory(c.db, exercise);
    expect(session.sets.map((s) => setResult(s, exercise, session.bodyweight))).toEqual(["140 lb (−40) × 8", "180 lb (BW) × 6"]);
  });

  it("autoregulates the added weight from the last session", async () => {
    const c = await setup();
    await addExercises(c.db, "2026-10-01", [c.pullup]);
    await log(c, "2026-10-01", c.pullup, [[16, -20], [5, 0]]);
    await addExercises(c.db, "2026-10-03", [c.pullup]);
    await autoregulateEntry(c.db, (await entry(c, "2026-10-03", c.pullup)).id, 5);
    expect((await entry(c, "2026-10-03", c.pullup)).sets.map((s) => [s.target_reps, s.target_weight]))
      .toEqual([[8, -15], [8, -5], [null, null]]);
  });

  it("marking or unmarking changes only sets with nothing recorded", async () => {
    const c = await setup();
    await addExercises(c.db, "2026-10-01", [c.row]);
    await log(c, "2026-10-01", c.row, [[10, 100]]);
    const form = { name: "Row", tracking: ["reps"], primary: ["Lats"], ancillary: [], note: "", uses_bodyweight: true };
    expect(await saveExercise(c.db, c.row, form)).toMatchObject({ ok: true });
    expect((await getExercise(c.db, c.row)).tracks.weight).toBe(true); // bodyweight implies weight
    expect((await entry(c, "2026-10-01", c.row)).sets.map((s) => s.uses_bodyweight)).toEqual([false, true, true]);
    expect((await progressData(c.db, "2026-10-01", "2026-10-01")).totalVolume).toBe(1000); // unchanged
    // Unmarking drops assistance targets on unrecorded sets.
    const s = (await entry(c, "2026-10-01", c.row)).sets[1];
    await c.db.run("UPDATE log_set SET target_weight = -10 WHERE id = ?", [s.id]);
    await saveExercise(c.db, c.row, { ...form, tracking: ["weight", "reps"], uses_bodyweight: false });
    const after = (await entry(c, "2026-10-01", c.row)).sets[1];
    expect([after.uses_bodyweight, after.target_weight]).toEqual([false, null]);
  });

  it("labels planned weights as added weight", async () => {
    const c = await setup();
    const w = await saveWorkout(c.db, null, "P", JSON.stringify([
      { exercise_id: c.pullup, superset_next: false, sets: [{ min: 8, max: 12, amrap: false, weight: "10", time: null, distance: null }] },
    ]));
    if (!w.ok) throw new Error();
    expect(slotSummary((await getWorkout(c.db, w.id)).slots[0])).toBe("1 × 8–12 @ BW +10 lb");
  });

  it("validates the day's bodyweight, blank removes it, and Clear day removes it", async () => {
    const c = await setup();
    await expect(setBodyweight(c.db, "2026-10-01", "0")).rejects.toThrow("above 0");
    await expect(setBodyweight(c.db, "2026-10-01", "abc")).rejects.toThrow();
    expect(await setBodyweight(c.db, "2026-10-01", " 181.256 ")).toBe(181.26);
    expect(await setBodyweight(c.db, "2026-10-01", "")).toBeNull();
    await setBodyweight(c.db, "2026-10-02", "180");
    await addExercises(c.db, "2026-10-02", [c.pullup]);
    await clearDay(c.db, "2026-10-02");
    expect(await c.db.all("SELECT * FROM bodyweight")).toEqual([]);
  });
});

describe("schema 6", () => {
  it("marks the default exercises, keeps logged sets as they were, and flags only unrecorded sets", async () => {
    const db = await openTestDb();
    for (const m of MIGRATIONS.slice(0, 5)) {
      if (typeof m === "string") await db.exec(m);
      else await m(db);
    }
    await db.exec("PRAGMA user_version = 5");
    await db.run("INSERT INTO exercise (id, name, tracks_weight, tracks_reps, created_at) VALUES (1, 'Pullup', 0, 1, 'x'), (2, 'Row', 1, 1, 'x')");
    await db.run("INSERT INTO log_exercise (id, date, position, exercise_id) VALUES (1, '2026-10-01', 1, 1)");
    await db.run(`INSERT INTO log_set (log_exercise_id, position, reps, weight, completed_at) VALUES
      (1, 1, 10, 25, 'x'), (1, 2, 8, NULL, 'x'), (1, 3, NULL, NULL, NULL)`);
    await migrate(db);
    const ex = await db.all("SELECT name, uses_bodyweight, tracks_weight FROM exercise ORDER BY id");
    expect(ex).toEqual([{ name: "Pullup", uses_bodyweight: 1, tracks_weight: 1 }, { name: "Row", uses_bodyweight: 0, tracks_weight: 1 }]);
    expect(await db.all("SELECT weight, reps, uses_bodyweight FROM log_set ORDER BY position")).toEqual([
      { weight: 25, reps: 10, uses_bodyweight: 0 }, { weight: null, reps: 8, uses_bodyweight: 0 }, { weight: null, reps: null, uses_bodyweight: 1 },
    ]);
    expect(await db.all("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("seeds the approved defaults marked, and marks them when importing an older backup", async () => {
    const db = await openTestDb();
    await migrate(db);
    await syncMuscleGroups(db);
    await seedDefaultExercises(db);
    const marked = async () => (await db.all("SELECT name FROM exercise WHERE uses_bodyweight ORDER BY name")).map((r) => r.name);
    const expected = ["Chinup", "Dips", "Hyperextension", "Neutral Pullup", "Pullup"];
    expect(await marked()).toEqual(expected);
    const backup = await exportBackup(db);
    await importBackup(db, backup);
    expect(await marked()).toEqual(expected);
    for (const row of backup.tables.exercise) delete row.uses_bodyweight;
    await importBackup(db, { ...backup, schema: 5, tables: { ...backup.tables, bodyweight: undefined as any } });
    expect(await marked()).toEqual(expected);
  });
});
