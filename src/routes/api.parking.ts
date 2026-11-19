import { createFileRoute } from "@tanstack/react-router";
import { ZONES } from "@/lib/zones";

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const CITY_OPEN_DATA = "https://ostravaparkovani.cz/api/opendata/jsonld";
const CACHE_NAME = "boltmate-parking-v2";
const CACHE_FOR_SECONDS = 7 * 24 * 60 * 60;
const FRESH_FOR_MS = { osm: 12 * 60 * 60 * 1000, city: 5 * 60 * 1000 };
const QUERY = `[out:json][timeout:25];(${ZONES.map((z) => `nwr["amenity"="parking"](around:700,${z.c[1]},${z.c[0]});`).join("")});out center tags;`;

type Dataset = "osm" | "city";
type CacheEntry = { fetchedAt: string; data: unknown[] };
type LoadedDataset = CacheEntry & { status: "fresh" | "stale" | "unavailable" };
const memoryCache = new Map<Dataset, CacheEntry>();
const inFlight = new Map<Dataset, Promise<CacheEntry>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isElementsResponse(value: unknown): value is { elements: unknown[] } {
  return isRecord(value) && Array.isArray(value["elements"]);
}

function isCityResponse(value: unknown): value is { "@graph": unknown[] } {
  return isRecord(value) && Array.isArray(value["@graph"]);
}

function isCacheEntry(value: unknown): value is CacheEntry {
  return isRecord(value) &&
    typeof value["fetchedAt"] === "string" &&
    Number.isFinite(Date.parse(value["fetchedAt"])) &&
    Array.isArray(value["data"]);
}

function cacheRequest(request: Request, dataset: Dataset) {
  const url = new URL(request.url);
  url.search = `?dataset=${dataset}&version=2`;
  return new Request(url);
}

async function readCache(
  request: Request,
  cache: Cache | null,
  dataset: Dataset,
): Promise<CacheEntry | undefined> {
  const entries = [memoryCache.get(dataset)];
  if (cache) {
    try {
      const response = await cache.match(cacheRequest(request, dataset));
      if (response) {
        const candidate: unknown = await response.json();
        if (isCacheEntry(candidate)) entries.push(candidate);
      }
    } catch (error) {
      console.error(`Could not read the ${dataset} parking cache`, error);
    }
  }
  return entries
    .filter((entry): entry is CacheEntry => entry !== undefined)
    .sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))[0];
}

async function writeCache(
  request: Request,
  cache: Cache | null,
  dataset: Dataset,
  entry: CacheEntry,
) {
  memoryCache.set(dataset, entry);
  if (!cache) return;
  try {
    await cache.put(
      cacheRequest(request, dataset),
      Response.json(entry, {
        headers: { "cache-control": `public, max-age=${CACHE_FOR_SECONDS}` },
      }),
    );
  } catch (error) {
    console.error(`Could not write the ${dataset} parking cache`, error);
  }
}

async function fetchOsmParking(): Promise<unknown[]> {
  let lastError: unknown = new Error("No Overpass mirror returned parking data");
  for (const endpoint of OVERPASS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": "MapMateNavigator/1.0 (+https://github.com/waapno/boltmate)",
        },
        body: "data=" + encodeURIComponent(QUERY),
        signal: AbortSignal.timeout(28000),
      });
      if (!response.ok) {
        lastError = new Error(`Overpass mirror returned HTTP ${response.status}`);
        continue;
      }
      const payload: unknown = await response.json();
      if (isElementsResponse(payload)) return payload.elements;
      lastError = new Error("Overpass mirror returned an invalid response");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("All Overpass mirrors failed", { cause: lastError });
}

async function fetchCityParking(): Promise<unknown[]> {
  const response = await fetch(CITY_OPEN_DATA, {
    headers: { accept: "application/ld+json, application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Ostrava open-data feed returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!isCityResponse(payload)) throw new Error("Ostrava open-data feed returned an invalid response");
  return payload["@graph"];
}

async function loadDataset(
  request: Request,
  cache: Cache | null,
  dataset: Dataset,
  fetchData: () => Promise<unknown[]>,
): Promise<LoadedDataset> {
  const previous = await readCache(request, cache, dataset);
  if (previous && Date.now() - Date.parse(previous.fetchedAt) < FRESH_FOR_MS[dataset]) {
    return { ...previous, status: "fresh" };
  }

  try {
    let refresh = inFlight.get(dataset);
    if (!refresh) {
      refresh = (async () => {
        const entry = { fetchedAt: new Date().toISOString(), data: await fetchData() };
        await writeCache(request, cache, dataset, entry);
        return entry;
      })();
      inFlight.set(dataset, refresh);
    }
    let entry: CacheEntry;
    try {
      entry = await refresh;
    } finally {
      if (inFlight.get(dataset) === refresh) inFlight.delete(dataset);
    }
    return { ...entry, status: "fresh" };
  } catch (error) {
    console.error(`Could not refresh ${dataset} parking data`, error);
    if (previous) return { ...previous, status: "stale" };
    return { fetchedAt: "", data: [], status: "unavailable" };
  }
}

export const Route = createFileRoute("/api/parking")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let cache: Cache | null = null;
        try {
          if (typeof caches !== "undefined") cache = await caches.open(CACHE_NAME);
        } catch (error) {
          console.error("Could not open the shared parking cache", error);
        }

        const [osm, city] = await Promise.all([
          loadDataset(request, cache, "osm", fetchOsmParking),
          loadDataset(request, cache, "city", fetchCityParking),
        ]);
        if (osm.status === "unavailable" && city.status === "unavailable") {
          return Response.json(
            { error: "OSM and Ostrava parking data are temporarily unavailable" },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }

        return Response.json({
          fetchedAt: new Date().toISOString(),
          elements: osm.data,
          facilities: city.data,
          sources: {
            osm: { status: osm.status, fetchedAt: osm.fetchedAt || null },
            city: { status: city.status, fetchedAt: city.fetchedAt || null },
          },
        }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
