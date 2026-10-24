# Feature switches
Per-device Settings switches that hide advanced features: rest timer, deload days, bodyweight exercises, and workout ratings. Mobile app only (`featureOn` / `setFeature` in `mobile/src/ui/prefs.ts`).

Last updated: 2026-10-24

## Rules (user requirement, 2026-10-24)
- **All on by default** (user picked "everything on"), stored in localStorage (`fitapp.restTimerShown`, `fitapp.deload`, `fitapp.bodyweight`, `fitapp.ratings`; anything but "off" is on).
- **A switch only hides; every calculation runs on the data as stored (user).** Existing deload marks still make autoregulation skip those days; sets flagged `uses_bodyweight` still count bodyweight in volume, autoregulation and history; ratings stay in the database.
- **Placement (user):** the rest-timer switch is on the existing Rest timer card (the other timer settings collapse under it); Deload days and Bodyweight exercises each have their own card with an explanation; ratings have their own card with the method picker. Autoregulation keeps its own switch; warmups have none.
- **Rest timer off:** no timer button on the day view (`hiddenRestTimer`), nothing starts on ✓, and a running countdown and its notification are stopped (when switched off and when the day view opens). The automatic Finish still adds the saved rest length (`restSeconds`).
- **Deload off:** the Deload day button and its hint are hidden. Clear day still removes a mark (its confirmation still names it).
- **Bodyweight off:** hidden: the day's bodyweight field and "From" hint, the ± button and "= total" on flagged sets, the "enter your bodyweight" link, the exercise form switch, and the "Bodyweight" badges. **Kept (user):** the "± lb" column header on cards with flagged sets, so the field still reads as added weight. Marked exercises keep creating flagged sets. The form's switch is hidden, not removed, so saving keeps the flag. History text ("140 lb (−40) × 8") and workout summaries are unchanged.
- The deload/bodyweight row under the day header disappears when both are off.
