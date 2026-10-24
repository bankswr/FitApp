# Bodyweight exercises
How exercises marked as bodyweight log added weight / assistance on top of a per-day bodyweight, and how that feeds totals, volume and autoregulation. Mobile app only (schema 6, `mobile/src/logic/bodyweight.ts`), not in Flask.

Last updated: 2026-10-24

## Rules (user requirement, 2026-10-23)
- **Exercise setting:** "Bodyweight exercise" switch on the exercise form (`exercise.uses_bodyweight`). It implies tracking weight: checking it checks Weight; unchecking Weight unchecks it; `saveExercise` adds weight to the modes if missing. Lists show a "Bodyweight" badge.
- **Added weight is one signed number** (user picked this over separate Weighted/Assisted modes): `log_set.weight` is the added weight, negative for assistance. Total = bodyweight + added; blank added counts as 0.
- **Bodyweight is one number per day** (`bodyweight` table, date PK, > 0, up to 1000 lb), entered in the day header beside Deload. A day without one uses the latest earlier entry (shown as the placeholder, with a "From <date>" hint); days before the first entry use the **earliest** entry (`bodyweightOn`). Blank removes the day's entry. Labelled lb (no kg option yet). Clear day removes the day's bodyweight too, like the deload mark (our call, by analogy; not ruled on by the user). No bodyweight chart or tracking: the user handles their bodyweight.
- **Old history keeps its volume (user):** each set records `log_set.uses_bodyweight`, set from the exercise when the set is created. Sets logged before an exercise was marked stay unflagged: their weight, history display and volume are exactly as before. Marking or unmarking an exercise only changes sets with **nothing recorded** (`UNRECORDED_SET_SQL`: not checked off, all fields blank); unmarking also clears negative targets on those sets.
- **Volume** (Progress, per-workout stats) uses the total for flagged sets (`SET_LOAD_SQL`), floored at 0; with no bodyweight recorded anywhere it uses the added weight alone.
- **Autoregulation** steps the added weight with no 0 floor (−40 → −35 → … → 0 → +5); a blank or old unflagged reference counts as 0 added (`nextTargets(..., bodyweight)`). Reaching the top of the range adds weight rather than holding at max reps (the hold rule now only applies to unmarked exercises). Changes in bodyweight are not compensated: added weight stays, the total moves.
- **Day card:** the weight column header is "± lb"; each flagged set's field is the added weight, with a ± button and the total ("= 140") beneath it, updated as you type; while blank it shows the target's total dimmed. With no bodyweight at all the total reads "BW" / "BW +10" and the card shows a link to the bodyweight field. Checking off a blank flagged set fills 0 when there's no target.
- **± button:** phone number pads (iOS especially) may have no minus key. It flips the typed value's sign, or starts an empty field with "-". `mousedown` is prevented so the field keeps focus and quick fill copies the flipped value to the other sets.
- **History:** "140 lb (−40) × 8", "180 lb (BW) × 10", or "BW −40 lb × 8" when no bodyweight is recorded. Workout summaries label planned weights "BW +10 lb".
- **Default exercises marked (user-approved list):** Pullup, Neutral Pullup, Chinup, Dips, Hyperextension (`DEFAULT_BODYWEIGHT_EXERCISES`). Machines that load the machine (Hack Squat, Leg Press, Calf Press, Glute Press) are not. Seeded marked on fresh installs; migration 6 and importing a pre-6 backup mark exact-name matches (and turn on their weight tracking).

- **Settings switch (2026-10-24):** Bodyweight can be hidden per device; everything above still applies to the data (see `feature-switches.md`).

## Storage
- Migration 6 rebuilds `log_set` (SQLite can't drop CHECKs) to remove the `weight >= 0` / `target_weight >= 0` checks and add `uses_bodyweight`. `workout_set.weight` keeps its check: the builder doesn't plan weight, so planned weights are never negative.
- `bodyweight` is in `TABLES`, so backups carry it.
