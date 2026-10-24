import { type Autoregulate, WEIGHT_STEP, WEIGHT_STEP_MAX } from "../logic/autoregulation";
import { RATING_METHODS, type RatingMethod } from "../logic/ratings";

// Per-device preferences kept in localStorage (like the rest timer's). Reads fall back to the
// default when storage is unavailable.
const QUICK_FILL = "fitapp.quickFill";

/** Quick fill: the first value typed in a column is copied to that column's other sets (day view and workout builder). On by default. */
export function quickFillOn(): boolean {
  try {
    return localStorage.getItem(QUICK_FILL) !== "off";
  } catch {
    return true;
  }
}
export function setQuickFill(on: boolean) {
  try {
    localStorage.setItem(QUICK_FILL, on ? "on" : "off");
  } catch {
    /* storage unavailable: the setting lasts until the app reloads */
  }
}

const AUTOREGULATE = "fitapp.autoregulate";

/**
 * Autoregulation (user requirement, 2026-10-10): sets rep and weight targets from the last session
 * when routines, workouts or exercises are added to a day. Off by default. Replaces the old
 * per-routine switch (routine.autoregulate is kept in the data but no longer read).
 */
export function autoregulateOn(): boolean {
  try {
    return localStorage.getItem(AUTOREGULATE) === "on";
  } catch {
    return false;
  }
}
export function setAutoregulate(on: boolean) {
  try {
    localStorage.setItem(AUTOREGULATE, on ? "on" : "off");
  } catch {
    /* storage unavailable: the setting lasts until the app reloads */
  }
}

const COLLAPSED = "fitapp.collapsedEntries";
const COLLAPSED_KEEP = 500; // log_entry ids are never reused, so only the newest few matter

/** Day-view exercise cards (log_entry ids) collapsed to their name (user requirement, 2026-10-15). */
export function collapsedEntries(): Set<number> {
  try {
    const ids = JSON.parse(localStorage.getItem(COLLAPSED) ?? "[]");
    return new Set(Array.isArray(ids) ? ids.filter(Number.isInteger) : []);
  } catch {
    return new Set();
  }
}
export function setEntryCollapsed(id: number, collapsed: boolean) {
  const ids = collapsedEntries();
  ids.delete(id);
  if (collapsed) ids.add(id);
  try {
    localStorage.setItem(COLLAPSED, JSON.stringify([...ids].slice(-COLLAPSED_KEEP)));
  } catch {
    /* storage unavailable: the card opens again on the next render */
  }
}

const WEIGHT_STEP_KEY = "fitapp.weightStep";

/** Autoregulation's default weight step in lb (user requirement, 2026-10-15); exercises can override it. */
export function weightStepDefault(): number {
  try {
    const n = Number(localStorage.getItem(WEIGHT_STEP_KEY));
    return Number.isFinite(n) && n > 0 && n <= WEIGHT_STEP_MAX ? n : WEIGHT_STEP;
  } catch {
    return WEIGHT_STEP;
  }
}
export function setWeightStepDefault(step: number) {
  try {
    localStorage.setItem(WEIGHT_STEP_KEY, String(step));
  } catch {
    /* storage unavailable: the setting lasts until the app reloads */
  }
}

/** What the day view passes to its loaders: off, or on with this device's default weight step. */
export function autoregulation(): Autoregulate {
  return autoregulateOn() && { weightStep: weightStepDefault() };
}

// Feature switches (user requirement, 2026-10-24; agent-notes/feature-switches.md): each hides a
// feature's controls on this device. All on by default. Hiding never changes the data or how it's
// used: stored ratings, deload marks and bodyweight sets keep counting.
export type Feature = "ratings" | "restTimer" | "deload" | "bodyweight";
const FEATURE_KEYS: Record<Feature, string> = {
  ratings: "fitapp.ratings",
  restTimer: "fitapp.restTimerShown",
  deload: "fitapp.deload",
  bodyweight: "fitapp.bodyweight",
};

export function featureOn(feature: Feature): boolean {
  try {
    return localStorage.getItem(FEATURE_KEYS[feature]) !== "off";
  } catch {
    return true;
  }
}
export function setFeature(feature: Feature, on: boolean) {
  try {
    localStorage.setItem(FEATURE_KEYS[feature], on ? "on" : "off");
  } catch {
    /* storage unavailable: the setting lasts until the app reloads */
  }
}

const RATING_METHOD = "fitapp.ratingMethod";

/** How workout ratings are entered: faces (the default), stars or a slider. All store 0–1. */
export function ratingMethod(): RatingMethod {
  try {
    const m = localStorage.getItem(RATING_METHOD);
    return (RATING_METHODS as readonly string[]).includes(m ?? "") ? (m as RatingMethod) : "faces";
  } catch {
    return "faces";
  }
}
export function setRatingMethod(method: RatingMethod) {
  try {
    localStorage.setItem(RATING_METHOD, method);
  } catch {
    /* storage unavailable: the setting lasts until the app reloads */
  }
}
