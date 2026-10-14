import { describe, expect, it } from "vitest";
import { type LogSet, targetValues } from "../src/logic/day";
import { repTargetLabel } from "../src/logic/text";

const set = (t: Partial<LogSet>): LogSet => withLabel({
  id: 1, position: 1, target_reps_min: null, target_reps_max: null, target_amrap: false,
  target_reps: null, target_weight: null, target_duration_seconds: null, target_distance: null,
  weight: null, reps: null, duration_seconds: null, distance: null, completed_at: null, target_label: "", ...t,
});
// The label as toLogSet builds it.
const withLabel = (s: LogSet): LogSet =>
  ({ ...s, target_label: s.target_reps != null ? String(s.target_reps) : repTargetLabel(s.target_reps_min, s.target_reps_max, s.target_amrap) });

describe("targetValues (filled in when a blank set is checked off)", () => {
  it("uses the autoregulated rep target and the weight target", () => {
    expect(targetValues(set({ target_reps_min: 8, target_reps_max: 12, target_reps: 10, target_weight: 135 })))
      .toEqual({ weight: 135, reps: 10, duration_seconds: null, distance: null });
  });
  it("uses an autoregulated AMRAP set's rep target", () => {
    expect(targetValues(set({ target_amrap: true, target_reps: 12, target_weight: 95 })))
      .toEqual({ weight: 95, reps: 12, duration_seconds: null, distance: null });
  });
  it("uses a fixed rep target, but not a range, 8+ or a plain AMRAP", () => {
    expect(targetValues(set({ target_reps_min: 5, target_reps_max: 5 })).reps).toBe(5);
    expect(targetValues(set({ target_reps_min: 8, target_reps_max: 12 })).reps).toBeNull();
    expect(targetValues(set({ target_reps_min: 8, target_reps_max: null })).reps).toBeNull();
    expect(targetValues(set({ target_reps_min: 5, target_reps_max: 5, target_amrap: true })).reps).toBeNull();
  });
  it("passes time and distance targets through", () => {
    expect(targetValues(set({ target_duration_seconds: 90, target_distance: 2 })))
      .toEqual({ weight: null, reps: null, duration_seconds: 90, distance: 2 });
  });
});
