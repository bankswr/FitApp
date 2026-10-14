# Workouts on the day screen
Each loaded workout on a day is its own unit (a `log_workout` row) with its own times, so volume and duration per workout can be tracked. Mobile app only (`mobile/`), not in Flask.

Last updated: 2026-10-14

## Status
Agreed with the user on 2026-10-14; steps 1–5 built and shipped the same day in v0.1.6:
1. Schema v4 (`log_workout`, `log_exercise.log_workout_id`), grouping existing history, backup import.
2. Day screen blocks: header (name · duration · volume), delete behaviour.
3. Timing: Start / Finish / Resume, automatic Finish, the times sheet; + exercises join the workout in progress.
4. Dragging whole workouts and single exercises across workout edges.
5. Routine next-workout and autoregulation read `log_workout`; "Build workout from day" wraps the day into one.
6. **Next task (user, 2026-10-14): workout tracking over time** — per-workout stats and history across days (duration, volume per session of a workout). Plan: put it in the workout builder menu (the workout's own screen), plus some access from the day view that isn't cluttered (the user wants the day screen kept lean). Details not yet agreed; ask the user before building.

**Header layout:** reviewed by the user on the phone (2026-10-14) and approved, with one change: the workout frame is a 2px `--blue` border so it stands out from the exercise cards.

## Rules (user decisions, 2026-10-14)
- **Times** are recorded only when the day is today; otherwise they stay NULL so they don't distort stats. **Any time the app can't truly know is NULL, never a guess or a zero-length span** (user, restated 2026-10-14). Start = the Start tap or the first ✓, whichever comes first. Finish = the Finish tap; if forgotten, it is set automatically to the last ✓ plus the device's rest-timer length (0 if none). The automatic Finish happens when another workout starts, or when the day screen opens and the last ✓ was more than ~60 minutes ago.
- Times can be edited by hand on any day (a sheet opened by tapping the block header, following the "tap opens the edit form" rule).
- **Checking off a set in a finished workout** leaves its times alone; a **Resume** button reopens it.
- **One workout in progress at a time:** loading a second one leaves it unstarted; starting it finishes the one in progress.
- **Exercises added with +** join the workout in progress; if none is in progress, the most recently loaded unfinished one; if every workout is finished (or there are none), they stay outside any workout. A day with no loaded workout gets no workout and no times (no "Freestyle" block).
- The same workout may be loaded more than once on a day; each load is its own `log_workout`.
- **Dragging:** whole blocks move as a unit; single exercises can be dragged into another block (they join it). Exercises outside any workout sit wherever they're dropped (between blocks, never splitting one). Supersets never cross block edges; moving a linked exercise across one unlinks it, as in the builder.
- **Deleting a block** (× in its header, via the shared confirmation panel): delete every set not checked off, then every exercise left with no sets; the remaining exercises stay on the day outside any workout.
- **Build workout from day** saves a template from *all* the day's exercises (the user removes extras in the builder). On save, the exercises still in the saved template are wrapped into one new `log_workout` for it, pulling them out of any workout they were in; exercises removed in the builder stay outside. Its times come from check-offs already made today (first ✓ = Start, automatic-Finish rule).
- **Superset button:** a workout's last card has no ↓ link, and `setSupersetWithNext` refuses a link across a workout edge.
- Clear day removes the day's workouts too. Deload days and calendar counts stay day-level.
- Routine next-workout and autoregulation will use sessions instead of `(date, workout_id)`; when the same workout was done twice on a day, the later one is the reference.

## Storage (schema v4)
- **`log_workout`**: `id`, `date`, `workout_id` (nullable, `ON DELETE SET NULL`), `name` (a copy of the workout's name at load time, so renaming or deleting the template doesn't change history), `started_at`, `ended_at` (UTC like `completed_at`, nullable).
- **`log_exercise.log_workout_id`** (nullable, `ON DELETE SET NULL`). `log_exercise.workout_id` is still written so the step-5 code paths keep working until they move over.
- Block order is the order of its exercises' positions; a workout's exercises stay contiguous (the grouping below and, from step 4, the reorder code keep this).
- A `log_workout` with no exercises left is deleted (`pruneLogWorkouts` in `logic/dayWorkouts.ts`), so removing a loaded workout's exercises still "un-uses" it.

## Grouping existing history (`groupLogWorkouts`)
Runs in migration 4 and after importing a backup older than schema 4 (including Flask's):
- One `log_workout` per `(date, workout_id)` with a non-NULL `workout_id`, named after the workout. Two loads of the same workout on one day can't be told apart in old data, so they become one.
- Times come from completed sets only: start = first ✓, end = last ✓ (no rest added: the rest-timer length is a device setting the database doesn't have). Times are kept only when the first ✓ falls on the logged day in local time and end > start; otherwise both are NULL (a day logged later, or a single check-off moment such as demo data).
- Positions on the day are renumbered so each workout's exercises are contiguous, placed where its first exercise was. A superset that would span a block edge is split there (a one-member group becomes NULL).
- `test/sqljs.ts` (`asFlaskRows`, `MOBILE_ONLY_TABLES`) ignores `log_workout` and `log_exercise.log_workout_id` when comparing with Flask data.

## Code map
- Logic: `mobile/src/logic/dayWorkouts.ts` (timing, `arrangeDay`, `deleteDayWorkout`, `joinDayWorkout`, `wrapIntoDayWorkout`, grouping). `addExercises(..., joinWorkout)` is opt-in (the day screen passes true) so the Flask-parity default is unchanged; the old `reorderDay` is kept for parity but the day screen uses `arrangeDay`.
- Day screen (`ui/views/day.ts`): `finishStaleWorkouts` runs on every open (all days). Header stats are text set in `mount` (`[data-wb-stats]`), not a lit part, so they can be updated after a ✓ without a re-render; a running workout's elapsed time ticks every 30 s. The first ✓ of an unstarted workout today re-renders the page (its header changes).
- Drag: two `longPressReorder` instances on `#log-list`, told apart by the new `canLift` option. Exercise mode moves among a flat list of headers, blocks and `.wb-end` markers (shown only while dragging); membership comes from the header above, none after an end. Workout mode lifts from the header. Both save with `arrangeDay`, then re-render. Checked in headless Chromium with a mouse (2026-10-14), not yet on a touchscreen.
- Builder: `Item.lx` / `EditItem.lx` carry each "Build workout from day" item's day entry through edits and a failed save; on save, `wrapIntoDayWorkout` wraps the entries still present. The wrapped workout is in progress if its last ✓ is under an hour old, else finished by the automatic rule.
- `routineNextIndex` / `autoregulatedTargets` read `log_workout`. Parity test step 57 is a recorded divergence (`DIVERGES` in `test/parity.test.ts`): the scenario loads Arms Day twice on one day, which Flask merges.
