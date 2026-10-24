// The on-device schema, versioned with SQLite's PRAGMA user_version. Version 1 mirrors the
// Flask database at Alembic head 0005 column-for-column (so backups transfer one-to-one),
// plus what a fresh schema allows: ON DELETE CASCADE / SET NULL instead of Python-side
// cascades, and >= 0 checks on the target columns. Never edit a shipped migration; append.
import { markDefaultBodyweightExercises } from "../logic/bodyweight";
import { groupLogWorkouts } from "../logic/dayWorkouts";
import type { Db } from "./types";

/** SQL, or a function for migrations that also move data. */
export const MIGRATIONS: (string | ((db: Db) => Promise<void>))[] = [
  // 1: initial schema (Flask/Alembic 0005)
  `
  CREATE TABLE muscle_group (
    id INTEGER PRIMARY KEY,
    name VARCHAR(50) COLLATE NOCASE NOT NULL UNIQUE
  );
  CREATE TABLE exercise (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) COLLATE NOCASE NOT NULL UNIQUE,
    tracks_weight BOOLEAN NOT NULL DEFAULT 0,
    tracks_reps BOOLEAN NOT NULL DEFAULT 0,
    tracks_time BOOLEAN NOT NULL DEFAULT 0,
    tracks_distance BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    note TEXT
  );
  CREATE TABLE exercise_muscle (
    exercise_id INTEGER NOT NULL REFERENCES exercise (id) ON DELETE CASCADE,
    muscle_group_id INTEGER NOT NULL REFERENCES muscle_group (id),
    role VARCHAR(10) NOT NULL CHECK (role IN ('primary', 'ancillary')),
    PRIMARY KEY (exercise_id, muscle_group_id)
  );
  CREATE TABLE workout (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) COLLATE NOCASE NOT NULL UNIQUE,
    created_at DATETIME NOT NULL
  );
  CREATE TABLE workout_exercise (
    id INTEGER PRIMARY KEY,
    workout_id INTEGER NOT NULL REFERENCES workout (id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercise (id),
    position INTEGER NOT NULL,
    superset_group INTEGER,
    UNIQUE (workout_id, position)
  );
  CREATE TABLE workout_set (
    id INTEGER PRIMARY KEY,
    workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercise (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    reps_min INTEGER CHECK (reps_min IS NULL OR reps_min >= 1),
    reps_max INTEGER,
    is_amrap BOOLEAN NOT NULL DEFAULT 0,
    weight FLOAT CHECK (weight IS NULL OR weight >= 0),
    duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    distance FLOAT CHECK (distance IS NULL OR distance >= 0),
    UNIQUE (workout_exercise_id, position),
    CHECK (NOT is_amrap OR (reps_min IS NULL AND reps_max IS NULL)),
    CHECK (reps_min IS NULL OR reps_max IS NULL OR reps_min <= reps_max)
  );
  CREATE TABLE routine (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) COLLATE NOCASE NOT NULL UNIQUE,
    created_at DATETIME NOT NULL,
    cycle_days INTEGER NOT NULL DEFAULT 7
  );
  CREATE TABLE routine_workout (
    id INTEGER PRIMARY KEY,
    routine_id INTEGER NOT NULL REFERENCES routine (id) ON DELETE CASCADE,
    workout_id INTEGER NOT NULL REFERENCES workout (id),
    position INTEGER NOT NULL,
    UNIQUE (routine_id, position)
  );
  CREATE TABLE routine_muscle_target (
    routine_id INTEGER NOT NULL REFERENCES routine (id) ON DELETE CASCADE,
    muscle_group_id INTEGER NOT NULL REFERENCES muscle_group (id),
    sets FLOAT CHECK (sets IS NULL OR sets >= 0),
    PRIMARY KEY (routine_id, muscle_group_id)
  );
  CREATE TABLE target_preset (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) COLLATE NOCASE NOT NULL UNIQUE,
    created_at DATETIME NOT NULL
  );
  CREATE TABLE target_preset_value (
    preset_id INTEGER NOT NULL REFERENCES target_preset (id) ON DELETE CASCADE,
    muscle_group_id INTEGER NOT NULL REFERENCES muscle_group (id),
    sets FLOAT NOT NULL CHECK (sets >= 0),
    PRIMARY KEY (preset_id, muscle_group_id)
  );
  CREATE TABLE log_exercise (
    id INTEGER PRIMARY KEY,
    date DATE NOT NULL,
    position INTEGER NOT NULL,
    exercise_id INTEGER NOT NULL REFERENCES exercise (id),
    workout_id INTEGER REFERENCES workout (id) ON DELETE SET NULL,
    superset_group INTEGER,
    note TEXT,
    UNIQUE (date, position)
  );
  CREATE INDEX ix_log_exercise_date ON log_exercise (date);
  CREATE INDEX ix_log_exercise_exercise ON log_exercise (exercise_id);
  CREATE TABLE log_set (
    id INTEGER PRIMARY KEY,
    log_exercise_id INTEGER NOT NULL REFERENCES log_exercise (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    target_reps_min INTEGER,
    target_reps_max INTEGER,
    target_amrap BOOLEAN NOT NULL DEFAULT 0,
    target_weight FLOAT CHECK (target_weight IS NULL OR target_weight >= 0),
    target_duration_seconds INTEGER CHECK (target_duration_seconds IS NULL OR target_duration_seconds >= 0),
    target_distance FLOAT CHECK (target_distance IS NULL OR target_distance >= 0),
    weight FLOAT CHECK (weight IS NULL OR weight >= 0),
    reps INTEGER CHECK (reps IS NULL OR reps >= 0),
    duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    distance FLOAT CHECK (distance IS NULL OR distance >= 0),
    completed_at DATETIME,
    UNIQUE (log_exercise_id, position)
  );
  `,
  // 2: weekly sets-per-muscle targets on the Progress page (user, 2026-10-01). Not in Flask.
  `
  CREATE TABLE progress_target (
    muscle_group_id INTEGER PRIMARY KEY REFERENCES muscle_group (id),
    sets FLOAT NOT NULL CHECK (sets >= 0)
  );
  `,
  // 3: autoregulation (user, 2026-10-04). Not in Flask. A routine can autoregulate its workouts'
  // targets; log_set.target_reps is the single rep target it set; deload days are skipped as
  // references.
  `
  ALTER TABLE routine ADD COLUMN autoregulate BOOLEAN NOT NULL DEFAULT 0;
  ALTER TABLE log_set ADD COLUMN target_reps INTEGER CHECK (target_reps IS NULL OR target_reps >= 0);
  CREATE TABLE deload_day (
    date DATE PRIMARY KEY
  );
  `,
  // 4: workouts on the day screen (user, 2026-10-14; agent-notes/day-workouts.md). Not in Flask.
  // Each loaded workout is a log_workout with its own times; existing history is grouped into them.
  async (db) => {
    await db.exec(`
      CREATE TABLE log_workout (
        id INTEGER PRIMARY KEY,
        date DATE NOT NULL,
        workout_id INTEGER REFERENCES workout (id) ON DELETE SET NULL,
        name VARCHAR(100) NOT NULL,
        started_at DATETIME,
        ended_at DATETIME
      );
      CREATE INDEX ix_log_workout_date ON log_workout (date);
      ALTER TABLE log_exercise ADD COLUMN log_workout_id INTEGER REFERENCES log_workout (id) ON DELETE SET NULL;
    `);
    await groupLogWorkouts(db);
  },
  // 5: per-exercise autoregulation weight step (user, 2026-10-15; agent-notes/autoregulation.md).
  // Not in Flask. NULL uses the Settings default.
  `
  ALTER TABLE exercise ADD COLUMN weight_step FLOAT CHECK (weight_step IS NULL OR weight_step > 0);
  `,
  // 6: bodyweight exercises (user, 2026-10-23; agent-notes/bodyweight.md). Not in Flask. A marked
  // exercise logs added weight, negative for assistance, so log_set is rebuilt without the
  // weight >= 0 checks; each set records whether it counts bodyweight; one bodyweight per day.
  async (db) => {
    await db.exec(`
      ALTER TABLE exercise ADD COLUMN uses_bodyweight BOOLEAN NOT NULL DEFAULT 0;
      CREATE TABLE bodyweight (
        date DATE PRIMARY KEY,
        weight FLOAT NOT NULL CHECK (weight > 0)
      );
      CREATE TABLE log_set_new (
        id INTEGER PRIMARY KEY,
        log_exercise_id INTEGER NOT NULL REFERENCES log_exercise (id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        target_reps_min INTEGER,
        target_reps_max INTEGER,
        target_amrap BOOLEAN NOT NULL DEFAULT 0,
        target_weight FLOAT,
        target_duration_seconds INTEGER CHECK (target_duration_seconds IS NULL OR target_duration_seconds >= 0),
        target_distance FLOAT CHECK (target_distance IS NULL OR target_distance >= 0),
        weight FLOAT,
        reps INTEGER CHECK (reps IS NULL OR reps >= 0),
        duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
        distance FLOAT CHECK (distance IS NULL OR distance >= 0),
        completed_at DATETIME,
        target_reps INTEGER CHECK (target_reps IS NULL OR target_reps >= 0),
        uses_bodyweight BOOLEAN NOT NULL DEFAULT 0,
        UNIQUE (log_exercise_id, position)
      );
      INSERT INTO log_set_new (id, log_exercise_id, position, target_reps_min, target_reps_max, target_amrap, target_weight,
        target_duration_seconds, target_distance, weight, reps, duration_seconds, distance, completed_at, target_reps)
      SELECT id, log_exercise_id, position, target_reps_min, target_reps_max, target_amrap, target_weight,
        target_duration_seconds, target_distance, weight, reps, duration_seconds, distance, completed_at, target_reps FROM log_set;
      DROP TABLE log_set;
      ALTER TABLE log_set_new RENAME TO log_set;
    `);
    await markDefaultBodyweightExercises(db);
  },
  // 7: warmup sets (user, 2026-10-23; agent-notes/warmups.md). Not in Flask. Planned in workouts and
  // logged on days, always before the working sets; no volume, no autoregulation.
  `
  ALTER TABLE workout_set ADD COLUMN is_warmup BOOLEAN NOT NULL DEFAULT 0;
  ALTER TABLE log_set ADD COLUMN is_warmup BOOLEAN NOT NULL DEFAULT 0;
  `,
  // 8: workout ratings (user, 2026-10-24; agent-notes/ratings.md). Not in Flask. Recovery going into
  // a loaded workout and effort during it, each 0 (worst / easiest) to 1 (best / hardest), NULL unrated.
  `
  ALTER TABLE log_workout ADD COLUMN recovery FLOAT CHECK (recovery IS NULL OR (recovery >= 0 AND recovery <= 1));
  ALTER TABLE log_workout ADD COLUMN effort FLOAT CHECK (effort IS NULL OR (effort >= 0 AND effort <= 1));
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Brings the database up to SCHEMA_VERSION. Returns the version it started at. */
export async function migrate(db: Db): Promise<number> {
  const start = Number((await db.all("PRAGMA user_version"))[0].user_version);
  if (start > SCHEMA_VERSION) {
    throw new Error(`This database is from a newer version of FitApp (schema ${start}). Update the app.`);
  }
  for (let v = start; v < SCHEMA_VERSION; v++) {
    await db.transaction(async () => {
      const m = MIGRATIONS[v];
      if (typeof m === "string") await db.exec(m);
      else await m(db);
      await db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return start;
}

/** Tables in foreign-key order (parents first): the insert order for restoring a backup. */
export const TABLES = [
  "muscle_group", "exercise", "exercise_muscle", "workout", "workout_exercise", "workout_set",
  "routine", "routine_workout", "routine_muscle_target", "target_preset", "target_preset_value", "progress_target",
  "log_workout", "log_exercise", "log_set", "deload_day", "bodyweight",
] as const;
