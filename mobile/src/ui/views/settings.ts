// Settings: the bottom bar's gear. Per-device preferences (rest timer, quick fill,
// autoregulation, workout ratings, feature switches; ui/prefs.ts and restTimer.ts) and the backup export / import.
import { html } from "lit-html";
import { route } from "../app";
import { parseWeightStep, WEIGHT_STEP } from "../../logic/autoregulation";
import { formatNumber } from "../../logic/text";
import { RATING_METHODS, type RatingMethod } from "../../logic/ratings";
import {
  autoregulateOn, featureOn, quickFillOn, ratingMethod, setAutoregulate, setFeature, setQuickFill, setRatingMethod,
  setWeightStepDefault, weightStepDefault,
} from "../prefs";
import { mountWeightStep, weightStepField } from "../weightStep";
import { backupSettings } from "./backup";
import { mountRestTimerSettings, restTimerSettings } from "./restTimer";
import { HELP } from "../help";

const METHOD_LABEL: Record<RatingMethod, string> = { faces: "😞 😐 🙂", stars: "★★★★★", slider: "Slider" };
const METHOD_NAME: Record<RatingMethod, string> = { faces: "Faces", stars: "Stars", slider: "Slider" };

route(/^\/settings$/, async (ctx) => {
  const backup = await backupSettings(ctx);
  const schema = Number((await ctx.db.all("PRAGMA user_version"))[0].user_version);
  return {
    title: "Settings",
    section: "settings",
    content: html`
      <header class="page-header"><h1>Settings</h1></header>
      ${restTimerSettings()}
      <section class="card settings-card">
        <h2>Quick fill</h2>
        <label class="switch">
          <input type="checkbox" id="quick-fill" .checked=${quickFillOn()}>
          <span>Copy the first value into the remaining sets</span>
        </label>
        <p class="hint">${HELP.settings.quickFill}</p>
      </section>
      <section class="card settings-card">
        <h2>Autoregulation</h2>
        <label class="switch">
          <input type="checkbox" id="autoregulate" .checked=${autoregulateOn()}>
          <span>Set targets from the last session</span>
        </label>
        <p class="hint">${HELP.settings.autoregulation}</p>
        <label class="settings-label" for="weight-step">Weight step</label>
        ${weightStepField({ id: "weight-step", name: "weight_step", value: formatNumber(weightStepDefault()),
          placeholder: formatNumber(WEIGHT_STEP), label: "Weight step" })}
        <p class="hint" id="weight-step-hint">${HELP.settings.weightStep}</p>
      </section>
      <section class="card settings-card">
        <h2>Deload days</h2>
        <label class="switch">
          <input type="checkbox" data-feature="deload" .checked=${featureOn("deload")}>
          <span>Show the Deload day button</span>
        </label>
        <p class="hint">${HELP.settings.deload}</p>
      </section>
      <section class="card settings-card">
        <h2>Bodyweight exercises</h2>
        <label class="switch">
          <input type="checkbox" data-feature="bodyweight" .checked=${featureOn("bodyweight")}>
          <span>Show bodyweight controls</span>
        </label>
        <p class="hint">${HELP.settings.bodyweight}</p>
      </section>
      <section class="card settings-card" id="ratings-settings">
        <h2>Workout ratings</h2>
        <label class="switch">
          <input type="checkbox" id="ratings-on" .checked=${featureOn("ratings")}>
          <span>Rate recovery and effort for each workout</span>
        </label>
        <p class="hint">${HELP.settings.ratings}</p>
        <div class="chips rating-methods" role="radiogroup" aria-label="Rating method" ?hidden=${!featureOn("ratings")}>
          ${RATING_METHODS.map((m) => html`<label class="chip">
            <input type="radio" name="rating-method" value=${m} aria-label=${METHOD_NAME[m]} .checked=${ratingMethod() === m}><span>${METHOD_LABEL[m]}</span>
          </label>`)}
        </div>
      </section>
      <h2 class="settings-heading">Backup</h2>
      ${backup.content}
      <section class="card settings-card about-card" aria-label="About">
        <dl class="about">
          <dt>App version</dt><dd>${__APP_VERSION__} (build ${__APP_BUILD__})</dd>
          <dt>Database schema</dt><dd>${schema}</dd>
        </dl>
      </section>`,
    mount(root: HTMLElement, signal: AbortSignal) {
      mountRestTimerSettings(root, signal);
      backup.mount(root, signal);
      const quickFill = root.querySelector<HTMLInputElement>("#quick-fill")!;
      quickFill.addEventListener("change", () => setQuickFill(quickFill.checked), { signal });
      for (const box of root.querySelectorAll<HTMLInputElement>("[data-feature]")) {
        box.addEventListener("change", () => setFeature(box.dataset.feature as "deload" | "bodyweight", box.checked), { signal });
      }
      const ratings = root.querySelector<HTMLInputElement>("#ratings-on")!;
      const methods = root.querySelector<HTMLElement>(".rating-methods")!;
      ratings.addEventListener("change", () => {
        setFeature("ratings", ratings.checked);
        methods.hidden = !ratings.checked;
      }, { signal });
      methods.addEventListener("change", (e) => setRatingMethod((e.target as HTMLInputElement).value as RatingMethod), { signal });
      const autoregulate = root.querySelector<HTMLInputElement>("#autoregulate")!;
      autoregulate.addEventListener("change", () => setAutoregulate(autoregulate.checked), { signal });
      const stepInput = root.querySelector<HTMLInputElement>("#weight-step")!;
      const stepHint = root.querySelector<HTMLElement>("#weight-step-hint")!;
      const stepHintText = stepHint.textContent!;
      mountWeightStep(stepInput.closest("[data-weight-step]")!, signal, () => {
        try {
          const step = parseWeightStep(stepInput.value) ?? WEIGHT_STEP; // blank: back to 5 lb
          setWeightStepDefault(step);
          stepInput.value = formatNumber(step);
          stepHint.textContent = stepHintText;
        } catch (err) {
          stepInput.classList.add("invalid");
          stepHint.textContent = (err as Error).message; // keeps the last good value
        }
      });
    },
  };
});
