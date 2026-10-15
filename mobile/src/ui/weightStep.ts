// The autoregulation weight-step field (user requirement, 2026-10-15), on the exercise form and in
// Settings: a number you can type, between − and + buttons that move along WEIGHT_STEPS. From a
// value off the ladder they go to the nearest ladder value that way; from blank they start at the
// placeholder (the Settings default).
import { html } from "lit-html";
import { stepDown, stepUp } from "../logic/autoregulation";
import { formatNumber } from "../logic/text";

export function weightStepField(o: { id: string; name: string; value: string; placeholder: string; label: string }) {
  return html`
    <div class="weight-step" data-weight-step>
      <button type="button" class="button subtle" data-step="down" aria-label="Smaller ${o.label.toLowerCase()}">&minus;</button>
      <input type="text" inputmode="decimal" autocomplete="off" maxlength="7" id=${o.id} name=${o.name}
             .value=${o.value} placeholder=${o.placeholder} aria-label=${o.label}>
      <span class="weight-step-unit">lb</span>
      <button type="button" class="button subtle" data-step="up" aria-label="Larger ${o.label.toLowerCase()}">+</button>
    </div>`;
}

/** Wires the − / + buttons. `onChange` runs after a button press or an edit. */
export function mountWeightStep(field: HTMLElement, signal: AbortSignal, onChange: () => void = () => {}) {
  const input = field.querySelector<HTMLInputElement>("input")!;
  const down = field.querySelector<HTMLButtonElement>('[data-step="down"]')!;
  const up = field.querySelector<HTMLButtonElement>('[data-step="up"]')!;
  const current = () => {
    const typed = Number(input.value.trim());
    return input.value.trim() && Number.isFinite(typed) ? typed : Number(input.placeholder);
  };
  const sync = () => {
    down.disabled = stepDown(current()) === null;
    up.disabled = stepUp(current()) === null;
  };
  for (const [btn, move] of [[down, stepDown], [up, stepUp]] as const) {
    btn.addEventListener("click", () => {
      const next = move(current());
      if (next === null) return;
      input.value = formatNumber(next);
      input.classList.remove("invalid");
      sync();
      onChange();
    }, { signal });
  }
  input.addEventListener("input", () => {
    input.classList.remove("invalid");
    sync();
  }, { signal });
  input.addEventListener("change", onChange, { signal });
  sync();
}
