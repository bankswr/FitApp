// Rest timer: the floating button on the day view, and its settings on the Settings screen (static/rest_timer.js).
// State lives in localStorage so moving between days doesn't lose a running countdown; it's
// a per-device preference, so browser storage is fine here. onSetCompleted() is called when a
// set that qualifies is checked off (see restAfterSets for the superset rule).
import { html } from "lit-html";
import { formatDuration } from "../../logic/text";
import { alarmHaptic, clearRestTimer, nativeChime, prepareRestAlarms, showRestTimer, watchRestTimerStop } from "../native";
import { HELP } from "../help";

const KEY = "fitapp.restTimer";
const DEFAULTS = { duration: 90, auto: true, endsAt: null as number | null };
const MIN = 15;
const MAX = 600;

type TimerState = typeof DEFAULTS;
function loadState(): TimerState {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveState(state: TimerState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: the timer still works while this screen is open */
  }
}

/** The rest-timer length in seconds, added after the last ✓ when a workout is finished automatically. */
export const restSeconds = () => loadState().duration;

// ---------- settings (on the Settings screen) ----------
export const restTimerSettings = () => html`
  <section class="card settings-card" id="timer-settings">
    <h2>Rest timer</h2>
    <div class="stepper">
      <button type="button" class="icon-btn" data-step="-15" aria-label="15 seconds less">&minus;15s</button>
      <output id="timer-duration" aria-live="polite">1:30</output>
      <button type="button" class="icon-btn" data-step="15" aria-label="15 seconds more">+15s</button>
    </div>
    <div class="presets">
      ${[30, 60, 90, 120, 180].map((sec) => html`<button type="button" class="button subtle small" data-preset=${sec}>${formatDuration(sec)}</button>`)}
    </div>
    <label class="switch">
      <input type="checkbox" id="timer-auto">
      <span>Start automatically when a set is completed</span>
    </label>
    <p class="hint">${HELP.settings.restTimerAuto}</p>
  </section>`;

/** Each change re-reads the stored state, so a countdown that is already running is kept. */
export function mountRestTimerSettings(root: HTMLElement, signal: AbortSignal) {
  const card = root.querySelector<HTMLElement>("#timer-settings")!;
  const durationOut = card.querySelector<HTMLOutputElement>("#timer-duration")!;
  const autoBox = card.querySelector<HTMLInputElement>("#timer-auto")!;
  const update = (change: (state: TimerState) => void) => {
    const state = loadState();
    change(state);
    saveState(state);
    render();
  };
  const render = () => {
    const state = loadState();
    durationOut.textContent = formatDuration(state.duration);
    autoBox.checked = state.auto;
  };
  card.addEventListener("click", (e) => {
    const t = e.target as Element;
    const step = t.closest<HTMLElement>("[data-step]");
    const preset = t.closest<HTMLElement>("[data-preset]");
    if (step) update((st) => (st.duration = Math.min(MAX, Math.max(MIN, st.duration + Number(step.dataset.step)))));
    else if (preset) update((st) => (st.duration = Number(preset.dataset.preset)));
  }, { signal });
  autoBox.addEventListener("change", () => update((st) => (st.auto = autoBox.checked)), { signal });
  render();
}

const stopwatchIcon = html`<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="7"/><path d="M12 14V10.5M10 3h4M12 3v4M18.5 7.5l1.5-1.5"/></svg>`;

// Collapsed: a floating stopwatch button that starts the countdown. Running: expands to
// -15 / countdown / +15; tapping the countdown stops it and collapses back.
export const restTimerBar = () => html`
  <div class="timer" id="timer" data-state="idle">
    <button type="button" class="timer-start" id="timer-start" aria-label="Start rest timer">${stopwatchIcon}</button>
    <button type="button" class="icon-btn" data-adjust="-15" aria-label="15 seconds less">&minus;15</button>
    <button type="button" class="timer-main" id="timer-main" aria-label="Stop rest timer">
      <span class="timer-time" id="timer-time">1:30</span>
    </button>
    <button type="button" class="icon-btn" data-adjust="15" aria-label="15 seconds more">+15</button>
  </div>`;

// Audio needs a prior user gesture; one shared context for the whole app.
let audio: AudioContext | null = null;
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}

function alarm() {
  alarmHaptic();
  void nativeChime().then((played) => played || webChime());
}

function webChime() {
  if (!audio) return;
  for (let i = 0; i < 3; i++) {
    const t = audio.currentTime + i * 0.25;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}

export function mountRestTimer(root: HTMLElement, signal: AbortSignal): { onSetCompleted(): void; onDayFinished(): void } {
  const bar = root.querySelector<HTMLElement>("#timer")!;
  const time = root.querySelector<HTMLElement>("#timer-time")!;
  let tick: number | undefined;
  let doneTimer: number | undefined;
  signal.addEventListener("abort", () => {
    clearInterval(tick);
    clearTimeout(doneTimer);
  });

  const state = loadState();
  const save = () => saveState(state);
  const remaining = () => (state.endsAt ? Math.ceil((state.endsAt - Date.now()) / 1000) : null);
  // The phone's countdown notification and end alarm follow endsAt (native.ts).
  const syncPhone = () => (state.endsAt ? showRestTimer(state.endsAt) : clearRestTimer());

  function render() {
    const r = remaining();
    if (r != null && r > 0) {
      bar.dataset.state = "running";
      time.textContent = formatDuration(r);
    } else if (bar.dataset.state !== "done") {
      bar.dataset.state = "idle";
    }
  }
  function run() {
    clearInterval(tick);
    clearTimeout(doneTimer);
    tick = window.setInterval(update, 250);
    update();
  }
  function update() {
    const r = remaining();
    // Well past the end means the app was paused (phone asleep): the phone's alarm already rang.
    if (r != null && r <= 0) finish(r > -2);
    else render();
  }
  function start() {
    state.endsAt = Date.now() + state.duration * 1000;
    save();
    run();
    void prepareRestAlarms().then(syncPhone); // ask for notification permission now, not mid-rest
  }
  function stop() {
    clearInterval(tick);
    void clearRestTimer();
    state.endsAt = null;
    save();
    bar.dataset.state = "idle";
    render();
  }
  function finish(loud: boolean) {
    clearInterval(tick);
    void clearRestTimer();
    state.endsAt = null;
    save();
    bar.dataset.state = "done";
    time.textContent = "0:00";
    if (loud) alarm();
    doneTimer = window.setTimeout(() => {
      bar.dataset.state = "idle";
      render();
    }, 8000);
  }

  document.addEventListener("pointerdown", unlockAudio, { signal });
  root.querySelector("#timer-start")!.addEventListener("click", start, { signal });
  root.querySelector("#timer-main")!.addEventListener("click", () => {
    clearTimeout(doneTimer);
    stop();
  }, { signal });
  bar.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLElement>("[data-adjust]");
    if (!btn || !state.endsAt) return;
    state.endsAt += Number(btn.dataset.adjust) * 1000;
    if (remaining()! <= 0) return stop();
    save();
    void syncPhone();
    render();
  }, { signal });
  // Coming back catches up (intervals are throttled or paused in the background).
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.endsAt) update();
  }, { signal });

  // Stopped from the notification's Stop button: stop here too, unless a newer countdown has started since.
  const stopChecked = watchRestTimerStop(signal, (endsAt) => {
    const current = loadState().endsAt;
    if (current !== null && Math.abs(current - endsAt) < 1000) {
      state.endsAt = current;
      stop();
    }
  });

  // Resume a countdown already running (e.g. from another day); one that expired long ago resets quietly.
  if (state.endsAt && remaining()! > -10) {
    run();
    // After the Stop check, so a countdown stopped from the tray isn't put back on it.
    void stopChecked.then(() => {
      if (state.endsAt) void syncPhone();
    });
  } else {
    state.endsAt = null;
    save();
    render();
  }
  return {
    /** A qualifying set was completed and the day still has unfinished sets. */
    onSetCompleted() {
      if (state.auto) start();
    },
    /** The day's last unfinished set was completed: no rest needed, so stop any countdown. */
    onDayFinished() {
      if (state.endsAt) stop();
    },
  };
}
