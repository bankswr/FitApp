// Phone-only features via Capacitor plugins. In a desktop browser each function falls back
// to the web behaviour or does nothing, so callers never need to check the platform.
import { App } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Share } from "@capacitor/share";

export const isNative = Capacitor.isNativePlatform();

/**
 * Android back button: close an open sheet, else go back a screen, else (on Today) leave the app.
 * Uses the page's own history: the WebView's canGoBack doesn't count in-app route (#) changes.
 */
export function initBackButton() {
  if (!isNative) return;
  void App.addListener("backButton", () => {
    const open = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].at(-1);
    if (open) open.close();
    else if (!location.hash || location.hash === "#/day") void App.exitApp();
    else if (history.length > 1) history.back();
    else location.hash = "#/day";
  });
}

/**
 * Web app (iPhone/iPad home screen, or a browser): keep the app's files on the device so it
 * starts offline (sw.js, built version only), and ask the browser not to clear the database
 * when space runs low.
 */
export function initWebApp() {
  if (isNative) return;
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("Offline support unavailable", e));
  }
  void navigator.storage?.persist?.().catch(() => {});
}

/**
 * Save an exported file: the share sheet (Files, Drive, ...) on a phone, a download on a
 * desktop browser. iOS home-screen apps don't download files reliably, so touch devices
 * use the web share sheet when the browser has one.
 */
export async function saveFile(name: string, contents: string, type: string): Promise<void> {
  if (isNative) {
    const { uri } = await Filesystem.writeFile({ path: name, data: contents, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: name, url: uri, dialogTitle: "Save your FitApp backup" });
    return;
  }
  const file = new File([contents], name, { type });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // closed the sheet without saving
      // Not allowed (e.g. no recent tap): fall back to a download.
    }
  }
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A short tap of vibration (set checked off). */
export function tapHaptic() {
  if (isNative) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

/** The rest-over buzz: native vibration on a phone, the Vibration API elsewhere. */
export function alarmHaptic() {
  if (isNative) void Haptics.vibrate({ duration: 600 }).catch(() => {});
  else navigator.vibrate?.([200, 100, 200, 100, 200]);
}

// ---------- rest timer on the phone (android/.../RestTimerPlugin.java) ----------
// While a countdown runs, a notification shows it (status bar and lock screen), and an alarm
// at the end sounds even when the phone is asleep. Set up when the countdown starts, not when
// the app goes to the background: JS can be paused before a call made then gets through.
const RestTimer = registerPlugin<{
  start(o: { endsAt: number }): Promise<void>;
  stop(): Promise<void>;
  chime(): Promise<void>;
  takeStopped(): Promise<{ endsAt: number | null }>;
  addListener(event: "stopped", fn: () => void): Promise<{ remove(): Promise<void> }>;
}>("RestTimer");

/**
 * Play the rest-over chime natively, which pauses other audio (music) for it and resumes it after.
 * False when there is no native chime (browser / iPhone web app) or it failed: use Web Audio then.
 */
export async function nativeChime(): Promise<boolean> {
  if (!isNative) return false;
  try {
    await RestTimer.chime();
    return true;
  } catch {
    return false;
  }
}

/** Show the countdown and set the end alarm (replacing any earlier one). */
export async function showRestTimer(endsAt: number): Promise<void> {
  if (!isNative || endsAt <= Date.now()) return;
  try {
    await RestTimer.start({ endsAt });
  } catch (e) {
    console.warn("Couldn't set the rest alarm", e);
  }
}

/** Remove the countdown, the alarm and any "Rest over" alert. */
export async function clearRestTimer(): Promise<void> {
  if (!isNative) return;
  try {
    await RestTimer.stop();
  } catch {
    /* nothing running */
  }
}

/**
 * The notification's Stop button (user requirement, 2026-10-23): calls `onStop(endsAt)` with the end
 * time of the countdown stopped from the tray, right away while the app runs and otherwise when it
 * comes back or this is set up. Stops listening when `signal` aborts. Resolves once the first check is done.
 */
export function watchRestTimerStop(signal: AbortSignal, onStop: (endsAt: number) => void): Promise<void> {
  if (!isNative) return Promise.resolve();
  const check = () => RestTimer.takeStopped().then(({ endsAt }) => {
    if (endsAt != null && !signal.aborted) onStop(endsAt);
  }).catch(() => {});
  void RestTimer.addListener("stopped", check).then((handle) => {
    if (signal.aborted) void handle.remove();
    else signal.addEventListener("abort", () => void handle.remove());
  });
  document.addEventListener("visibilitychange", () => !document.hidden && void check(), { signal });
  return check();
}

/** Ask for notification permission ahead of time (the first rest timer start), so it isn't asked mid-rest. */
export async function prepareRestAlarms(): Promise<void> {
  if (!isNative) return;
  try {
    const { display } = await LocalNotifications.checkPermissions();
    if (display === "prompt" || display === "prompt-with-rationale") await LocalNotifications.requestPermissions();
  } catch {
    /* not critical */
  }
}
