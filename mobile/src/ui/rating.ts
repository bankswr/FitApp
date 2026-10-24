// Workout rating controls (agent-notes/ratings.md): faces, stars or a slider, picked in Settings.
// Every method saves 0–1; a value saved with another method shows at the nearest face / star count.
// Tapping the selected face or star again clears the rating; the slider has a Clear button.
import { html } from "lit-html";
import {
  FACES, faceValue, nearestFace, nearestStars, type RatingKind, type RatingMethod, roundRating, STARS, starValue,
} from "../logic/ratings";

export const RATING_LABEL: Record<RatingKind, string> = { recovery: "Recovery", effort: "Effort" };
// What each face means, for screen readers (1 = fully recovered / maximum effort, user 2026-10-24).
const FACE_NAMES: Record<RatingKind, readonly string[]> = {
  recovery: ["Poorly recovered", "Somewhat recovered", "Well recovered"],
  effort: ["Light effort", "Moderate effort", "Maximum effort"],
};

/** One rating of one day workout. `value` is the stored 0–1 or null. */
export function ratingControl(kind: RatingKind, value: number | null, method: RatingMethod, logWorkoutId: number) {
  const label = RATING_LABEL[kind];
  let body;
  if (method === "faces") {
    const sel = value === null ? -1 : nearestFace(value);
    body = FACES.map((face, i) => html`<button type="button" class="rating-face" data-rate=${faceValue(i)}
      aria-pressed=${i === sel ? "true" : "false"} aria-label=${FACE_NAMES[kind][i]}>${face}</button>`);
  } else if (method === "stars") {
    const sel = value === null ? 0 : nearestStars(value);
    body = Array.from({ length: STARS }, (_, k) => html`<button type="button" class="rating-star" data-rate=${starValue(k + 1)}
      aria-pressed=${k + 1 === sel ? "true" : "false"} data-lit=${k < sel ? "1" : "0"}
      aria-label="${k + 1} star${k ? "s" : ""}">★</button>`);
  } else {
    body = html`
      <span class="rating-slider">
        <input type="range" min="0" max="1" step="0.01" .value=${String(value ?? 0.5)} class=${value === null ? "unset" : ""}
               aria-label="${label}, from ${FACE_NAMES[kind][0].toLowerCase()} to ${FACE_NAMES[kind][2].toLowerCase()}"
               aria-valuetext=${value === null ? "Not rated" : `${Math.round(value * 100)}%`}>
        <span class="rating-ends" aria-hidden="true">${FACES.map((f) => html`<span>${f}</span>`)}</span>
      </span>
      <button type="button" class="button subtle small rating-clear" data-rate-clear ?hidden=${value === null}>Clear</button>`;
  }
  return html`<div class="rating" role="group" aria-label=${label} data-rating=${kind} data-lw=${logWorkoutId}
      data-method=${method} data-value=${value ?? ""}>
    <span class="rating-label">${label}</span>
    <span class="rating-input">${body}</span>
  </div>`;
}

/**
 * Wires every rating control under `root`: saves on tap / slider release through `save`, then
 * updates the control in place. `save` throws to keep the old value (the caller shows the error).
 */
export function mountRatings(root: HTMLElement, signal: AbortSignal, save: (logWorkoutId: number, kind: RatingKind, value: number | null) => Promise<void>) {
  const commit = async (group: HTMLElement, value: number | null) => {
    try {
      await save(Number(group.dataset.lw), group.dataset.rating as RatingKind, value);
      paintRating(group, value);
    } catch {
      paintRating(group, group.dataset.value === "" ? null : Number(group.dataset.value));
    }
  };
  root.addEventListener("click", (e) => {
    const t = e.target as Element;
    const group = t.closest<HTMLElement>("[data-rating]");
    if (!group) return;
    if (t.closest("[data-rate-clear]")) return void commit(group, null);
    // A tap that leaves an unrated slider where it was (the middle) fires no change: rate it there.
    if (t instanceof HTMLInputElement && t.type === "range" && group.dataset.value === "") return void commit(group, roundRating(Number(t.value)));
    const btn = t.closest<HTMLElement>("[data-rate]");
    if (!btn) return;
    const pressed = btn.getAttribute("aria-pressed") === "true";
    void commit(group, pressed ? null : Number(btn.dataset.rate));
  }, { signal });
  root.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const group = input.closest<HTMLElement>("[data-rating]");
    if (group && input.type === "range") void commit(group, roundRating(Number(input.value)));
  }, { signal });
}

/** Shows `value` in a rendered control without re-rendering it. */
export function paintRating(group: HTMLElement, value: number | null) {
  group.dataset.value = value === null ? "" : String(value);
  const method = group.dataset.method as RatingMethod;
  if (method === "faces") {
    const sel = value === null ? -1 : nearestFace(value);
    group.querySelectorAll(".rating-face").forEach((b, i) => b.setAttribute("aria-pressed", String(i === sel)));
  } else if (method === "stars") {
    const sel = value === null ? 0 : nearestStars(value);
    group.querySelectorAll<HTMLElement>(".rating-star").forEach((b, k) => {
      b.setAttribute("aria-pressed", String(k + 1 === sel));
      b.dataset.lit = k < sel ? "1" : "0";
    });
  } else {
    const input = group.querySelector<HTMLInputElement>("input[type=range]")!;
    input.value = String(value ?? 0.5);
    input.classList.toggle("unset", value === null);
    input.setAttribute("aria-valuetext", value === null ? "Not rated" : `${Math.round(value * 100)}%`);
    group.querySelector<HTMLElement>("[data-rate-clear]")!.hidden = value === null;
  }
}
