import { describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema";
import { setBodyweight } from "../src/logic/bodyweight";
import {
  addExercises, addLogSet, autoregulateEntry, changeWarmups, dayBlocks, dayEntries, dayToWorkoutItems, loadWorkout, removeLastLogSet,
  restAfterSets, updateSet,
} from "../src/logic/day";
import { listDayWorkouts } from "../src/logic/dayWorkouts";
import { saveExercise } from "../src/logic/exercises";
import { syncMuscleGroups } from "../src/logic/muscles";
import { progressData } from "../src/logic/progress";
import { getWorkout, saveWorkout, slotSummary, workoutMuscleSets, workoutSetCount } from "../src/logic/workouts";
import { openTestDb } from "./sqljs";

const set = (min: number | null, max: number | null, weight: string | null = null, warmup = false, amrap = false) =>
  ({ min, max, amrap, weight, time: null, distance: null, ...(warmup ? { warmup: true } : {}) });

async function setup() {
  const db = await openTestDb();
  await migrate(db);
  await syncMuscleGroups(db);
  const ex = async (name: string, uses_bodyweight = false) => {
    const r = await saveExercise(db, null, { name, tracking: ["weight", "reps"], primary: ["Chest"], ancillary: [], note: "", uses_bodyweight });
    if (!r.ok) throw new Error(r.errors.join());
    return r.id;
  };
  const bench = await ex("Bench");
  const pull = await ex("Pull", true);
  // Warmups given out of order: saving puts them first.
  const w = await saveWorkout(db, null, "Push", JSON.stringify([
    { exercise_id: bench, superset_next: false, sets: [set(8, 12, "135"), set(5, 5, "45", true), set(8, 12, "135"), set(3, 3, "95", true, true)] },
    { exercise_id: pull, superset_next: false, sets: [set(5, 5, null, true), set(6, 10)] },
  ]));
  if (!w.ok) throw new Error(w.errors.join());
  return { db, bench, pull, workoutId: w.id };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
const entry = async ({ db }: Ctx, date: string, exerciseId: number, nth = 0) =>
  (await dayEntries(db, date)).filter((lx) => lx.exercise.id === exerciseId)[nth];
const planSets = async (c: Ctx) => (await getWorkout(c.db, c.workoutId)).slots.map((wx) =>
  wx.sets.map((s) => [s.is_warmup, s.reps_min, s.weight]));

describe("warmups in workouts", () => {
  it("saves warmups first, never AMRAP, and leaves them out of counts", async () => {
    const c = await setup();
    const w = await getWorkout(c.db, c.workoutId);
    expect(w.slots[0].sets.map((s) => [s.is_warmup, s.reps_min, s.weight, s.is_amrap])).toEqual([
      [true, 5, 45, false], [true, 3, 95, false], [false, 8, 135, false], [false, 8, 135, false],
    ]);
    expect(slotSummary(w.slots[0])).toBe("2 × 8–12 @ 135 lb + 2 warmups");
    expect(slotSummary(w.slots[1])).toBe("1 × 6–10 + 1 warmup");
    expect(workoutSetCount(w)).toBe(3);
    expect(workoutMuscleSets(w).Chest.primary).toBe(3);
  });

  it("needs a working set", async () => {
    const c = await setup();
    const r = await saveWorkout(c.db, null, "Only warmups", JSON.stringify([
      { exercise_id: c.bench, superset_next: false, sets: [set(5, 5, "45", true)] },
    ]));
    expect(r).toMatchObject({ ok: false, errors: ["Bench needs at least one set besides its warmups."] });
  });
});

describe("warmups on a day", () => {
  it("loads them first as plain sets, out of volume, set counts and the rest timer", async () => {
    const c = await setup();
    await setBodyweight(c.db, "2026-10-01", "180");
    await loadWorkout(c.db, "2026-10-01", c.workoutId);
    const bench = await entry(c, "2026-10-01", c.bench);
    expect(bench.sets.map((s) => [s.is_warmup, s.target_weight])).toEqual([[true, 45], [true, 95], [false, 135], [false, 135]]);
    const pull = await entry(c, "2026-10-01", c.pull);
    expect(pull.sets.map((s) => [s.is_warmup, s.uses_bodyweight])).toEqual([[true, false], [false, true]]);
    for (const s of bench.sets) await updateSet(c.db, s.id, { reps: 5, weight: 100, completed: true });
    const p = await progressData(c.db, "2026-10-01", "2026-10-01");
    expect([p.totalVolume, p.completedSets]).toEqual([1000, 2]);
    expect((await listDayWorkouts(c.db, "2026-10-01"))[0].volume).toBe(1000);
    const rest = restAfterSets(dayBlocks(await dayEntries(c.db, "2026-10-01")));
    expect(bench.sets.map((s) => rest.has(s.id))).toEqual([false, false, true, true]);
  });

  it("never autoregulates warmups or uses them as the reference", async () => {
    const c = await setup();
    await loadWorkout(c.db, "2026-10-01", c.workoutId);
    const first = await entry(c, "2026-10-01", c.bench);
    for (const [n, s] of first.sets.entries()) await updateSet(c.db, s.id, { reps: n < 2 ? 5 : 12, weight: n < 2 ? 45 : 135, completed: true });
    await loadWorkout(c.db, "2026-10-03", c.workoutId, true);
    const t = (await entry(c, "2026-10-03", c.bench)).sets.map((s) => [s.target_reps, s.target_weight]);
    expect(t).toEqual([[null, 45], [null, 95], [8, 140], [8, 140]]);
    // The AR button, with a different warmup count than last time: working sets still line up.
    await addExercises(c.db, "2026-10-05", [c.bench]);
    const adhoc = await entry(c, "2026-10-05", c.bench);
    await changeWarmups(c.db, adhoc.id, true);
    await autoregulateEntry(c.db, adhoc.id, 5);
    expect((await entry(c, "2026-10-05", c.bench)).sets.map((s) => [s.is_warmup, s.target_reps, s.target_weight]))
      .toEqual([[true, null, null], [false, 8, 140], [false, 8, 140], [false, null, null]]);
  });

  it("carries a warmup added or removed on the day over to the workout", async () => {
    const c = await setup();
    await loadWorkout(c.db, "2026-10-01", c.workoutId);
    const pull = await entry(c, "2026-10-01", c.pull);
    expect(await changeWarmups(c.db, pull.id, true)).toBe("Push");
    expect((await entry(c, "2026-10-01", c.pull)).sets.map((s) => [s.is_warmup, s.position, s.target_reps_min]))
      .toEqual([[true, 1, 5], [true, 2, 5], [false, 3, 6]]);
    expect((await planSets(c))[1]).toEqual([[true, 5, null], [true, 5, null], [false, 6, null]]);
    const bench = await entry(c, "2026-10-01", c.bench);
    expect(await changeWarmups(c.db, bench.id, false)).toBe("Push");
    expect((await planSets(c))[0]).toEqual([[true, 5, 45], [false, 8, 135], [false, 8, 135]]);
    // A checked-off warmup isn't removed.
    await updateSet(c.db, (await entry(c, "2026-10-01", c.bench)).sets[0].id, { completed: true });
    await expect(changeWarmups(c.db, bench.id, false)).rejects.toThrow("Un-check");
    // Loads after that have the change.
    await loadWorkout(c.db, "2026-10-02", c.workoutId);
    expect((await entry(c, "2026-10-02", c.pull)).sets.filter((s) => s.is_warmup)).toHaveLength(2);
  });

  it("matches duplicate exercises by order, and keeps ad-hoc changes to the day", async () => {
    const c = await setup();
    const w = await saveWorkout(c.db, null, "Twice", JSON.stringify([
      { exercise_id: c.bench, superset_next: false, sets: [set(8, 12)] },
      { exercise_id: c.bench, superset_next: false, sets: [set(8, 12)] },
    ]));
    if (!w.ok) throw new Error();
    await loadWorkout(c.db, "2026-10-01", w.id);
    await changeWarmups(c.db, (await entry(c, "2026-10-01", c.bench, 1)).id, true);
    expect((await getWorkout(c.db, w.id)).slots.map((wx) => wx.sets.length)).toEqual([1, 2]);
    await addExercises(c.db, "2026-10-02", [c.bench]);
    expect(await changeWarmups(c.db, (await entry(c, "2026-10-02", c.bench)).id, true)).toBeNull();
  });

  it("+ Set / − Set work on working sets, and Build workout from day keeps warmups", async () => {
    const c = await setup();
    await loadWorkout(c.db, "2026-10-01", c.workoutId);
    const pull = await entry(c, "2026-10-01", c.pull);
    await expect(removeLastLogSet(c.db, pull.id)).rejects.toThrow("at least one set");
    await addLogSet(c.db, pull.id);
    const sets = (await entry(c, "2026-10-01", c.pull)).sets;
    expect(sets.map((s) => [s.is_warmup, s.target_reps_min])).toEqual([[true, 5], [false, 6], [false, 6]]);
    expect(dayToWorkoutItems(await dayEntries(c.db, "2026-10-01"))[1].sets.map((s) => Boolean(s.warmup))).toEqual([true, false, false]);
  });
});
