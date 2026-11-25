import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDeliverySpotsCsv } from "@/lib/delivery-spots";

describe("parseDeliverySpotsCsv", () => {
  it("loads every supplied Ostrava location from the bundled CSV", () => {
    const csv = readFileSync(resolve("public/bolt_delivery_spoty_ostrava.csv"), "utf8");
    const spots = parseDeliverySpotsCsv(csv);

    expect(spots).toHaveLength(21);
    expect(spots.every((spot) =>
      Number.isFinite(spot.c[0]) &&
      Number.isFinite(spot.c[1]) &&
      Math.abs(spot.c[0]) <= 180 &&
      Math.abs(spot.c[1]) <= 90
    )).toBe(true);
  });

  it("parses BOM, CRLF, quoted commas, and coordinates", () => {
    const csv = "\uFEFFNázev,Adresa,Kategorie,Režim,Oblast,Latitude,Longitude\r\n" +
      '"Bod, centrum","Ulice 1, Ostrava",market,free,centrum,49.8,18.2\r\n';

    expect(parseDeliverySpotsCsv(csv)).toEqual([{
      id: "2",
      name: "Bod, centrum",
      address: "Ulice 1, Ostrava",
      category: "market",
      access: "free",
      c: [18.2, 49.8],
    }]);
  });

  it("rejects malformed or out-of-range coordinates", () => {
    const header = "Název,Adresa,Kategorie,Režim,Oblast,Latitude,Longitude\n";
    expect(() => parseDeliverySpotsCsv(`${header}Bod,Ulice,market,free,centrum,91,18.2`))
      .toThrow("Neplatná adresa nebo souřadnice na řádku 2.");
    expect(() => parseDeliverySpotsCsv(`${header}"Bod,Ulice,market,free,centrum,49.8,18.2`))
      .toThrow("CSV obsahuje neuzavřenou uvozovku.");
  });
});
