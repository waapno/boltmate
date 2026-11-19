import { describe, expect, it } from "vitest";
import { costPerKm, evaluate, parkingByZone, parkingScore, parseCityParkingFacilities, parseParkingElements, standOrMove, DEFAULT_SETTINGS as S } from "@/lib/engine";

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
  it("parses live city capacity, including zero free spaces", () => {
    const facilities = parseCityParkingFacilities([
      {
        identifier: "lot-a",
        name: "Parkoviště A",
        geo: { latitude: 49.8, longitude: 18.2 },
        totalSpotNumber: 100,
        availableSpotNumber: 0,
        dateObserved: "2026-11-19T08:00:00Z",
        url: "https://ostravaparkovani.cz/cs/mapa?lot=lot-a",
        subscribersOnly: false,
      },
      {
        identifier: "bad",
        name: "Invalid coordinates",
        geo: { latitude: 91, longitude: 18.2 },
      },
    ]);

    expect(facilities).toHaveLength(1);
    expect(facilities[0]).toMatchObject({ id: "lot-a", capacity: 100, available: 0, occupancy: 100 });
  });
  it("merges nearby OSM and city records but retains unmatched city facilities", () => {
    const grouped = parkingByZone(
      [{ type: "node", id: 1, lon: 18.2, lat: 49.8, tags: { name: "OSM name", fee: "yes" } }],
      [{ id: "center", c: [18.2, 49.8] }],
      0.7,
      [
        {
          identifier: "matched",
          name: "City name",
          geo: { latitude: 49.8001, longitude: 18.2001 },
          totalSpotNumber: 20,
          availableSpotNumber: 10,
        },
        {
          identifier: "city-only",
          name: "City only",
          geo: { latitude: 49.805, longitude: 18.2 },
        },
      ],
    );

    expect(grouped["center"]).toHaveLength(2);
    expect(grouped["center"]?.find((park) => park.facilityId === "matched")).toMatchObject({
      id: "node/1",
      name: "City name",
      source: "both",
      occupancy: 50,
    });
    expect(grouped["center"]?.some((park) => park.id === "city:city-only")).toBe(true);
  });
  it("stay when there is not better", () =>
    expect(standOrMove({ hereNet: 80, hereWait: 10, thereNet: 80, thereWait: 15, cycle: 20, moveKm: 3, moveMin: 8 }, S).go).toBe(false));
});
