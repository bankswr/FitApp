// An exercise's past sessions (templates/_exercise_history.html). Used by the exercise page
// and the day view's History sheet.
import { html } from "lit-html";
import type { LogSet } from "../../logic/day";
import type { Exercise } from "../../logic/exercises";
import { HISTORY_LIMIT, type Session, setResult } from "../../logic/history";
import { historyDate } from "../../logic/text";

/** "W1", "W2" for warmups, "1", "2" for the rest, counted through the session. */
const setNumber = (sets: LogSet[], i: number) => {
  const n = sets.slice(0, i + 1).filter((x) => x.is_warmup === sets[i].is_warmup).length;
  return sets[i].is_warmup ? `W${n}` : String(n);
};

export function historyList(exercise: Exercise, sessions: Session[], today: string) {
  if (!sessions.length) {
    return html`<p class="empty small">No history yet. Sets and session notes you log for this exercise will show up here.</p>`;
  }
  return html`
    <ol class="history">
      ${sessions.map((s) => html`
        <li class="history-day">
          <div class="history-head">
            <a href="#/day/${s.date}">${historyDate(s.date, today)}</a>
            ${s.workouts.length ? html`<span class="picker-meta">${s.workouts.join(", ")}</span>` : ""}
          </div>
          ${s.notes.map((note) => html`<p class="note session-note">${note}</p>`)}
          ${s.sets.length ? html`
            <ol class="history-sets">
              ${s.sets.map((set, i) => html`
                <li class=${set.completed_at ? "" : "not-done"}>
                  <span class="set-num">${setNumber(s.sets, i)}</span>
                  <span>${setResult(set, exercise, s.bodyweight)}</span>
                  ${set.completed_at ? "" : html`<span class="picker-meta">not checked off</span>`}
                </li>`)}
            </ol>` : ""}
        </li>`)}
    </ol>
    ${sessions.length === HISTORY_LIMIT ? html`<p class="hint history-more">Showing the ${HISTORY_LIMIT} most recent days.</p>` : ""}`;
}
