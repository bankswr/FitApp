# Workout ratings
Recovery going into each loaded workout and effort during it, entered by faces, stars or a slider, all stored 0–1, and charted on Progress. Mobile app only (schema 8, `mobile/src/logic/ratings.ts`), not in Flask.

Last updated: 2026-10-24

## Rules (user requirement, 2026-10-24)
- **What's rated:** each `log_workout` (each load of a workout on a day) has `recovery` and `effort`, FLOAT 0–1 or NULL (unrated). Exercises outside any workout have nothing to rate.
- **Scale:** 1 = fully recovered / **maximum effort** (user: "assume user wants to do well"), so 🙂 is the top of both. Faces 😞 😐 🙂 = 0 / 0.5 / 1; stars 1–5 = (stars − 1) ÷ 4; slider = position, rounded to 0.01 (`roundRating`).
- **Method** is a Settings choice (`fitapp.ratingMethod`, default faces), one for both ratings. A value saved with another method shows at the nearest face / star (`nearestFace`, `nearestStars`; ties round up) without changing the stored number until a new pick.
- **Entry (user picked the recommendation):** on **today** only, the block header shows Recovery until the workout starts and Effort once it's finished (nothing while in progress). On **any day**, both are in the times sheet (tap the workout's name). Ratings save on tap / slider release (`mountRatings` in `ui/rating.ts`); tapping the selected face or star again clears it; the slider has Clear. An unrated slider sits dimmed in the middle, and a tap that doesn't move it rates 0.5.
- **Progress (user requirement):** "Workout ratings" card, **one chart with both series** (user picked this over a toggle or two charts): a line through each day's average, each workout's value as a dot on top, y-axis 😞 😐 🙂. Same day axis as the volume chart; days with no rating are skipped (lines join across them). Follows the date range and the routine/workout filter (by `log_workout.workout_id`). Table view lists averages with the individual values. Colours: dataviz reference slots 1–2, dark steps (blue `#3987e5` recovery, orange `#d95926` effort), validated against the card surface.
- **Switch:** Settings › Workout ratings (`featureOn("ratings")`, on by default like every feature switch). Off hides entry and the chart; the data stays (see `feature-switches.md`).

## Storage
- Migration 8 adds the two columns with `CHECK (x IS NULL OR (x >= 0 AND x <= 1))`. Backups carry them; older backups need nothing. `log_workout` is in `MOBILE_ONLY_TABLES`, so the Flask parity comparison ignores it.
- Not covered by `scripts/demo_data.py` (Flask-only, like every mobile-only feature).
