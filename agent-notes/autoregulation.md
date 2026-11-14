# Autoregulation
How autoregulation sets rep and weight targets from the previous session, and how deload days fit in. Mobile app only (`mobile/src/logic/autoregulation.ts`), not in Flask.

Last updated: 2026-11-14

## Rules (user requirement, 2026-10-04)
- **One switch in Settings (user requirement, 2026-10-10):** **Autoregulation** on the Settings screen, per device (`fitapp.autoregulate` in localStorage via `ui/prefs.ts`, off by default). The day view passes it to `loadRoutine` / `loadWorkout` / `addExercises` as an `autoregulate` argument (default false, so the logic stays Flask-parity when off). It's the master switch: off, nothing autoregulates, whatever the per-item switches say, and working sets load the plan's targets (Flask parity).
- **Per-item switches (user requirement, 2026-11-14; schema 9):** an **Autoregulate** switch on the exercise form, workout builder and routine editor (`exercise.autoregulate`, `workout.autoregulate`, `routine.autoregulate`), on by default, always shown (even with Settings off, so they can be set up ahead). **Any switch off wins:** an exercise off never autoregulates (routine, workout or added on its own); a workout off doesn't when it's loaded (directly or from a routine), but its exercises still do elsewhere; a routine off doesn't when its workouts are loaded from it, but the same workout loaded from the Workouts tab follows its own switch. `sessionTargets(..., allowed)` takes workout && routine; the exercise's switch is checked per slot.
  - **Off means last time's numbers, unchanged** (user chose this over plan targets, so there's something to adjust): `carriedSet`: checked off with reps → the logged reps/weight; otherwise last time's targets carry forward. Same reference session as autoregulation. Only applies while the Settings switch is on.
  - **The AR button still works** on anything switched off (user): it's a deliberate manual action.
  - `routine.autoregulate` (schema 3) was reused: it had been unread since 2026-10-10 and its column **default is 0**, so schema 9 set every routine to 1, backup import of schema < 9 does the same, and every insert must set it explicitly.
- What it does depends on how things are added to a day:
  - **Routine** (including the ↻ override) and **workout** (Workouts tab): the workout's own latest non-deload session, whatever its source (see below). Same rule for both.
  - **Exercises** added on their own: each exercise's own last session, the same as the AR button (below).
- For each set, using the same set position last time: actual reps `r`, weight `w` (actual, else that set's target weight, else the plan's), previous rep target `t` (`log_set.target_reps`, else the range minimum). The range is the plan's, and a blank end defaults to **8–15** (`repRange`).
  1. `r < min` → weight `w − step` (never below 0), reps `min`.
  2. Otherwise next = `r + 1` if `r ≥ t` (actual + 1, user-confirmed), else `r`.
  3. next `> max` → weight `w + step`, reps `min`.
- **Weight step (user requirement, 2026-10-15):** `step` is the exercise's own `exercise.weight_step` if set, else the device's Settings default (`fitapp.weightStep` via `ui/prefs.ts`, 5 lb when unset). The day view passes the default in through `autoregulation()` (`Autoregulate = boolean | { weightStep }`; plain `true` means 5 lb) and to `autoregulateEntry`. Both the exercise form (shown only when the exercise tracks weight; blank = default) and Settings use one field, `ui/weightStep.ts`: typed value plus −/+ buttons that move along `WEIGHT_STEPS` [1.25, 2.5, 5, 10, 25, 45] to the nearest ladder value that way, starting from the placeholder when blank. Typed values: above 0 and up to 1000, rounded to 2 decimals. Turning weight tracking off clears the exercise's step.
- **Partial reps (user requirement, 2026-11-14):** logged reps take any number of decimals (`LOG_FIELDS.reps` with `exact`, no rounding; decimal keyboard on the day view). Not in Flask: the parity test records scenario step 40 (`5.5` reps) as a divergence and undoes it so later steps still match. **Targets stay whole numbers:** a partial rep counts as not done, so autoregulation, warmup carry-over and switched-off carry-over all use `wholeReps` (floor: 7.5 → 7). Plan rep ranges stay whole numbers.
- A set not checked off, or checked with no reps, **copies the previous targets** (`target_reps`, `target_weight`). Typed-but-unchecked values don't count; the user reconfirmed this on 2026-10-04 after test days with only typed values produced blank targets.
- **AMRAP sets (user, 2026-10-04):** reps follow the same rule with no range (`r + 1` if `r ≥ t`, else `r`; first time `t = r`), and the weight is carried over as `w`, **never adjusted**: changing it is left to the user. No step down when reps drop.
- **Warmup sets** are never adjusted or used as a reference; sets match by position among working sets only. Warmups instead carry over unchanged from the same reference session, whether or not the switch is on (`sessionTargets`; see `warmups.md`).
- Not adjusted (plan targets kept): exercises that don't track reps, and sets with no matching set last time (e.g. a set added to the plan).
- Unmarked exercises with no weight (none logged or targeted, or weight not tracked): reps only, held at the range maximum instead of adding weight. The user didn't rule on this case explicitly. Exercises marked **Bodyweight** step their added weight instead, below 0 for assistance (see `bodyweight.md`).

## AR button on day cards (user requirement, 2026-10-10)
- Each day card for an exercise that tracks reps has an **AR** button: since 2026-10-15 in the card's swipe tray, a dial icon since 2026-10-18 (the wrench there now edits the exercise) (see `stack-decisions.md`). It sets that entry's targets by the rules above (`autoregulateEntry` in `logic/day.ts`), from the **exercise's** latest non-deload entry before that day, from any source (ad hoc or a workout; the workout doesn't matter). Sets match by position.
- It sets **targets only** (`target_reps`, `target_weight`, shown as placeholders), never logged values; the user chose this over filling the fields.
- **Completed sets are skipped, and so is each target whose field already has a value** (user requirement): a typed weight keeps that set's weight target, but its reps target still updates.
- The range is the set's own target range, 8–15 when it has none (an ad-hoc exercise). Sets past the reference's count keep their targets. No earlier entry → nothing changes and a toast says so. Works on any day, whether or not the Settings switch is on, and **replaces** existing targets (e.g. ones a workout's autoregulation set) with the exercise-based ones (user requirement).

## Checking off a blank set (user requirement, 2026-10-13)
- ✓ on a set fills each **empty** field with the number its placeholder shows, before saving (`targetValues` / `setTargetValues` in `logic/day.ts`, called from the day view's check handler). Typed values win. Reps fill only when the placeholder (`target_label`) is a plain number: `target_reps` (autoregulated AMRAP sets included) or a fixed range like 5–5; "8–12", "8+" or a plain "AMRAP" fill nothing. Weight, time and distance targets fill as they are. Applies to every set, autoregulated or not. Done in the UI, so `updateSet` stays Flask-parity.

## Which session is the reference
- The workout's latest **non-deload** session before the load date, from **any source**: a `log_workout` row (schema 4, see `day-workouts.md`; before that, `log_exercise.workout_id` by date). When it was done twice on one day, the later one.
- No such date → the first use; the plan is loaded unchanged, even if the exercises have history elsewhere.
- Exercises are matched to the plan's slots **by exercise, in order** (the first copy of an exercise matches the first copy), so rearranging the workout still lines up. Duplicate exercises in one workout are rare (user).
- A slot whose exercise wasn't in that session (a **replaced** exercise) falls back to that exercise's latest earlier non-deload entry from any source (user requirement). No history → plan targets.

## Storage (schema v3; v5 adds `exercise.weight_step`, nullable FLOAT > 0)
- `routine.autoregulate` (bool, column default 0 but always written; read again since schema 9, see above), `log_set.target_reps` (the single rep target; NULL when not autoregulated), and `deload_day (date PK)`.
- The reps placeholder shows `target_reps` when set (`target_label`), and the card's Reps label shows each distinct range of its autoregulated sets beneath it, in set order (e.g. `8–12 · AMRAP`). "+ Set" copies `target_reps` like the other targets.

## Deload days (user requirement)
- The **Deload day** toggle under the day header writes/removes a `deload_day` row (`setDeload`). Autoregulation skips those dates as references and uses the previous non-deload session instead. It doesn't change the routine's rotation (`routineNextIndex`) or anything else. **Clear day also removes the deload mark** (user, 2026-10-04). The button can be hidden in Settings; marks still count (`feature-switches.md`).
