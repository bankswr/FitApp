// Bar chart of volume per day on the Progress screen (static/progress.js): inline SVG,
// redrawn to fit the card. Hover/tap anywhere or use ←/→ when the chart has focus to read a day;
// rest days are skipped (user, 2026-10-23): the nearest day with volume is shown. The table view
// has every value too.
const SVG = "http://www.w3.org/2000/svg";
const BAR = "#16a34a"; // validated against the card surface (dataviz validate_palette, dark mode)
const BAR_ACTIVE = "#22c55e"; // the hovered bar lifts a step lighter
const PLOT_H = 180;
const AXIS_H = 46; // x-axis label band (angled dates), included in the container height
const LABEL_ANGLE = -75; // steep enough that neighbouring days stay readable on a month range
const MIN_LABEL_GAP = 9; // px between angled labels; narrower day columns switch to weekly labels
const LEFT = 44; // y-axis label gutter
const TOP = 8;

// Cut off at one decimal, thousands-separated (matches formatVolume).
const fmt = (v: number) => (Math.floor(v * 10 + 1e-9) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
const parse = (iso: string) => new Date(`${iso}T00:00:00`);
const shortDate = (iso: string) => parse(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const longDate = (iso: string) => parse(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

// Round axis: 1 / 2 / 2.5 / 5 × 10^n steps, about four gridlines.
function niceStep(max: number): number {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
}

function el(name: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent.appendChild(node);
  return node;
}

// Rounded 4px data end (top), square at the baseline.
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export function mountVolumeChart(chart: HTMLElement, days: { date: string; volume: number }[], signal: AbortSignal) {
  const tooltip = chart.querySelector<HTMLElement>("#chart-tooltip")!;
  let bars: (SVGElement | null)[] = [];
  let band = 1;
  let active = -1;

  function draw() {
    chart.querySelector("svg")?.remove();
    const width = chart.clientWidth;
    const plotW = width - LEFT - 4;
    const max = Math.max(...days.map((d) => d.volume));
    const step = niceStep(max || 100); // an empty range still gets a 0–100 axis
    const top = max ? Math.ceil(max / step) * step : 4 * step;
    const y = (v: number) => TOP + PLOT_H - (v / top) * PLOT_H;
    band = plotW / days.length;
    const barW = Math.max(1, Math.min(24, band - 2)); // 2px surface gap between neighbours

    const svg = el("svg", { width, height: TOP + PLOT_H + AXIS_H, "aria-hidden": "true" }, chart);
    // Gridlines + y ticks (hairline, solid, recessive).
    for (let v = 0; v <= top + 1e-9; v += step) {
      el("line", { x1: LEFT, x2: width, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "grid" }, svg);
      el("text", { x: LEFT - 6, y: y(v) + 4, "text-anchor": "end", class: "tick" }, svg).textContent =
        v >= 10000 ? `${fmt(v / 1000)}k` : fmt(v);
    }
    bars = days.map((d, i) => {
      if (!d.volume) return null;
      const x = LEFT + i * band + (band - barW) / 2;
      return el("path", { d: barPath(x, y(d.volume), barW, y(0) - y(d.volume)), fill: BAR }, svg);
    });
    // Every day with volume gets an angled date label. When day columns are too narrow for that
    // (a 3-month range on a phone), label every 7th day from the start instead. An empty range
    // labels its first and last day.
    const weekly = band < MIN_LABEL_GAP;
    const labelled = !days.some((d) => d.volume)
      ? [...new Set([0, days.length - 1])]
      : days.flatMap((d, i) => ((weekly ? i % 7 === 0 : d.volume) ? [i] : []));
    for (const i of labelled) {
      const x = LEFT + (i + 0.5) * band;
      const ly = TOP + PLOT_H + 10;
      el("text", { x, y: ly, "text-anchor": "end", "dominant-baseline": "middle",
        transform: `rotate(${LABEL_ANGLE} ${x} ${ly})`, class: "tick date" }, svg).textContent = shortDate(days[i].date);
    }
    if (active >= 0) show(active);
  }

  function show(i: number) {
    active = i;
    bars.forEach((b, j) => b?.setAttribute("fill", j === i ? BAR_ACTIVE : BAR));
    const d = days[i];
    tooltip.querySelector("strong")!.textContent = d.volume ? `${fmt(d.volume)} lb` : "Rest day";
    tooltip.querySelector("span")!.textContent = longDate(d.date);
    tooltip.hidden = false;
    // Keep the tooltip inside the card, centred over the day where possible.
    const center = LEFT + (i + 0.5) * band;
    const w = tooltip.offsetWidth;
    tooltip.style.left = `${Math.min(Math.max(center - w / 2, 0), chart.clientWidth - w)}px`;
  }

  function hide() {
    active = -1;
    bars.forEach((b) => b?.setAttribute("fill", BAR));
    tooltip.hidden = true;
  }

  // Days that have volume; with none at all, every day can be read (as "Rest day").
  const withVolume = days.flatMap((d, i) => (d.volume ? [i] : []));
  const readable = withVolume.length ? withVolume : days.map((_, i) => i);
  /** The readable day whose column centre is nearest the pointer. */
  const indexAt = (clientX: number) => {
    const x = (clientX - chart.getBoundingClientRect().left - LEFT) / band - 0.5;
    return readable.reduce((best, i) => (Math.abs(i - x) < Math.abs(best - x) ? i : best));
  };

  chart.addEventListener("pointermove", (e) => show(indexAt(e.clientX)), { signal });
  chart.addEventListener("pointerdown", (e) => show(indexAt(e.clientX)), { signal });
  chart.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") hide(); // on touch, the last tapped day stays shown
  }, { signal });
  chart.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    // The next / previous day with volume; the latest one first.
    const k = readable.indexOf(active);
    const next = active < 0 ? readable.length - 1 : k + (e.key === "ArrowRight" ? 1 : -1);
    show(readable[Math.min(readable.length - 1, Math.max(0, next))]);
  }, { signal });
  chart.addEventListener("blur", hide, { signal });

  const resize = new ResizeObserver(draw);
  resize.observe(chart);
  signal.addEventListener("abort", () => resize.disconnect());
}
