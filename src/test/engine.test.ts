import { describe, expect, it } from "vitest";
import { costPerKm, evaluate, parkingByZone, parkingScore, parseParkingElements, standOrMove, DEFAULT_SETTINGS as S } from "@/lib/engine";

describe("engine", () => {
  it("cost per km = fuel*cons/100 + wear", () => expect(costPerKm(S)).toBeCloseTo(5.16));
  it("SMART accepts 120 Kč / 6 km / 25 min", () => {
    const r = evaluate({ reward: 120, km: 6, driveMin: 20, waitMin: 5 }, S)!;
    expect(r.net).toBeCloseTo(89.04);
    expect(r.smart).toBe(true); expect(r.max).toBe(false);
  });
  it("private parking scores 0", () => expect(parkingScore({ access: "private" })).toBe(0));
  it("keeps parking with zero score and supports relation centers", () => {
    const parks = parseParkingElements([
      { type: "way", id: 12, center: { lon: 18.2, lat: 49.8 }, tags: { access: "private" } },
      { type: "relation", id: 12, center: { lon: 18.3, lat: 49.9 }, tags: { parking: "surface" } },
      { type: "node", id: 13, lon: 18.4, lat: 49.7 },
      { type: "way", id: 14, center: { lon: 181, lat: 49.8 } },
    ]);

    expect(parks).toHaveLength(3);
    expect(parks[0]?.id).toBe("way/12");
    expect(parks[0]?.score).toBe(0);
    expect(parks[1]?.id).toBe("relation/12");
    expect(parks[2]?.name).toBe("Parkoviště");
  });
  it("groups cached parking by radius around each zone", () => {
    const zones = [{ id: "center", c: [18.2, 49.8] as [number, number] }];
    const grouped = parkingByZone([
      { type: "node", id: 1, lon: 18.2, lat: 49.8 },
      { type: "node", id: 2, lon: 18.3, lat: 49.8 },
    ], zones);

    expect(grouped["center"]).toHaveLength(1);
    expect(grouped["center"]?.[0]?.id).toBe("node/1");
  });
  it("stay when there is not better", () =>
    expect(standOrMove({ hereNet: 80, hereWait: 10, thereNet: 80, thereWait: 15, cycle: 20, moveKm: 3, moveMin: 8 }, S).go).toBe(false));
});
