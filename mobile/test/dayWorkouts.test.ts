import { describe, expect, it } from "vitest";
import { importBackup } from "../src/db/backup";
import { migrate, MIGRATIONS } from "../src/db/schema";
import { autoregulatedTargets } from "../src/logic/autoregulation";
import { addExercises, clearDay, deleteLogEntry, loadWorkout, setSupersetWithNext } from "../src/logic/day";
import {
  arrangeDay, deleteDayWorkout, finishDayWorkout, finishIfDone, finishStaleWorkouts, getDayWorkout, noteCheckOff, resumeDayWorkout,
  setDayWorkoutTimes, startDayWorkout, wrapIntoDayWorkout,
} from "../src/logic/dayWorkouts";
import { getWorkout } from "../src/logic/workouts";
import { openTestDb } from "./sqljs";

const DAY = "2026-10-01";

// A schema-3 database (before log_workout) with two exercises and workouts A (id 1) and B (id 2).
async function v3Db() {
  const db = await openTestDb();
  for (const m of MIGRATIONS.slice(0, 3)) await db.exec(m as string);
  await db.exec(`
    PRAGMA user_version = 3;
    INSERT INTO exercise (id, name, tracks_weight, tracks_reps, created_at) VALUES (1, 'Bench', 1, 1, 'x'), (2, 'Row', 1, 1, 'x');
    INSERT INTO workout (id, name, created_at) VALUES (1, 'A', 'x'), (2, 'B', 'x');
  `);
  return db;
}

// One row per exercise entry: [position, workout_id, superset_group, completed_at of its one set].
async function logDay(db: Awaited<ReturnType<typeof v3Db>>, rows: [number, number | null, number | null, string | null][]) {
  for (const [k, [position, workoutId, group, done]] of rows.entries()) {
    await db.run("INSERT INTO log_exercise (id, date, position, exercise_id, workout_id, superset_group) VALUES (?, ?, ?, 1, ?, ?)",
      [k + 1, DAY, position, workoutId, group]);
    await db.run("INSERT INTO log_set (log_exercise_id, position, completed_at) VALUES (?, 1, ?)", [k + 1, done]);
  }
}

const day = (db: Awaited<ReturnType<typeof v3Db>>) => db.all(
  `SELECT lx.id, lx.position, lx.superset_group AS g, lw.name FROM log_exercise lx
   LEFT JOIN log_workout lw ON lw.id = lx.log_workout_id WHERE lx.date = ? ORDER BY lx.position`, [DAY],
);

describe("grouping history into workouts (migration 4)", () => {
  it("makes one workout per (date, workout), times from check-offs, and keeps order when nothing interleaves", async () => {
    const db = await v3Db();
    await logDay(db, [
      [1, 1, null, "2026-10-01 15:00:00.000000"],
      [2, 1, null, "2026-10-01 15:40:00.000000"],
      [3, null, null, null],
      [5, 2, null, null],
    ]);
    await migrate(db);
    expect((await day(db)).map((r) => [r.id, r.position, r.name])).toEqual([[1, 1, "A"], [2, 2, "A"], [3, 3, null], [4, 5, "B"]]);
    const workouts = await db.all("SELECT name, workout_id, started_at, ended_at FROM log_workout ORDER BY id");
    expect(workouts).toEqual([
      { name: "A", workout_id: 1, started_at: "2026-10-01 15:00:00.000000", ended_at: "2026-10-01 15:40:00.000000" },
      { name: "B", workout_id: 2, started_at: null, ended_at: null },
    ]);
  });

  it("leaves times blank when the day was logged on a later date, or the span is zero", async () => {
    const db = await v3Db();
    await logDay(db, [[1, 1, null, "2026-10-05 15:00:00.000000"], [2, 2, null, "2026-10-01 15:00:00.000000"]]);
    await migrate(db);
    expect(await db.all("SELECT started_at, ended_at FROM log_workout")).toEqual([{ started_at: null, ended_at: null }, { started_at: null, ended_at: null }]);
  });

  it("makes interleaved workouts contiguous and splits supersets at block edges", async () => {
    const db = await v3Db();
    // A, B, A, loose, B, with a superset across the first A/B edge and one across a loose/B edge.
    await logDay(db, [
      [1, 1, 7, null],
      [2, 2, 7, null],
      [3, 1, null, null],
      [4, null, 9, null],
      [6, 2, 9, null],
    ]);
    await migrate(db);
    const rows = await day(db);
    expect(rows.map((r) => [r.id, r.position, r.name])).toEqual([[1, 1, "A"], [3, 2, "A"], [2, 3, "B"], [5, 4, "B"], [4, 6, null]]);
    expect(rows.every((r) => r.g === null)).toBe(true); // every run became a single member
  });
});

describe("workouts on a day", () => {
  async function withWorkout() {
    const db = await openTestDb();
    await migrate(db);
    await db.exec(`
      INSERT INTO exercise (id, name, tracks_weight, tracks_reps, created_at) VALUES (1, 'Bench', 1, 1, 'x'), (2, 'Row', 1, 1, 'x');
      INSERT INTO workout (id, name, created_at) VALUES (1, 'Push', 'x');
      INSERT INTO workout_exercise (id, workout_id, exercise_id, position) VALUES (1, 1, 1, 1), (2, 1, 2, 2);
      INSERT INTO workout_set (workout_exercise_id, position) VALUES (1, 1), (2, 1);
    `);
    return db;
  }

  it("loading a workout twice makes two workouts, each holding its own exercises", async () => {
    const db = await withWorkout();
    await loadWorkout(db, DAY, 1);
    await loadWorkout(db, DAY, 1);
    const rows = await db.all("SELECT log_workout_id AS w FROM log_exercise ORDER BY position");
    expect(rows.map((r) => r.w)).toEqual([1, 1, 2, 2]);
    expect(await db.all("SELECT name, started_at FROM log_workout")).toEqual([{ name: "Push", started_at: null }, { name: "Push", started_at: null }]);
  });

  it("keeps the name after the template is renamed or deleted", async () => {
    const db = await withWorkout();
    await loadWorkout(db, DAY, 1);
    await db.run("DELETE FROM workout WHERE id = 1");
    expect(await db.all("SELECT name, workout_id FROM log_workout")).toEqual([{ name: "Push", workout_id: null }]);
  });

  it("removes a workout once its last exercise is deleted, and on clear day", async () => {
    const db = await withWorkout();
    await loadWorkout(db, DAY, 1);
    await deleteLogEntry(db, 1);
    expect((await db.all("SELECT COUNT(*) AS n FROM log_workout"))[0].n).toBe(1);
    await deleteLogEntry(db, 2);
    expect((await db.all("SELECT COUNT(*) AS n FROM log_workout"))[0].n).toBe(0);
    await loadWorkout(db, DAY, 1);
    await clearDay(db, DAY);
    expect((await db.all("SELECT COUNT(*) AS n FROM log_workout"))[0].n).toBe(0);
  });

  it("groups an older backup's history on import", async () => {
    const db = await withWorkout();
    await importBackup(db, {
      format: "fitapp-backup", version: 1, schema: 3, exported_at: "x",
      tables: {
        exercise: [{ id: 1, name: "Bench", tracks_weight: 1, tracks_reps: 1, tracks_time: 0, tracks_distance: 0, created_at: "x", note: null }],
        workout: [{ id: 1, name: "Push", created_at: "x" }],
        log_exercise: [{ id: 1, date: DAY, position: 1, exercise_id: 1, workout_id: 1, superset_group: null, note: null }],
      },
    });
    expect(await db.all("SELECT lx.log_workout_id AS w, lw.name FROM log_exercise lx JOIN log_workout lw ON lw.id = lx.log_workout_id"))
      .toEqual([{ w: 1, name: "Push" }]);
  });
});

describe("workout times, delete, dragging and wrapping", () => {
  const T = (hhmm: string) => new Date(`${DAY}T${hhmm}:00Z`);
  const ts = (hhmm: string) => `${DAY} ${hhmm}:00.000000`;

  // Workout "Push" (Bench, Row; 2 sets each) loaded `loads` times on DAY.
  async function day2(loads = 2) {
    const db = await openTestDb();
    await migrate(db);
    await db.exec(`
      INSERT INTO exercise (id, name, tracks_weight, tracks_reps, created_at) VALUES (1, 'Bench', 1, 1, 'x'), (2, 'Row', 1, 1, 'x'), (3, 'Curl', 1, 1, 'x');
      INSERT INTO workout (id, name, created_at) VALUES (1, 'Push', 'x');
      INSERT INTO workout_exercise (id, workout_id, exercise_id, position) VALUES (1, 1, 1, 1), (2, 1, 2, 2);
      INSERT INTO workout_set (workout_exercise_id, position) VALUES (1, 1), (1, 2), (2, 1), (2, 2);
    `);
    for (let i = 0; i < loads; i++) await loadWorkout(db, DAY, 1);
    return db;
  }
  const check = (db: Awaited<ReturnType<typeof day2>>, setId: number, hhmm: string, weight = 100, reps = 5) =>
    db.run("UPDATE log_set SET completed_at = ?, weight = ?, reps = ? WHERE id = ?", [ts(hhmm), weight, reps, setId]);
  const times = async (db: Awaited<ReturnType<typeof day2>>) =>
    (await db.all("SELECT started_at AS s, ended_at AS e FROM log_workout ORDER BY id")).map((r) => [r.s?.slice(11, 16) ?? null, r.e?.slice(11, 16) ?? null]);

  it("starts on the first ✓, keeps finished times on later ✓s, and volume counts weight × reps", async () => {
    const db = await day2(1);
    await check(db, 1, "10:00");
    expect(await noteCheckOff(db, 1, 90)).toBe(true);
    await check(db, 2, "10:05");
    expect(await noteCheckOff(db, 1, 90)).toBe(false);
    await finishDayWorkout(db, 1, T("10:30"));
    await check(db, 3, "11:00");
    expect(await noteCheckOff(db, 2, 90)).toBe(false);
    expect(await times(db)).toEqual([["10:00", "10:30"]]);
    expect((await getDayWorkout(db, 1)).volume).toBe(1500);
  });

  it("starting another workout finishes the one in progress at its last ✓ plus rest; no ✓ means no times", async () => {
    const db = await day2(3);
    await check(db, 1, "10:00");
    await noteCheckOff(db, 1, 0);
    await check(db, 2, "10:20");
    await startDayWorkout(db, 2, T("10:40"), 90);
    expect(await times(db)).toEqual([["10:00", "10:21"], ["10:40", null], [null, null]]);
    await startDayWorkout(db, 3, T("11:00"), 90); // workout 2 had no ✓
    expect(await times(db)).toEqual([["10:00", "10:21"], [null, null], ["11:00", null]]);
    await resumeDayWorkout(db, 1, 90); // and workout 3, never checked, goes back to unstarted
    expect(await times(db)).toEqual([["10:00", null], [null, null], [null, null]]);
  });

  it("finishes stale workouts after an hour, and a single ✓ with no rest is a zero span: no times", async () => {
    const db = await day2(1);
    await check(db, 1, "10:00");
    await noteCheckOff(db, 1, 0);
    await finishStaleWorkouts(db, T("10:59"), 0);
    expect(await times(db)).toEqual([["10:00", null]]);
    await finishStaleWorkouts(db, T("11:01"), 0);
    expect(await times(db)).toEqual([[null, null]]);
  });

  it("finishes at the last set's ✓, warmups included; not before, not once finished, and a zero span has no times", async () => {
    const db = await day2(1);
    await db.run("UPDATE log_set SET is_warmup = 1 WHERE id = 1");
    for (const [id, hhmm] of [[2, "10:00"], [3, "10:10"], [4, "10:20"]] as const) {
      await check(db, id, hhmm);
      await noteCheckOff(db, id < 3 ? 1 : 2, 90);
      expect(await finishIfDone(db, 1)).toBe(false); // the warmup is still open
    }
    await check(db, 1, "10:30");
    expect(await finishIfDone(db, 1)).toBe(true);
    expect(await times(db)).toEqual([["10:00", "10:30"]]);
    expect(await finishIfDone(db, 1)).toBe(false); // already finished
    await resumeDayWorkout(db, 1, 90);
    expect(await finishIfDone(db, 1)).toBe(true); // resumed with every set done: the last ✓ again
    expect(await times(db)).toEqual([["10:00", "10:30"]]);

    const one = await day2(1);
    await one.run("DELETE FROM log_set WHERE id != 1");
    await check(one, 1, "10:00");
    await noteCheckOff(one, 1, 90);
    expect(await finishIfDone(one, 1)).toBe(true);
    expect(await times(one)).toEqual([[null, null]]);
  });

  it("validates hand-edited times", async () => {
    const db = await day2(1);
    await expect(setDayWorkoutTimes(db, 1, null, ts("10:00"), DAY, 90)).rejects.toThrow(/start time/);
    await expect(setDayWorkoutTimes(db, 1, ts("10:00"), ts("10:00"), DAY, 90)).rejects.toThrow(/after the start/);
    await expect(setDayWorkoutTimes(db, 1, ts("10:00"), null, "2026-10-02", 90)).rejects.toThrow(/finish time/);
    await setDayWorkoutTimes(db, 1, ts("10:00"), null, DAY, 90);
    expect(await times(db)).toEqual([["10:00", null]]);
  });

  it("+ exercises join the workout in progress, else the latest unfinished, else none", async () => {
    const db = await day2(2);
    await addExercises(db, DAY, [3], false, true); // nothing started: the latest unfinished (2)
    await startDayWorkout(db, 1, T("10:00"), 0);
    await addExercises(db, DAY, [3], false, true); // in progress: 1, placed at the end of its block
    const rows = await db.all("SELECT exercise_id AS x, log_workout_id AS w FROM log_exercise ORDER BY position");
    expect(rows.map((r) => [r.x, r.w])).toEqual([[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2]]);
    await setDayWorkoutTimes(db, 1, ts("10:00"), ts("10:30"), DAY, 0);
    await setDayWorkoutTimes(db, 2, ts("10:40"), ts("11:00"), DAY, 0);
    await addExercises(db, DAY, [3], false, true);
    expect((await db.all("SELECT log_workout_id AS w FROM log_exercise ORDER BY position DESC LIMIT 1"))[0].w).toBeNull();
  });

  it("deleting a workout keeps checked-off sets as exercises outside any workout", async () => {
    const db = await day2(1);
    await check(db, 2, "10:00"); // Bench set 2
    expect(await deleteDayWorkout(db, 1)).toBe("Push");
    expect(await db.all("SELECT exercise_id AS x, log_workout_id AS w FROM log_exercise")).toEqual([{ x: 1, w: null }]);
    expect(await db.all("SELECT position FROM log_set")).toEqual([{ position: 1 }]);
    expect((await db.all("SELECT COUNT(*) AS n FROM log_workout"))[0].n).toBe(0);
  });

  it("arranges the day: moves between workouts, refuses split workouts, and drops emptied ones", async () => {
    const db = await day2(2); // entries 1,2 in workout 1; 3,4 in workout 2
    await expect(arrangeDay(db, DAY, [{ id: 1, w: 1 }, { id: 3, w: 2 }, { id: 2, w: 1 }, { id: 4, w: 2 }])).rejects.toThrow(/stay together/);
    await arrangeDay(db, DAY, [{ id: 3, w: 2 }, { id: 4, w: 2 }, { id: 1, w: 2 }, { id: 2, w: null }]);
    const rows = await db.all("SELECT id, log_workout_id AS w FROM log_exercise ORDER BY position");
    expect(rows.map((r) => [r.id, r.w])).toEqual([[3, 2], [4, 2], [1, 2], [2, null]]);
    expect((await db.all("SELECT id FROM log_workout")).map((r) => r.id)).toEqual([2]);
  });

  it("wraps entries into a new workout, together and timed from today's check-offs", async () => {
    const db = await day2(1);
    await addExercises(db, DAY, [3]); // entry 3, outside
    await check(db, 1, "10:00");
    await check(db, 5, "10:20");
    await db.run("INSERT INTO workout (id, name, created_at) VALUES (2, 'Mine', 'x')");
    await wrapIntoDayWorkout(db, DAY, 2, "Mine", [1, 3], DAY, T("12:00"), 60);
    const rows = await db.all("SELECT id, log_workout_id AS w FROM log_exercise ORDER BY position");
    expect(rows.map((r) => [r.id, r.w])).toEqual([[1, 2], [3, 2], [2, 1]]);
    expect(await db.all("SELECT name, started_at, ended_at FROM log_workout WHERE id = 2"))
      .toEqual([{ name: "Mine", started_at: ts("10:00"), ended_at: ts("10:21") }]);
  });
});

describe("routine rotation and autoregulation read workouts on a day", () => {
  it("uses the later of two loads of a workout on one day as the reference", async () => {
    const db = await openTestDb();
    await migrate(db);
    await db.exec(`
      INSERT INTO exercise (id, name, tracks_weight, tracks_reps, created_at) VALUES (1, 'Bench', 1, 1, 'x');
      INSERT INTO workout (id, name, created_at) VALUES (1, 'Push', 'x');
      INSERT INTO workout_exercise (id, workout_id, exercise_id, position) VALUES (1, 1, 1, 1);
      INSERT INTO workout_set (workout_exercise_id, position, reps_min, reps_max) VALUES (1, 1, 5, 10);
    `);
    await loadWorkout(db, DAY, 1);
    await loadWorkout(db, DAY, 1);
    await db.run("UPDATE log_set SET completed_at = 'x', weight = 100, reps = 6 WHERE log_exercise_id = 1");
    await db.run("UPDATE log_set SET completed_at = 'x', weight = 200, reps = 6 WHERE log_exercise_id = 2");
    const [[targets]] = await autoregulatedTargets(db, "2026-10-02", 1, (await getWorkout(db, 1)).slots);
    expect(targets?.weight).toBe(200);
  });
});

it("refuses a superset across a workout's edge", async () => {
  const db = await openTestDb();
  await migrate(db);
  await db.exec(`
    INSERT INTO exercise (id, name, tracks_reps, created_at) VALUES (1, 'X', 1, 'x');
    INSERT INTO workout (id, name, created_at) VALUES (1, 'W', 'x');
    INSERT INTO workout_exercise (id, workout_id, exercise_id, position) VALUES (1, 1, 1, 1);
    INSERT INTO workout_set (workout_exercise_id, position) VALUES (1, 1);
  `);
  await loadWorkout(db, DAY, 1);
  await loadWorkout(db, DAY, 1);
  await expect(setSupersetWithNext(db, 1, true)).rejects.toThrow(/another workout/);
});
