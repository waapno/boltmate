export type Settings = { fuel: number; cons: number; wear: number; tgt: number; eko: number };
export const DEFAULT_SETTINGS: Settings = { fuel: 38, cons: 7, wear: 2.5, tgt: 250, eko: 8 };

export const costPerKm = (s: Settings) => (s.fuel * s.cons) / 100 + s.wear;

export type Offer = { reward: number; km: number; driveMin: number; waitMin: number };
export function evaluate(o: Offer, s: Settings) {
  const t = o.driveMin + o.waitMin;
  const inputs = [o.reward, o.km, o.driveMin, o.waitMin, s.fuel, s.cons, s.wear, s.tgt, s.eko];
  if (
    !inputs.every(Number.isFinite) ||
    o.reward <= 0 ||
    o.km <= 0 ||
    o.driveMin < 0 ||
    o.waitMin < 0 ||
    t <= 0 ||
    s.fuel < 0 ||
    s.cons < 0 ||
    s.wear < 0 ||
    s.tgt < 0 ||
    s.eko < 0
  ) return null;
  const net = o.reward - o.km * costPerKm(s);
  const perHour = net / (t / 60);
  const perKm = net / o.km;
  return {
    net, perHour, perKm, movingShare: o.driveMin / t,
    eco: perKm >= s.eko && perHour >= s.tgt * 0.6,
    max: perHour >= s.tgt,
    smart: perHour >= s.tgt || (perKm >= s.eko && perHour >= s.tgt * 0.8),
  };
}

/** Minutes until moving pays off; null = stay (no gain). */
export function standOrMove(p: {
  hereNet: number; hereWait: number; thereNet: number; thereWait: number;
  cycle: number; moveKm: number; moveMin: number;
}, s: Settings) {
  const hh = (p.hereNet / (p.hereWait + p.cycle)) * 60;
  const th = (p.thereNet / (p.thereWait + p.cycle)) * 60;
  const cost = p.moveKm * costPerKm(s) + (p.moveMin * hh) / 60;
  const d = th - hh;
  const payback = d <= 0 ? null : (cost / d) * 60;
  return { hh, th, cost, payback, go: payback !== null && payback <= 60 };
}

export const haversine = (a: [number, number], b: [number, number]) => {
  const r = (x: number) => (x * Math.PI) / 180, R = 6371;
  const dl = r(b[1] - a[1]), dn = r(b[0] - a[0]);
  const q = Math.sin(dl / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
};

export type ParkingTags = { access?: string; fee?: string; parking?: string; capacity?: string; lit?: string; supervised?: string; surveillance?: string; maxstay?: string; name?: string };
export type ParkingPoint = {
  id: string;
  c: [number, number];
  score: number;
  name: string;
  tags: ParkingTags;
  source: "osm" | "city" | "both";
  facilityId?: string;
  capacity?: number;
  available?: number;
  occupancy?: number;
  observedAt?: string;
  officialUrl?: string;
  isAccessibleForFree?: boolean;
  subscribersOnly?: boolean;
};

export type CityParkingFacility = {
  id: string;
  c: [number, number];
  name: string;
  capacity?: number;
  available?: number;
  occupancy?: number;
  observedAt?: string;
  url?: string;
  isAccessibleForFree?: boolean;
  subscribersOnly?: boolean;
};

const parkingTagKeys = [
  "access",
  "fee",
  "parking",
  "capacity",
  "lit",
  "supervised",
  "surveillance",
  "maxstay",
  "name",
] as const satisfies readonly (keyof ParkingTags)[];

export function parseParkingElements(elements: unknown): ParkingPoint[] {
  if (!Array.isArray(elements)) return [];

  return elements.flatMap((element): ParkingPoint[] => {
    if (!element || typeof element !== "object" || Array.isArray(element)) return [];
    const raw = element as Record<string, unknown>;
    const type = raw["type"];
    const id = raw["id"];
    if (
      (type !== "node" && type !== "way" && type !== "relation") ||
      typeof id !== "number" ||
      !Number.isSafeInteger(id)
    ) {
      return [];
    }

    const rawCenter = raw["center"];
    const center =
      rawCenter && typeof rawCenter === "object"
        ? (rawCenter as Record<string, unknown>)
        : null;
    const hasCoordinates = typeof raw["lon"] === "number" && typeof raw["lat"] === "number";
    const lon = hasCoordinates ? raw["lon"] : center?.["lon"];
    const lat = hasCoordinates ? raw["lat"] : center?.["lat"];
    if (
      typeof lon !== "number" ||
      typeof lat !== "number" ||
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      Math.abs(lon) > 180 ||
      Math.abs(lat) > 90
    ) {
      return [];
    }

    const rawTagsValue = raw["tags"];
    const rawTags =
      rawTagsValue && typeof rawTagsValue === "object" && !Array.isArray(rawTagsValue)
        ? (rawTagsValue as Record<string, unknown>)
        : {};
    const tags: ParkingTags = {};
    for (const key of parkingTagKeys) {
      if (typeof rawTags[key] === "string") tags[key] = rawTags[key];
    }

    return [{
      id: `${type}/${id}`,
      c: [lon, lat],
      score: parkingScore(tags),
      name: tags.name ?? (tags.parking === "multi-storey" ? "Parkovací dům" : "Parkoviště"),
      tags,
      source: "osm",
    }];
  });
}

export function parseCityParkingFacilities(value: unknown): CityParkingFacility[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): CityParkingFacility[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const id = raw["identifier"];
    const name = raw["name"];
    const geo = raw["geo"];
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > 120 ||
      typeof name !== "string" ||
      name.length === 0 ||
      !geo ||
      typeof geo !== "object" ||
      Array.isArray(geo)
    ) return [];

    const location = geo as Record<string, unknown>;
    const latitude = location["latitude"];
    const longitude = location["longitude"];
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) return [];

    const capacity = raw["totalSpotNumber"];
    const available = raw["availableSpotNumber"];
    const dateObserved = raw["dateObserved"];
    const url = raw["url"];
    const isAccessibleForFree = raw["isAccessibleForFree"];
    const subscribersOnly = raw["subscribersOnly"];
    const validCapacity = typeof capacity === "number" && Number.isFinite(capacity) && capacity > 0
      ? capacity
      : undefined;
    const validAvailable = typeof available === "number" &&
        Number.isFinite(available) &&
        available >= 0 &&
        (validCapacity === undefined || available <= validCapacity)
      ? available
      : undefined;
    const observedAt = typeof dateObserved === "string" && Number.isFinite(Date.parse(dateObserved))
      ? dateObserved
      : undefined;
    const safeUrl = typeof url === "string" && /^https:\/\/ostravaparkovani\.cz\//i.test(url)
      ? url
      : undefined;

    return [{
      id,
      c: [longitude, latitude],
      name,
      ...(validCapacity === undefined ? {} : { capacity: validCapacity }),
      ...(validAvailable === undefined ? {} : { available: validAvailable }),
      ...(validCapacity === undefined || validAvailable === undefined
        ? {}
        : { occupancy: Math.round(((validCapacity - validAvailable) / validCapacity) * 100) }),
      ...(observedAt === undefined ? {} : { observedAt }),
      ...(safeUrl === undefined ? {} : { url: safeUrl }),
      ...(typeof isAccessibleForFree === "boolean" ? { isAccessibleForFree } : {}),
      ...(typeof subscribersOnly === "boolean" ? { subscribersOnly } : {}),
    }];
  });
}

export function parkingByZone(
  elements: unknown,
  zones: readonly { id: string; c: [number, number] }[],
  radiusKm = 0.7,
  cityFacilities: unknown = [],
): Record<string, ParkingPoint[]> {
  const parks = parseParkingElements(elements);
  const facilities = parseCityParkingFacilities(cityFacilities);
  const merged = [...parks];

  for (const facility of facilities) {
    const nearestIndex = merged.reduce<number | null>((nearest, park, index) => {
      if (park.source !== "osm") return nearest;
      if (nearest === null) return haversine(park.c, facility.c) <= 0.035 ? index : null;
      return haversine(park.c, facility.c) < haversine(merged[nearest]!.c, facility.c)
        ? index
        : nearest;
    }, null);
    const cityTags: ParkingTags = {
      name: facility.name,
      ...(facility.capacity === undefined ? {} : { capacity: String(facility.capacity) }),
      ...(facility.isAccessibleForFree === undefined ? {} : { fee: facility.isAccessibleForFree ? "no" : "yes" }),
      ...(facility.subscribersOnly ? { access: "customers_only" } : {}),
    };
    const cityScore = parkingScore(cityTags);
    const cityData = {
      facilityId: facility.id,
      ...(facility.capacity === undefined ? {} : { capacity: facility.capacity }),
      ...(facility.available === undefined ? {} : { available: facility.available }),
      ...(facility.occupancy === undefined ? {} : { occupancy: facility.occupancy }),
      ...(facility.observedAt === undefined ? {} : { observedAt: facility.observedAt }),
      ...(facility.url === undefined ? {} : { officialUrl: facility.url }),
      ...(facility.isAccessibleForFree === undefined ? {} : { isAccessibleForFree: facility.isAccessibleForFree }),
      ...(facility.subscribersOnly === undefined ? {} : { subscribersOnly: facility.subscribersOnly }),
    };

    if (nearestIndex === null) {
      merged.push({
        id: `city:${facility.id}`,
        c: facility.c,
        score: cityScore,
        name: facility.name,
        tags: cityTags,
        source: "city",
        ...cityData,
      });
      continue;
    }

    const osm = merged[nearestIndex]!;
    const mergedTags: ParkingTags = {
      ...osm.tags,
      name: facility.name,
      ...(cityTags.capacity ?? osm.tags.capacity ? { capacity: cityTags.capacity ?? osm.tags.capacity } : {}),
      ...(osm.tags.fee ?? cityTags.fee ? { fee: osm.tags.fee ?? cityTags.fee } : {}),
      ...(facility.subscribersOnly ? { access: "customers_only" } : {}),
    };
    merged[nearestIndex] = {
      ...osm,
      c: facility.c,
      score: facility.subscribersOnly ? 0 : parkingScore(mergedTags),
      name: facility.name,
      tags: mergedTags,
      source: "both",
      ...cityData,
    };
  }

  return Object.fromEntries(zones.map((zone) => [
    zone.id,
    merged
      .filter((park) => haversine(park.c, zone.c) <= radiusKm)
      .sort((a, b) => {
        const priority = (park: ParkingPoint) =>
          park.score -
          haversine(park.c, zone.c) * 20 +
          (park.occupancy === undefined ? 0 : (100 - park.occupancy) * 0.1);
        return priority(b) - priority(a);
      }),
  ]));
}

/** 0–100 score: how safe & easy it is for a courier to stop here. */
export function parkingScore(t: ParkingTags) {
  if (t.access === "private" || t.access === "no" || t.access === "customers_only") return 0;
  let s = 40;
  if (t.fee === "no") s += 20; else if (t.fee === "yes") s -= 10;
  if (t.parking === "multi-storey" || t.parking === "underground") s += 15;
  if (t.parking === "surface") s += 10;
  if (t.parking === "street_side" || t.parking === "lane") s -= 5;
  const cap = parseInt(t.capacity ?? "", 10);
  if (cap >= 100) s += 15; else if (cap >= 20) s += 8;
  if (t.lit === "yes") s += 5;
  if (t.supervised === "yes" || t.surveillance) s += 5;
  if (t.maxstay) s -= 3;
  return Math.max(0, Math.min(100, s));
}

export function rankParkingForCourier(
  parks: readonly ParkingPoint[],
  origin: [number, number] | null,
): ParkingPoint[] {
  const isFree = (park: ParkingPoint) => park.isAccessibleForFree ?? park.tags.fee === "no";
  return parks
    .filter((park) => park.score > 0 && !park.subscribersOnly)
    .slice()
    .sort((a, b) => {
      const byNotFull = Number(b.available !== 0) - Number(a.available !== 0);
      if (byNotFull) return byNotFull;
      const byFree = Number(isFree(b)) - Number(isFree(a));
      if (byFree) return byFree;
      const byKnownAvailability = Number(b.available !== undefined) - Number(a.available !== undefined);
      if (byKnownAvailability) return byKnownAvailability;
      const byOccupancy = (a.occupancy ?? 50) - (b.occupancy ?? 50);
      if (byOccupancy) return byOccupancy;
      const byDistance = origin ? haversine(a.c, origin) - haversine(b.c, origin) : 0;
      return byDistance || b.score - a.score;
    });
}

export type ZoneShiftEntry = {
  zoneId?: string;
  net: number;
  mov: number;
  wait: number;
};

export function estimateZonePerformance(
  entries: readonly ZoneShiftEntry[],
  zoneId: string,
  priorNetPerHour: number,
) {
  const relevant = entries.filter((entry) =>
    entry.zoneId === zoneId &&
    Number.isFinite(entry.net) &&
    Number.isFinite(entry.mov) &&
    Number.isFinite(entry.wait) &&
    entry.mov + entry.wait > 0
  );
  const minutes = relevant.reduce((total, entry) => total + entry.mov + entry.wait, 0);
  const net = relevant.reduce((total, entry) => total + entry.net, 0);
  const confidence = relevant.length / (relevant.length + 2);
  const observedNetPerHour = minutes > 0 ? (net / minutes) * 60 : priorNetPerHour;
  return {
    orderCount: relevant.length,
    observedMinutes: minutes,
    netPerHour: observedNetPerHour * confidence + priorNetPerHour * (1 - confidence),
    ordersPerHour: minutes > 0 ? (relevant.length / minutes) * 60 : 0,
  };
}
