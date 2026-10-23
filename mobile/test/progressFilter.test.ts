import { describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema";
import { addExercises, dayEntries, loadWorkout, updateSet } from "../src/logic/day";
import { saveExercise } from "../src/logic/exercises";
import { syncMuscleGroups } from "../src/logic/muscles";
import { parseProgressFilter, progressData } from "../src/logic/progress";
import { saveRoutine } from "../src/logic/routines";
import { saveWorkout } from "../src/logic/workouts";
import { openTestDb } from "./sqljs";

describe("progress filtered to a routine or workout", () => {
  it("counts only sets logged in that workout's sessions, or the routine's workouts'", async () => {
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
    await loadWorkout(db, "2026-10-01", a.id);
    await loadWorkout(db, "2026-10-02", b.id);
    await addExercises(db, "2026-10-03", [ex.id]); // on its own: outside any workout
    for (const [date, weight] of [["2026-10-01", 100], ["2026-10-02", 200], ["2026-10-03", 300]] as const) {
      const [lx] = await dayEntries(db, date);
      await updateSet(db, lx.sets[0].id, { reps: 10, weight, completed: true });
    }
    const volume = async (f: ReturnType<typeof parseProgressFilter>) => {
      const p = await progressData(db, "2026-10-01", "2026-10-03", f);
      return [p.totalVolume, p.completedSets, p.trainingDays];
    };
    expect(await volume(null)).toEqual([6000, 3, 3]);
    expect(await volume({ kind: "workout", id: a.id })).toEqual([1000, 1, 1]);
    expect(await volume({ kind: "workout", id: b.id })).toEqual([2000, 1, 1]);
    expect(await volume({ kind: "routine", id: r.id })).toEqual([1000, 1, 1]);
    expect(parseProgressFilter("3", null)).toEqual({ kind: "routine", id: 3 });
    expect(parseProgressFilter(null, "4")).toEqual({ kind: "workout", id: 4 });
    expect(parseProgressFilter("x", "")).toBeNull();
  });
});
