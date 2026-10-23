# Warmup sets
Warmup sets planned in workouts and adjusted on the day: what they're excluded from and how day changes carry back to the plan. Mobile app only (schema 7), not in Flask.

Last updated: 2026-10-23

## Rules (user requirement, 2026-10-23)
- **Storage:** `workout_set.is_warmup` and `log_set.is_warmup` (schema 7). Warmups always come **first** in an exercise's sets (`parseWorkoutItems` sorts them first; day inserts renumber positions). Never AMRAP.
- **Shown as** W1, W2… then working sets 1, 2… (day card, builder, history). `workingSets` / `warmupSets` in `logic/workouts.ts`.
- **Excluded from:** volume (Progress, per-workout stats), completed-set and per-muscle counts (Progress, Volume Planning), set totals on workouts/routines/builder, autoregulation (never adjusted, never a reference; working sets match by position **among working sets**, so warmup counts can differ between sessions), and the rest timer (`restAfterSets`; superset rounds count working sets only).
- **Builder:** "+ Warmup" adds a warmup row (copying the last warmup's targets) in its own section above the working sets, with **weight** (user: for incremental loading; working sets still plan no weight) and reps min–max. Quick fill keeps warmup and working columns apart (`fillKey`). An exercise needs at least one working set.
- **Day card:** two steppers, [− Warmup +] on the left and [− Set +] on the right (user, 2026-10-23; the superset button wraps below on a phone). Warmup ± is `changeWarmups` in `logic/day.ts`. − removes the last warmup unless it's checked off. "+ Set" / "− Set" act on working sets only. Quick fill on the day also keeps the kinds apart.
- **Carry-back to the plan (user):** adding/removing a warmup on the day does the same to the workout the entry was loaded from (`log_exercise.workout_id`), so later loads have it. Only the **count** carries back: a new plan warmup copies the plan's last warmup targets (blank if none); numbers typed on the day stay on the day. The slot is found by exercise and order (the entry's nth copy of the exercise in its loaded workout → the plan's nth slot for it). Ad-hoc entries, deleted workouts, or a workout that no longer has the exercise: day only. A flash says when the workout changed too.
- **Bodyweight exercises:** warmups are plain weight sets (`uses_bodyweight` 0, no totals, no ±) (user: bodyweight doesn't matter for warmups).
- **Build workout from day** keeps warmups as warmups.
