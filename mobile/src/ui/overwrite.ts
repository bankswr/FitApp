// Numeric fields overwrite (user requirement, 2026-10-13): focusing one leaves its value (or the
// target in its placeholder) showing, and the first key pressed replaces the whole value instead
// of editing at the cursor. Backspace as the first key clears it. Applies to every field with a
// numeric or decimal keyboard, app-wide.
const NUMERIC = 'input[inputmode="numeric"], input[inputmode="decimal"]';

export function initOverwriteOnEdit() {
  let fresh: HTMLInputElement | null = null; // focused, nothing typed yet
  document.addEventListener("focusin", (e) => {
    fresh = e.target instanceof HTMLInputElement && e.target.matches(NUMERIC) ? e.target : null;
  });
  document.addEventListener("focusout", (e) => {
    if (e.target === fresh) fresh = null;
  });
  // Selecting everything just before the edit makes the key replace it; the edit itself (and the
  // input/change events the screens listen to) stays the browser's own.
  document.addEventListener("beforeinput", (e) => {
    const input = e.target;
    if (input !== fresh || !(input instanceof HTMLInputElement)) return;
    fresh = null;
    if (input.value) input.setSelectionRange(0, input.value.length);
  }, true);
}
