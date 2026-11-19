import { createFileRoute } from "@tanstack/react-router";
import { ZONES } from "@/lib/zones";

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const CACHE_NAME = "boltmate-osm-parking-v1";
const FRESH_FOR_MS = 12 * 60 * 60 * 1000;
const CACHE_FOR_SECONDS = 30 * 24 * 60 * 60;
const QUERY = `[out:json][timeout:25];(${ZONES.map((z) => `nwr["amenity"="parking"](around:700,${z.c[1]},${z.c[0]});`).join("")});out center tags;`;

function isElementsResponse(value: unknown): value is { elements: unknown[] } {
  return value !== null && typeof value === "object" && "elements" in value && Array.isArray(value["elements"]);
}

function withHeader(response: Response, name: string, value: string) {
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

async function fetchParkingElements(): Promise<unknown[]> {
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

export const Route = createFileRoute("/api/parking")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        url.search = "?version=1";
        const cacheKey = new Request(url);
        let cache: Cache | null = null;
        let cached: Response | undefined;

        try {
          if (typeof caches !== "undefined") {
            cache = await caches.open(CACHE_NAME);
            cached = await cache.match(cacheKey);
          }
        } catch (error) {
          console.error("Could not read the shared parking cache", error);
        }

        if (cached) {
          const fetchedAt = Date.parse(cached.headers.get("x-parking-fetched-at") ?? "");
          if (Number.isFinite(fetchedAt) && Date.now() - fetchedAt < FRESH_FOR_MS) {
            return withHeader(cached, "x-parking-cache", "hit");
          }
        }

        try {
          const elements = await fetchParkingElements();
          const fetchedAt = new Date().toISOString();
          const fresh = Response.json({ fetchedAt, elements }, {
            headers: {
              "cache-control": `public, max-age=${CACHE_FOR_SECONDS}`,
              "x-parking-fetched-at": fetchedAt,
            },
          });
          if (cache) {
            try {
              await cache.put(cacheKey, fresh.clone());
            } catch (error) {
              console.error("Could not write the shared parking cache", error);
            }
          }
          return withHeader(fresh, "x-parking-cache", "miss");
        } catch (error) {
          console.error("Could not refresh OSM parking data", error);
          if (cached) return withHeader(cached, "x-parking-stale", "true");
          return Response.json(
            { error: "OSM parking data is temporarily unavailable" },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
