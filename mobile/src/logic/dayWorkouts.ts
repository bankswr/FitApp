// Workouts on a day (log_workout): each loaded workout is its own unit with its own times, so
// volume and duration can be tracked per workout. Rules: agent-notes/day-workouts.md.
import { type Db, get, type Row, utcNow } from "../db/types";
import { ConflictError, NotFoundError } from "./errors";
import { ValidationError } from "./text";

// Times are UTC strings like completed_at ("YYYY-MM-DD HH:MM:SS.ffffff"). Anything the app can't
// truly know stays NULL (user): no guessed or zero-length spans.
export const parseUtc = (s: string) => new Date(`${s.replace(" ", "T").slice(0, 23)}Z`);
const STALE_MINUTES = 60; // an in-progress workout with no ✓ for this long is finished automatically

export interface DayWorkout {
  id: number;
  date: string;
  workout_id: number | null;
  name: string;
  started_at: string | null;
  ended_at: string | null;
  /** Weight × reps over completed sets with both, as on the Progress screen. */
  volume: number;
  last_check: string | null;
}

export const inProgress = (w: Pick<DayWorkout, "started_at" | "ended_at">) => w.started_at !== null && w.ended_at === null;

async function dayWorkoutsWhere(db: Db, where: string, params: unknown[]): Promise<DayWorkout[]> {
  return (await db.all(
    `SELECT lw.*, COALESCE(SUM(CASE WHEN ls.completed_at IS NOT NULL THEN ls.weight * ls.reps END), 0) AS volume,
       MAX(ls.completed_at) AS last_check
     FROM log_workout lw LEFT JOIN log_exercise lx ON lx.log_workout_id = lw.id LEFT JOIN log_set ls ON ls.log_exercise_id = lx.id
     WHERE ${where} GROUP BY lw.id ORDER BY lw.id`, params,
  )) as DayWorkout[];
}

/** A day's workouts with their volume and last check-off. */
export const listDayWorkouts = (db: Db, date: string) => dayWorkoutsWhere(db, "lw.date = ?", [date]);

export async function getDayWorkout(db: Db, id: number): Promise<DayWorkout> {
  const [w] = await dayWorkoutsWhere(db, "lw.id = ?", [id]);
  if (!w) throw new NotFoundError("That workout is no longer on this day.");
  return w;
}

async function setTimes(db: Db, id: number, start: string | null, end: string | null) {
  await db.run("UPDATE log_workout SET started_at = ?, ended_at = ? WHERE id = ?", [start, end, id]);
}

/**
 * The automatic Finish: the last ✓ plus the rest-timer length. With no ✓ it never really started,
 * and a span that isn't positive is unknown, so both times go back to NULL.
 */
async function autoFinish(db: Db, w: DayWorkout, restSeconds: number) {
  if (w.last_check === null || w.started_at === null) return setTimes(db, w.id, null, null);
  const end = new Date(parseUtc(w.last_check).getTime() + restSeconds * 1000);
  if (end <= parseUtc(w.started_at)) return setTimes(db, w.id, null, null);
  await setTimes(db, w.id, w.started_at, utcNow(end));
}

/** One workout in progress at a time: finishes every other one (on any day). */
async function finishOthers(db: Db, id: number, restSeconds: number) {
  for (const w of await dayWorkoutsWhere(db, "lw.started_at IS NOT NULL AND lw.ended_at IS NULL AND lw.id != ?", [id])) {
    await autoFinish(db, w, restSeconds);
  }
}

/** Finishes workouts left in progress with no ✓ (or Start) in the last hour. Run when the day screen opens. */
export async function finishStaleWorkouts(db: Db, now: Date, restSeconds: number): Promise<void> {
  const cutoff = now.getTime() - STALE_MINUTES * 60_000;
  await db.transaction(async () => {
    for (const w of await dayWorkoutsWhere(db, "lw.started_at IS NOT NULL AND lw.ended_at IS NULL", [])) {
      if (parseUtc(w.last_check ?? w.started_at!).getTime() < cutoff) await autoFinish(db, w, restSeconds);
    }
  });
}

export async function startDayWorkout(db: Db, id: number, now: Date, restSeconds: number): Promise<void> {
  const w = await getDayWorkout(db, id);
  if (w.started_at !== null) throw new ConflictError("That workout has already started.");
  await db.transaction(async () => {
    await setTimes(db, id, utcNow(now), null);
    await finishOthers(db, id, restSeconds);
  });
}

export async function finishDayWorkout(db: Db, id: number, now: Date): Promise<void> {
  const w = await getDayWorkout(db, id);
  if (!inProgress(w)) throw new ConflictError("That workout isn’t in progress.");
  if (now <= parseUtc(w.started_at!)) await setTimes(db, id, null, null);
  else await setTimes(db, id, w.started_at, utcNow(now));
}

export async function resumeDayWorkout(db: Db, id: number, restSeconds: number): Promise<void> {
  const w = await getDayWorkout(db, id);
  if (w.started_at === null || w.ended_at === null) throw new ConflictError("That workout isn’t finished.");
  await db.transaction(async () => {
    await setTimes(db, id, w.started_at, null);
    await finishOthers(db, id, restSeconds);
  });
}

/**
 * A set was checked off today: its workout starts (at its first ✓) if it hasn't, finishing any
 * other in progress. A finished workout keeps its times (Resume reopens it). Returns true if
 * any workout's times changed.
 */
export async function noteCheckOff(db: Db, entryId: number, restSeconds: number): Promise<boolean> {
  const row = await get(db, "SELECT log_workout_id AS id FROM log_exercise WHERE id = ?", [entryId]);
  if (!row || row.id === null) return false;
  const w = await getDayWorkout(db, row.id);
  if (w.started_at !== null || w.ended_at !== null) return false;
  const first = (await get(db,
    `SELECT MIN(ls.completed_at) AS t FROM log_set ls JOIN log_exercise lx ON lx.id = ls.log_exercise_id WHERE lx.log_workout_id = ?`,
    [w.id]))!.t;
  if (first === null) return false;
  await db.transaction(async () => {
    await setTimes(db, w.id, first, null);
    await finishOthers(db, w.id, restSeconds);
  });
  return true;
}

/**
 * Hand-edited times (any day). `end` without `start` isn't allowed and the span must be positive;
 * a start with no end (in progress) only on today. Both blank clears them.
 */
export async function setDayWorkoutTimes(db: Db, id: number, start: string | null, end: string | null, today: string, restSeconds: number): Promise<void> {
  const w = await getDayWorkout(db, id);
  if (end !== null && start === null) throw new ValidationError("Enter a start time too.");
  if (start !== null && end !== null && parseUtc(end) <= parseUtc(start)) throw new ValidationError("The finish has to be after the start.");
  if (start !== null && end === null && w.date !== today) throw new ValidationError("Enter a finish time too (only today’s workouts can be in progress).");
  await db.transaction(async () => {
    await setTimes(db, id, start, end);
    if (start !== null && end === null) await finishOthers(db, id, restSeconds);
  });
}

/**
 * Where exercises added with + go (user): the workout in progress; else the most recently loaded
 * one not finished; else none (outside any workout).
 */
export async function workoutForNewExercises(db: Db, date: string): Promise<number | null> {
  const rows = await db.all("SELECT id, started_at, ended_at FROM log_workout WHERE date = ? ORDER BY id DESC", [date]);
  const current = rows.find((r) => r.started_at !== null && r.ended_at === null) ?? rows.find((r) => r.ended_at === null);
  return current ? current.id : null;
}

/** Positions 1..n in the given order, parked on negatives first so (date, position) never collides. */
async function renumber(db: Db, ids: number[]) {
  for (const id of ids) await db.run("UPDATE log_exercise SET position = ? WHERE id = ?", [-id, id]);
  for (const [i, id] of ids.entries()) await db.run("UPDATE log_exercise SET position = ? WHERE id = ?", [i + 1, id]);
}

const dayRows = (db: Db, date: string) =>
  db.all("SELECT id, log_workout_id AS w, superset_group AS g FROM log_exercise WHERE date = ? ORDER BY position", [date]);

/** Puts new entries (already on the day) at the end of a workout's block and makes them members. */
export async function joinDayWorkout(db: Db, date: string, logWorkoutId: number, entryIds: number[]): Promise<void> {
  const rows = (await dayRows(db, date)).filter((r) => !entryIds.includes(r.id));
  const last = rows.map((r) => r.w).lastIndexOf(logWorkoutId);
  const ids = rows.map((r) => r.id);
  ids.splice(last + 1, 0, ...entryIds);
  await renumber(db, ids);
  await db.run(`UPDATE log_exercise SET log_workout_id = ? WHERE id IN (${entryIds.map(() => "?").join(",")})`, [logWorkoutId, ...entryIds]);
}

/**
 * Deleting a workout from a day (user): every set not checked off goes, then every exercise left
 * with no sets; the rest stay on the day outside any workout. Returns the workout's name.
 */
export async function deleteDayWorkout(db: Db, id: number): Promise<string> {
  const w = await getDayWorkout(db, id);
  await db.transaction(async () => {
    const entries = (await db.all("SELECT id FROM log_exercise WHERE log_workout_id = ?", [id])).map((r) => r.id as number);
    for (const entryId of entries) {
      await db.run("DELETE FROM log_set WHERE log_exercise_id = ? AND completed_at IS NULL", [entryId]);
      const kept = (await db.all("SELECT id FROM log_set WHERE log_exercise_id = ? ORDER BY position", [entryId])).map((r) => r.id as number);
      if (!kept.length) {
        await db.run("DELETE FROM log_exercise WHERE id = ?", [entryId]);
        continue;
      }
      // Sets match by position elsewhere (autoregulation), so close the gaps.
      for (const setId of kept) await db.run("UPDATE log_set SET position = ? WHERE id = ?", [-setId, setId]);
      for (const [i, setId] of kept.entries()) await db.run("UPDATE log_set SET position = ? WHERE id = ?", [i + 1, setId]);
    }
    await db.run("UPDATE log_exercise SET log_workout_id = NULL WHERE log_workout_id = ?", [id]);
    await db.run("DELETE FROM log_workout WHERE id = ?", [id]);
    await splitSupersetsAtEdges(db, w.date);
  });
  return w.name;
}

/** Supersets stay inside one block: a run that crosses a block edge is split there. */
async function splitSupersetsAtEdges(db: Db, date: string) {
  const rows = await dayRows(db, date);
  const seen = new Set<number>();
  let next = Math.max(0, ...rows.map((r) => r.g ?? 0)) + 1;
  for (let i = 0; i < rows.length;) {
    const g = rows[i].g;
    let j = i + 1;
    while (j < rows.length && g !== null && rows[j].g === g && rows[j].w === rows[i].w) j++;
    if (g !== null) {
      const value = j - i === 1 ? null : seen.has(g) ? next++ : g;
      seen.add(g);
      if (value !== g) for (const r of rows.slice(i, j)) await db.run("UPDATE log_exercise SET superset_group = ? WHERE id = ?", [value, r.id]);
    }
    i = j;
  }
}

/**
 * Drag result: every entry on the day in its new order, each with the workout it now belongs to
 * (null = outside any). Workouts must stay contiguous and supersets inside one block. A workout
 * left with no exercises is removed.
 */
export async function arrangeDay(db: Db, date: string, layout: unknown): Promise<void> {
  if (!Array.isArray(layout) || layout.some((x) => !x || !Number.isInteger(x.id) || !(x.w === null || Number.isInteger(x.w)))) {
    throw new ValidationError("Couldn’t read the new order.");
  }
  const items = layout as { id: number; w: number | null }[];
  const rows = await dayRows(db, date);
  const workouts = new Set((await db.all("SELECT id FROM log_workout WHERE date = ?", [date])).map((r) => r.id as number));
  const ids = items.map((x) => x.id);
  if (ids.length !== rows.length || new Set(ids).size !== ids.length || rows.some((r) => !ids.includes(r.id))) {
    throw new ConflictError("This day changed in the meantime. Reload and try again.");
  }
  if (items.some((x) => x.w !== null && !workouts.has(x.w))) throw new ConflictError("This day changed in the meantime. Reload and try again.");
  const seen = new Set<number>();
  for (const [i, x] of items.entries()) {
    if (x.w !== null && x.w !== items[i - 1]?.w) {
      if (seen.has(x.w)) throw new ValidationError("A workout’s exercises have to stay together.");
      seen.add(x.w);
    }
  }
  const group = new Map(rows.map((r) => [r.id, r.g as number | null]));
  const runs = new Set<number>();
  for (const [i, x] of items.entries()) {
    const g = group.get(x.id)!;
    if (g === null) continue;
    const prev = items[i - 1];
    const continues = prev && group.get(prev.id) === g;
    if (continues && prev.w !== x.w) throw new ValidationError("A superset can’t cross into another workout.");
    if (!continues && runs.has(g)) throw new ValidationError("A superset has to stay together.");
    runs.add(g);
  }
  await db.transaction(async () => {
    await renumber(db, ids);
    for (const x of items) await db.run("UPDATE log_exercise SET log_workout_id = ? WHERE id = ?", [x.w, x.id]);
    await pruneLogWorkouts(db, date);
  });
}

/**
 * "Build workout from day" saved (user): the entries kept in the new template become one new
 * workout on the day, pulled out of any they were in, together where the first of them was (in
 * day order). Times only on today: start = their first ✓; finished by the usual rule unless the
 * last ✓ is recent, in which case it's in progress.
 */
export async function wrapIntoDayWorkout(
  db: Db, date: string, workoutId: number, name: string, entryIds: number[], today: string, now: Date, restSeconds: number,
): Promise<void> {
  await db.transaction(async () => {
    const rows = await dayRows(db, date);
    const wrap = new Set(entryIds.filter((id) => rows.some((r) => r.id === id)));
    if (!wrap.size) return;
    const logWorkoutId = (await db.run("INSERT INTO log_workout (date, workout_id, name) VALUES (?, ?, ?)", [date, workoutId, name])).lastId;
    const members = rows.filter((r) => wrap.has(r.id)).map((r) => r.id);
    const order: number[] = [];
    for (const r of rows) {
      if (!wrap.has(r.id)) order.push(r.id);
      else if (r.id === members[0]) order.push(...members);
    }
    await renumber(db, order);
    await db.run(`UPDATE log_exercise SET log_workout_id = ? WHERE id IN (${members.map(() => "?").join(",")})`, [logWorkoutId, ...members]);
    await pruneLogWorkouts(db, date);
    await splitSupersetsAtEdges(db, date);
    if (date !== today) return;
    const w = await getDayWorkout(db, logWorkoutId);
    const first = (await get(db,
      `SELECT MIN(ls.completed_at) AS t FROM log_set ls JOIN log_exercise lx ON lx.id = ls.log_exercise_id WHERE lx.log_workout_id = ?`,
      [logWorkoutId]))!.t;
    if (first === null) return;
    const recent = now.getTime() - parseUtc(w.last_check!).getTime() < STALE_MINUTES * 60_000;
    if (recent) {
      await setTimes(db, logWorkoutId, first, null);
      await finishOthers(db, logWorkoutId, restSeconds);
    } else {
      await autoFinish(db, { ...w, started_at: first }, restSeconds);
    }
  });
}

/** Deletes a day's workouts that have no exercises left (so removing them "un-uses" the workout). */
export async function pruneLogWorkouts(db: Db, date: string): Promise<void> {
  await db.run(
    `DELETE FROM log_workout WHERE date = ? AND id NOT IN
       (SELECT log_workout_id FROM log_exercise WHERE date = ? AND log_workout_id IS NOT NULL)`,
    [date, date],
  );
}

/**
 * Groups history logged before log_workout existed (migration 4, and backups older than schema 4):
 * one log_workout per (date, workout_id), with times from its completed sets when the first ✓ fell
 * on the logged day (local time) and the span isn't zero. Each workout's exercises are made contiguous where its first one
 * was, and supersets are split at block edges. Callers run it inside a transaction.
 */
export async function groupLogWorkouts(db: Db): Promise<void> {
  const rows = await db.all(
    `SELECT lx.id, lx.date, lx.position, lx.workout_id, lx.superset_group, w.name
     FROM log_exercise lx LEFT JOIN workout w ON w.id = lx.workout_id
     WHERE lx.log_workout_id IS NULL ORDER BY lx.date, lx.position`,
  );
  const byDate = new Map<string, Row[]>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);

  for (const [date, dayRows] of byDate) {
    // Each workout's rows, emitted together where the first one was.
    const members = new Map<number, Row[]>();
    for (const r of dayRows) if (r.workout_id !== null) members.set(r.workout_id, [...(members.get(r.workout_id) ?? []), r]);
    if (!members.size) continue;
    const order: Row[] = [];
    for (const r of dayRows) {
      if (r.workout_id === null) order.push(r);
      else if (members.get(r.workout_id)![0] === r) order.push(...members.get(r.workout_id)!);
    }

    for (const [workoutId, group] of members) {
      const ids = group.map((r) => r.id);
      const t = (await db.all(
        `SELECT MIN(completed_at) AS start, MAX(completed_at) AS end, date(MIN(completed_at), 'localtime') AS day
         FROM log_set WHERE log_exercise_id IN (${ids.map(() => "?").join(",")})`, ids,
      ))[0];
      // A zero-length span (one check-off moment) has no real duration: NULL, like unknown times.
      const timed = t.start !== null && t.day === date && t.end > t.start;
      const logWorkoutId = (await db.run(
        "INSERT INTO log_workout (date, workout_id, name, started_at, ended_at) VALUES (?, ?, ?, ?, ?)",
        [date, workoutId, group[0].name, timed ? t.start : null, timed ? t.end : null],
      )).lastId;
      await db.run(`UPDATE log_exercise SET log_workout_id = ? WHERE id IN (${ids.map(() => "?").join(",")})`, [logWorkoutId, ...ids]);
    }

    // Reuse the day's position numbers in the new order (unchanged when nothing was interleaved),
    // parking on negatives first so the (date, position) key never collides.
    if (order.some((r, i) => r !== dayRows[i])) {
      for (const r of dayRows) await db.run("UPDATE log_exercise SET position = ? WHERE id = ?", [-r.id, r.id]);
      for (const [i, r] of order.entries()) await db.run("UPDATE log_exercise SET position = ? WHERE id = ?", [dayRows[i].position, r.id]);
    }

    // A superset is a run of neighbours sharing a group in the same block (a workout, or outside one).
    // A group seen again after its first run gets a new number; a run of one isn't a superset.
    const seen = new Set<number>();
    let next = Math.max(0, ...dayRows.map((r) => r.superset_group ?? 0)) + 1;
    for (let i = 0; i < order.length;) {
      const g = order[i].superset_group;
      let j = i + 1;
      while (j < order.length && g !== null && order[j].superset_group === g && order[j].workout_id === order[i].workout_id) j++;
      if (g !== null) {
        const run = order.slice(i, j);
        const value = j - i === 1 ? null : seen.has(g) ? next++ : g;
        seen.add(g);
        if (value !== g) {
          for (const r of run) await db.run("UPDATE log_exercise SET superset_group = ? WHERE id = ?", [value, r.id]);
        }
      }
      i = j;
    }
  }
}
