// Workout ratings over time on the Progress screen (agent-notes/ratings.md): recovery and effort on
// one 0–1 axis (😞 😐 🙂), each a line through the daily average with every workout's rating as a
// dot on top. Same day axis as the volume chart; days with no rating are skipped (the lines join
// across them). Hover/tap or ←/→ to read a day; the table view has every value too.
import type { RatingDay } from "../logic/progress";
import { average } from "../logic/progress";
import type { RatingKind } from "../logic/ratings";
import { RATING_LABEL } from "./rating";
import { AXIS_H, el, LABEL_ANGLE, LEFT, longDate, MIN_LABEL_GAP, PLOT_H, shortDate, TOP } from "./volumeChart";
import { addDays, daysBetween } from "../logic/text";

// Categorical slots 1 and 2 of the dataviz reference palette, dark steps; validated against the card
// surface #1e293b (validate_palette.js --mode dark: CVD ΔE 26.8, all checks pass).
export const SERIES: Record<RatingKind, string> = { recovery: "#3987e5", effort: "#d95926" };
const KINDS: RatingKind[] = ["recovery", "effort"];
const FACE_TICKS: [number, string][] = [[0, "😞"], [0.5, "😐"], [1, "🙂"]];
const PAD = 6; // keeps dots at 0 and 1 inside the plot

export const pct = (v: number) => `${Math.round(v * 100)}%`;

/** "63%", or "63% (50%, 75%)" when several workouts were rated that day. */
export const ratingSummary = (values: number[]) =>
  values.length > 1 ? `${pct(average(values)!)} (${values.map(pct).join(", ")})` : values.length ? pct(values[0]) : "–";

export function mountRatingsChart(chart: HTMLElement, start: string, end: string, days: RatingDay[], signal: AbortSignal) {
  const tooltip = chart.querySelector<HTMLElement>(".chart-tooltip")!;
  const nDays = daysBetween(start, end) + 1;
  const index = (date: string) => daysBetween(start, date);
  let band = 1;
  let active = -1; // index into days
  let cursor: SVGElement | null = null;

  function draw() {
    chart.querySelector("svg")?.remove();
    const width = chart.clientWidth;
    band = (width - LEFT - 4) / nDays;
    const x = (i: number) => LEFT + (i + 0.5) * band;
    const y = (v: number) => TOP + PAD + (1 - v) * (PLOT_H - 2 * PAD);
    const svg = el("svg", { width, height: TOP + PLOT_H + AXIS_H, "aria-hidden": "true" }, chart);
    for (const [v, face] of FACE_TICKS) {
      el("line", { x1: LEFT, x2: width, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "grid" }, svg);
      el("text", { x: LEFT - 8, y: y(v) + 5, "text-anchor": "end", class: "tick face" }, svg).textContent = face;
    }
    cursor = el("line", { x1: 0, x2: 0, y1: TOP, y2: TOP + PLOT_H, class: "cursor", visibility: "hidden" }, svg);
    for (const kind of KINDS) {
      const rated = days.filter((d) => d[kind].length);
      if (rated.length > 1) {
        const points = rated.map((d) => `${x(index(d.date))},${y(average(d[kind])!)}`).join(" ");
        el("polyline", { points, fill: "none", stroke: SERIES[kind], "stroke-width": 2, "stroke-linejoin": "round" }, svg);
      }
      for (const d of rated) {
        for (const v of d[kind]) {
          el("circle", { cx: x(index(d.date)), cy: y(v), r: 4, fill: SERIES[kind], class: "dot" }, svg);
        }
      }
    }
    // Rated days get an angled date label; too narrow for that (a long range on a phone), every 7th day.
    const weekly = band < MIN_LABEL_GAP;
    const labelled = !days.length
      ? [...new Set([0, nDays - 1])]
      : weekly ? Array.from({ length: Math.ceil(nDays / 7) }, (_, k) => k * 7) : days.map((d) => index(d.date));
    for (const i of labelled) {
      const ly = TOP + PLOT_H + 10;
      el("text", { x: x(i), y: ly, "text-anchor": "end", "dominant-baseline": "middle",
        transform: `rotate(${LABEL_ANGLE} ${x(i)} ${ly})`, class: "tick date" }, svg).textContent = shortDate(addDays(start, i));
    }
    if (active >= 0) show(active);
  }

  function show(k: number) {
    active = k;
    const d = days[k];
    const cx = LEFT + (index(d.date) + 0.5) * band;
    cursor?.setAttribute("x1", String(cx));
    cursor?.setAttribute("x2", String(cx));
    cursor?.setAttribute("visibility", "visible");
    tooltip.querySelector("strong")!.textContent = longDate(d.date);
    tooltip.querySelector("span")!.textContent = KINDS.map((kind) => `${RATING_LABEL[kind]} ${ratingSummary(d[kind])}`).join(" · ");
    tooltip.hidden = false;
    const w = tooltip.offsetWidth;
    tooltip.style.left = `${Math.min(Math.max(cx - w / 2, 0), chart.clientWidth - w)}px`;
  }

  function hide() {
    active = -1;
    cursor?.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  }

  /** The rated day whose column centre is nearest the pointer. */
  const nearest = (clientX: number) => {
    const at = (clientX - chart.getBoundingClientRect().left - LEFT) / band - 0.5;
    return days.reduce((best, d, k) => (Math.abs(index(d.date) - at) < Math.abs(index(days[best].date) - at) ? k : best), 0);
  };

  if (days.length) {
    chart.addEventListener("pointermove", (e) => show(nearest(e.clientX)), { signal });
    chart.addEventListener("pointerdown", (e) => show(nearest(e.clientX)), { signal });
    chart.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") hide(); // on touch, the last tapped day stays shown
    }, { signal });
    chart.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const next = active < 0 ? days.length - 1 : active + (e.key === "ArrowRight" ? 1 : -1);
      show(Math.min(days.length - 1, Math.max(0, next)));
    }, { signal });
    chart.addEventListener("blur", hide, { signal });
  }

  const resize = new ResizeObserver(draw);
  resize.observe(chart);
  signal.addEventListener("abort", () => resize.disconnect());
}
