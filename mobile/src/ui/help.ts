// Every help line in the app (the muted `.hint` text under headings and fields), in one place so
// it's easy to edit and add to (user request, 2026-10-20). Grouped by screen.
//
// - Plain text is a string; text with markup (<strong>, <br>, &nbsp;) must be an html`` template,
//   as a string's markup would show literally.
// - Text with live values is a function of them.
// - workoutBuilder.* goes into string-built HTML (escaped there), so it must stay plain text.
// - Status messages (errors, "Showing the N most recent days", etc.) stay with their code.
import { html } from "lit-html";
import { DEFAULT_REP_RANGE } from "../logic/autoregulation";
import { formatNumber, MUSCLE_SET_WEIGHTS } from "../logic/text";

const range = `${DEFAULT_REP_RANGE.min}–${DEFAULT_REP_RANGE.max}`;

export const HELP = {
  day: {
    swipe: "Swipe an exercise left for history, notes, autoregulation and editing.",
    drag: "Long-press an exercise, or a workout’s name, to drag it.",
    routinePicker: "Tap a routine to preview its next workout. Tap ↻ to pick a different one.",
    exerciseNote: "Shown whenever you do this exercise.",
    sessionNote: (dayLabel: string) => `Only for ${dayLabel}. Kept in the exercise’s history.`,
    workoutTimes: "Blank means unknown and is left out of stats. A finish earlier than the start is the next day.",
    bodyweightFrom: (when: string) => `From ${when}. Enter today's if it changed.`,
    bodyweightMissing: "Enter your bodyweight at the top of the day to see totals.",
    ratings: "Ratings save as soon as you pick them. Tap the selected face or star again to clear it.",
  },

  routineEditor: {
    workouts: "In the order you do them. A workout can appear more than once. Long-press a workout to drag it into a new order.",
    /** The span is kept in step with the cycle-length field by routines.ts. */
    muscleSets: (cycleDays: number | string) => html`Weekly sets per muscle group: one pass through the routine, scaled by
      7&nbsp;÷&nbsp;<span data-cycle-echo>${cycleDays}</span> days. A primary muscle counts
      ${MUSCLE_SET_WEIGHTS.primary} per set; an ancillary muscle counts ${MUSCLE_SET_WEIGHTS.ancillary}.
      Enter the weekly minimum for each group (or apply a preset). Bars are scaled to the group with the
      most sets; the tick marks the minimum, and a bar is red until it reaches it.`,
    presetPicker: "Fills every group’s weekly minimum. Groups a preset leaves out get 0.",
  },

  presetForm: {
    values: "Leave a group blank for 0.",
  },

  workoutBuilder: {
    drag: "Long-press an exercise to drag it into a new order.",
    targets: "Targets are optional.",
    warmups: "Warmups come first. They don't count toward volume or set totals and aren't autoregulated.",
  },

  exerciseForm: {
    primary: "The main muscles this exercise targets.",
    ancillary: "Supporting muscles (optional).",
    tracking: "What you'll log for each set.",
    weightStep: (defaultStep: number) =>
      html`How much autoregulation moves this exercise's weight. Leave blank to use the Settings
        default (${formatNumber(defaultStep)}&nbsp;lb).`,
    bodyweight: `Log the weight you add (a belt or vest) or, as a negative number, the assistance (a machine or
      band). Each set's total is your bodyweight for that day plus that number, and autoregulation steps the added
      weight. Sets logged before you turn this on keep their weight and volume.`,
    note: "Shown every time you do this exercise, e.g. seat height or form cues (optional).",
  },

  progress: {
    range: "Only completed (✓) sets count, not warmups.",
    only: "Only sets logged in that workout (or the routine's workouts) on the day count.",
    volume: "Sum of weight × reps across completed sets, in lb. Bodyweight exercises count their total weight.",
    muscleSets: (nDays: number) => `Completed sets in this range: primary muscle ${MUSCLE_SET_WEIGHTS.primary} per set,
      ancillary ${MUSCLE_SET_WEIGHTS.ancillary}. Per week = total × 7 ÷ ${nDays} days. Enter a weekly minimum for
      each group (or load a preset). Bars are scaled to the group with the most sets; the tick marks the minimum,
      and a bar is red until it reaches it.`,
    ratings: "Each dot is one workout's rating; the line is the daily average. Days without a rating are skipped.",
    presetPicker: "Loading a preset replaces every group’s weekly minimum. Groups it leaves out get 0.",
  },

  settings: {
    restTimerShown: `Turn off to hide the timer button; it then never starts on its own. Its length still counts
      when a forgotten workout is finished automatically (the last ✓ plus the rest).`,
    restTimerAuto: "In a superset, it starts only after the last exercise of each round. It never starts after the day's last set.",
    quickFill: `The first value you type in a column fills that column on the exercise's other sets: weight and reps
      on the day view, every target in the workout builder. Turn it off to fill each set yourself.`,
    autoregulation: `When you add to a day, rep and weight targets come from last time: one more rep if you hit
      the target, one weight step up past the top of the rep range, one step down below the bottom (${range} when a
      set has no range). A routine or workout goes by the last time that workout was done; an exercise added on its
      own goes by its own last session. Deload days are skipped. The dial in a card's swipe tray does this for one
      exercise any time.`,
    weightStep: "How much the weight goes up or down. An exercise can set its own on its edit page.",
    deload: `A deload day is a lighter day to recover. Marking one (the button under the day's date) tells
      autoregulation to skip it and base targets on the session before. Turning this off only hides the button:
      days already marked are still skipped.`,
    bodyweight: `Exercises like pullups and dips can be marked as bodyweight exercises on their edit page. You then
      log the weight you add (or, as a negative number, the assistance), and each set counts your bodyweight for
      that day plus that number. Turning this off hides the bodyweight field, the ± button and totals, and the
      exercise setting; exercises already marked keep counting your bodyweight, and their weight column stays "± lb".`,
    ratings: `Rate how recovered you feel going into each workout and how hard you pushed. Today's workout asks for
      recovery before you start and effort once you finish; tap a workout's name to rate it on any day. Progress
      charts both. Every method saves on the same scale, so you can switch any time.`,
    exportBackup: (contents: string) => `Saves all your data (${contents}) to a file. Keep a recent copy somewhere
      safe, off this phone: there's no cloud copy, so it's what protects you if the phone is lost or reset.`,
    importBackup: html`<strong>Replaces everything</strong> in the app with the backup's data. You'll see what the
      file contains and confirm before anything changes. If the file isn't a valid backup, nothing changes.`,
  },
};
