import { describe, expect, it } from "vitest";
import { costPerKm, evaluate, parkingScore, standOrMove, DEFAULT_SETTINGS as S } from "@/lib/engine";

describe("engine", () => {
  it("cost per km = fuel*cons/100 + wear", () => expect(costPerKm(S)).toBeCloseTo(5.16));
  it("SMART accepts 120 Kč / 6 km / 25 min", () => {
    const r = evaluate({ reward: 120, km: 6, driveMin: 20, waitMin: 5 }, S)!;
    expect(r.net).toBeCloseTo(89.04);
    expect(r.smart).toBe(true); expect(r.max).toBe(false);
  });
  it("private parking scores 0", () => expect(parkingScore({ access: "private" })).toBe(0));
  it("stay when there is not better", () =>
    expect(standOrMove({ hereNet: 80, hereWait: 10, thereNet: 80, thereWait: 15, cycle: 20, moveKm: 3, moveMin: 8 }, S).go).toBe(false));
});
