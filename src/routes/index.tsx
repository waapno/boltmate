import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { DEFAULT_SETTINGS, costPerKm, evaluate, haversine, parkingByZone as groupParkingByZone, standOrMove, type ParkingTags, type Settings } from "@/lib/engine";
import { ZONES, zoneScoreAt } from "@/lib/zones";
import type { ParkPt } from "@/components/MapView";

const MapView = lazy(() => import("@/components/MapView"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kurýr Ostrava – HUD mapa a router" },
      { name: "description", content: "Mapový HUD pro kurýra v Ostravě: hotspoty podle hodiny, bezpečné parkování z OSM, výpočet čistého zisku a rada stát nebo jet." },
      { property: "og:title", content: "Kurýr Ostrava – HUD mapa a router" },
      { property: "og:description", content: "Hotspoty, skóre parkování, čistý zisk za hodinu a poloautomatické doporučení trasy." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Park = ParkPt & { tags: ParkingTags };
type ParkingData = { elements: unknown[]; facilities: unknown[] };
type ParkingSource = { status: "fresh" | "stale" | "unavailable"; fetchedAt: string | null };
type LogItem = { net: number; km: number; mov: number; wait: number; t: number };
const PARKING_STORAGE_KEY = "kp-parking-cache-v2";
const LEGACY_PARKING_STORAGE_KEY = "kp-osm-cache-v1";
const TABS = ["Teď", "Nabídka", "Parkování", "Směna"] as const;

const nav = (c: [number, number]) => ({
  mapy: `https://mapy.cz/fnc/v1/route?end=${c[0]},${c[1]}&routeType=car_fast`,
  google: `https://www.google.com/maps/dir/?api=1&destination=${c[1]},${c[0]}&travelmode=driving`,
  waze: `https://waze.com/ul?ll=${c[1]},${c[0]}&navigate=yes`,
});
const f = (x: number, d = 0) => (isFinite(x) ? x.toFixed(d) : "–");

function getParkingData(value: unknown): ParkingData {
  if (!value || typeof value !== "object" || !("elements" in value) || !Array.isArray(value["elements"])) {
    throw new Error("Invalid parking data response");
  }
  const facilities = "facilities" in value && Array.isArray(value["facilities"])
    ? value["facilities"]
    : [];
  return { elements: value["elements"], facilities };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getParkingSources(value: unknown): { osm: ParkingSource; city: ParkingSource } | null {
  if (!isRecord(value) || !isRecord(value["sources"])) return null;
  const sources = value["sources"];
  const getSource = (key: "osm" | "city"): ParkingSource => {
    const source = isRecord(sources[key]) ? sources[key] : null;
    const status = source?.["status"];
    const fetchedAt = source?.["fetchedAt"];
    return {
      status: status === "fresh" || status === "stale" || status === "unavailable" ? status : "fresh",
      fetchedAt: typeof fetchedAt === "string" ? fetchedAt : null,
    };
  };
  return { osm: getSource("osm"), city: getSource("city") };
}

function useStored<T>(key: string, init: T) {
  const [v, setV] = useState<T>(init);
  useEffect(() => { try { const s = localStorage.getItem(key); if (s) setV(JSON.parse(s)); } catch { /* ignore */ } }, [key]);
  const set = (n: T) => { setV(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* ignore */ } };
  return [v, set] as const;
}

function Index() {
  const [S, setS] = useStored<Settings>("ks", DEFAULT_SETTINGS);
  const [log, setLog] = useStored<LogItem[]>("kl", []);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Teď");
  const [now, setNow] = useState<Date | null>(null);
  const [me, setMe] = useState<[number, number] | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [limit, setLimit] = useState(50);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [parkingData, setParkingData] = useState<ParkingData>({ elements: [], facilities: [] });
  const [parkingSources, setParkingSources] = useState<{ osm: ParkingSource; city: ParkingSource } | null>(null);
  const [parkSel, setParkSel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [auto, setAuto] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hudOpen, setHudOpen] = useState(false);

  useEffect(() => { setNow(new Date()); const i = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(i); }, []);
  useEffect(() => {
    const interval = setInterval(() => setRefreshKey((key) => key + 1), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let savedData: ParkingData = { elements: [], facilities: [] };
    try {
      const saved = localStorage.getItem(PARKING_STORAGE_KEY) ?? localStorage.getItem(LEGACY_PARKING_STORAGE_KEY);
      if (saved) {
        const savedPayload: unknown = JSON.parse(saved);
        savedData = getParkingData(savedPayload);
        setParkingData(savedData);
      }
    } catch (error) {
      console.error("Could not load saved parking coordinates", error);
    }

    async function refresh() {
      setLoading(true);
      setErr(null);
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}api/parking`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Parking API returned HTTP ${response.status}`);
        const payload: unknown = await response.json();
        const receivedData = getParkingData(payload);
        const sources = getParkingSources(payload);
        const nextData = {
          elements: sources?.osm.status === "unavailable" ? savedData.elements : receivedData.elements,
          facilities: sources?.city.status === "unavailable" ? savedData.facilities : receivedData.facilities,
        };
        if (!active) return;
        setParkingData(nextData);
        setParkingSources(sources);
        try {
          localStorage.setItem(PARKING_STORAGE_KEY, JSON.stringify(nextData));
        } catch (error) {
          console.error("Could not save parking coordinates for offline use", error);
        }
        if (sources && (sources.osm.status !== "fresh" || sources.city.status !== "fresh")) {
          setErr("Některá parkovací data nejsou aktuální; zobrazuji poslední uložené údaje.");
        }
      } catch (error) {
        if (controller.signal.aborted || !active) return;
        console.error("Could not refresh parking data", error);
        setErr("Parkoviště se nepodařilo obnovit. Zobrazuji uložená data, pokud jsou dostupná.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void refresh();
    return () => {
      active = false;
      controller.abort();
    };
  }, [refreshKey]);

  const hour = now?.getHours() ?? 12;
  const cpk = costPerKm(S);
  const parkingByZone = useMemo(
    () => groupParkingByZone(parkingData.elements, ZONES, 0.7, parkingData.facilities),
    [parkingData],
  );

  // Smart ranking: demand by hour minus cost of getting there from GPS position
  const ranked = useMemo(() => ZONES.map((z) => {
    const demand = zoneScoreAt(z, hour);
    const km = me ? haversine(me, z.c) * 1.3 : 0; // 1.3 ≈ road detour factor
    const value = demand * S.tgt - km * cpk * 2; // Kč/h-like index
    return { ...z, demand, km, value };
  }).sort((a, b) => b.value - a.value), [hour, me, S.tgt, cpk]);

  const zone = ZONES.find((z) => z.id === zoneId) ?? null;
  const parks = zoneId ? parkingByZone[zoneId] ?? [] : [];
  const allParks = useMemo(
    () => [...new Map(Object.values(parkingByZone).flat().map((p) => [p.id, p])).values()],
    [parkingByZone],
  );
  const park = allParks.find((p) => p.id === parkSel) ?? null;
  const target = park?.c ?? zone?.c ?? null;

  function loadParking(id: string) {
    const z = ZONES.find((x) => x.id === id)!;
    setZoneId(id);
    setFocus(z.c);
    setErr(null);
    setParkSel(null);
  }

  useEffect(() => {
    if (!auto || !zoneId || parkSel) return;
    const best = (parkingByZone[zoneId] ?? []).find((p) => p.score > 0);
    if (best) {
      setParkSel(best.id);
      setFocus(best.c);
    }
  }, [auto, zoneId, parkSel, parkingByZone]);

  function gps() {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition((p) => {
      setMe([p.coords.longitude, p.coords.latitude]);
      setSpeed(p.coords.speed != null ? p.coords.speed * 3.6 : null);
    }, () => setErr("GPS nepovolena."), { enableHighAccuracy: true });
  }

  const tot = log.reduce((a, x) => ({ net: a.net + x.net, km: a.km + x.km, m: a.m + x.mov, w: a.w + x.wait }), { net: 0, km: 0, m: 0, w: 0 });
  const shiftPh = tot.net / ((tot.m + tot.w) / 60);
  const best = ranked[0]!;
  const over = speed != null && speed > limit;

  return (
    <main data-hud-open={hudOpen} className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      <ClientOnly fallback={<div className="absolute inset-0 grid place-items-center hud-label">Načítám mapu…</div>}>
        <Suspense fallback={null}>
          <MapView zones={ranked.map((z) => ({ id: z.id, name: z.name, c: z.c, score: z.demand }))} parking={allParks} me={me} target={target}
            focus={focus} onPark={(id) => { setParkSel(id); setTab("Parkování"); }} onZone={(id) => { setTab("Parkování"); loadParking(id); }} />
        </Suspense>
      </ClientOnly>

      {/* HUD top strip */}
      <header className="mobile-hud-header pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-stretch gap-2 p-3">
        <div className="hud-panel pointer-events-auto px-4 py-2">
          <div className="hud-label">Kurýr · Ostrava</div>
          <div className="font-display text-lg leading-tight">{now ? now.toLocaleTimeString("cs", { hour: "2-digit", minute: "2-digit" }) : "--:--"}</div>
        </div>
        <button onClick={gps} className={`hud-panel pointer-events-auto px-4 py-2 text-left ${over ? "hud-alert" : ""}`}>
          <div className="hud-label">{speed == null ? "GPS · klepni" : `limit ${limit}`}</div>
          <div className="hud-value">{speed == null ? "—" : Math.round(speed)}<span className="hud-unit"> km/h</span></div>
        </button>
        <button
          type="button"
          aria-expanded={hudOpen}
          aria-controls="map-hud-panel"
          onClick={() => setHudOpen((open) => !open)}
          className="mobile-hud-toggle hud-panel pointer-events-auto"
        >
          {hudOpen ? "Skrýt HUD" : "Ovládání"}
        </button>
        <div className="mobile-hud-detail hud-panel px-4 py-2">
          <div className="hud-label">Směna Kč/h</div>
          <div className={`hud-value ${shiftPh >= S.tgt ? "text-primary" : "text-warning"}`}>{log.length ? f(shiftPh) : "—"}</div>
        </div>
        <div className="mobile-hud-detail hud-panel px-4 py-2">
          <div className="hud-label">Náklad / km</div>
          <div className="hud-value">{f(cpk, 2)}<span className="hud-unit"> Kč</span></div>
        </div>
        <div className="mobile-hud-detail hud-panel px-3 py-2">
          <div className="hud-label mb-1">Poptávka {hour}:00</div>
          <div className="flex items-center gap-2 text-xs"><span className="legend-dot bg-zone-low" />nízká<span className="legend-dot bg-zone-mid" />střední<span className="legend-dot bg-zone-high" />špička</div>
          <div className="mt-1 flex items-center gap-2 text-xs"><span className="legend-dot bg-primary" />P bezpečné<span className="legend-dot bg-warning" />OK<span className="legend-dot bg-destructive" />riziko</div>
          <div className="mt-1 flex items-center gap-2 text-xs"><span className="font-mono">M</span><span className="legend-dot bg-primary" />&lt;50%<span className="legend-dot bg-warning" />50–84%<span className="legend-dot bg-destructive" />85%+ obsazeno</div>
        </div>
      </header>

      {/* Control panel */}
      <aside id="map-hud-panel" className="mobile-hud-panel hud-panel absolute inset-x-3 bottom-3 z-10 flex max-h-[52dvh] flex-col md:inset-x-auto md:bottom-auto md:left-3 md:top-28 md:max-h-[calc(100dvh-8rem)] md:w-[380px]">
        <nav className="flex border-b border-border">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`hud-tab ${tab === t ? "hud-tab-on" : ""}`}>{t}</button>
          ))}
        </nav>
        <div className="overflow-y-auto p-4 text-sm">
          {tab === "Teď" && (
            <div className="space-y-3">
              <div className="hud-label">Doporučení · {me ? "podle tvé polohy" : "bez GPS, jen poptávka"}</div>
              <div className="rounded-md border border-primary/40 bg-primary/10 p-3">
                <div className="flex items-center gap-2 font-display text-xl">
                  <DemandDot score={best.demand} />
                  {best.name}
                </div>
                <div className="text-muted-foreground">{best.note}</div>
                <div className="mt-2 flex gap-4 font-mono text-xs">
                  <span>poptávka {f(best.demand * 100)}%</span>{me && <span>{f(best.km, 1)} km · {f(best.km * cpk)} Kč</span>}
                </div>
                <button className="hud-btn mt-3 w-full" onClick={() => { setTab("Parkování"); loadParking(best.id); }}>Najít bezpečné stání →</button>
              </div>
              <ol className="space-y-1">
                {ranked.slice(1).map((z, i) => (
                  <li key={z.id}>
                    <button onClick={() => { setTab("Parkování"); loadParking(z.id); }} className="hud-row w-full">
                      <span className="font-mono text-muted-foreground">{i + 2}</span>
                      <DemandDot score={z.demand} />
                      <span className="flex-1 text-left">{z.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{f(z.demand * 100)}%</span>
                    </button>
                  </li>
                ))}
              </ol>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Poloautomat: rovnou vybrat nejlepší parkoviště
              </label>
              {!me && <button onClick={gps} className="hud-btn-ghost w-full">Zapnout GPS pro přesnější pořadí</button>}
            </div>
          )}

          {tab === "Nabídka" && <OfferTab S={S} setS={setS} onSave={(x) => setLog([...log, x])} />}

          {tab === "Parkování" && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1">
                {ZONES.map((z) => (
                  <button key={z.id} onClick={() => loadParking(z.id)} className={`hud-chip ${zoneId === z.id ? "hud-chip-on" : ""}`}>{z.name}</button>
                ))}
              </div>
              {loading && <div className="hud-label animate-pulse">Aktualizuji OSM a městská data parkovišť…</div>}
              {err && (
                <div className="space-y-2 text-destructive">
                  <p>{err}</p>
                  <button className="hud-btn-ghost w-full" onClick={() => setRefreshKey((key) => key + 1)}>Zkusit aktualizovat</button>
                </div>
              )}
              {!loading && !err && (
                <p className="text-xs text-muted-foreground">
                  Souřadnice jsou uložené v telefonu. Obsazenost se aktualizuje online; při výpadku uvidíš poslední dostupnou hodnotu. Offline mapu je nutné stáhnout zvlášť.
                  {parkingSources && <> Data města: {parkingSourceLabel(parkingSources.city)}.</>}
                </p>
              )}
              {park && (
                <div className="rounded-md border border-border bg-secondary p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-display text-lg">{park.name}</div>
                    <div className="flex items-center gap-2">
                      <ParkingSourceBadge source={park.source} />
                      {park.source !== "city" && <ScoreBadge s={park.score} />}
                    </div>
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {[park.tags.parking, park.tags.fee === "no" ? "zdarma" : park.tags.fee === "yes" ? "placené" : "poplatek ?", park.capacity === undefined && park.tags.capacity && `${park.tags.capacity} míst`, park.tags.maxstay && `max ${park.tags.maxstay}`, park.tags.lit === "yes" && "osvětlené", park.subscribersOnly && "jen pro předplatitele"].filter(Boolean).join(" · ")}
                    {zone && <> · {f(haversine(park.c, zone.c) * 1000)} m od centra zóny</>}
                  </div>
                  <ParkingAvailability park={park} />
                  {park.officialUrl && (
                    <a href={park.officialUrl} target="_blank" rel="noopener" className="mt-2 inline-block text-xs text-primary underline">
                      Aktuální informace provozovatele
                    </a>
                  )}
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {Object.entries(nav(park.c)).map(([k, u]) => <a key={k} href={u} target="_blank" rel="noopener" className="hud-btn text-center capitalize">{k}</a>)}
                  </div>
                </div>
              )}
              <ul className="space-y-1">
                {parks.slice(0, 12).map((p) => (
                  <li key={p.id}>
                    <button onClick={() => { setParkSel(p.id); setFocus(p.c); }} className={`hud-row w-full ${p.id === parkSel ? "border-primary" : ""}`}>
                      {p.source !== "city" && <ScoreBadge s={p.score} />}
                      <span className="flex-1 truncate text-left">{p.name}</span>
                      {p.available !== undefined && <span className="font-mono text-xs text-primary">{p.available}{p.capacity === undefined ? " volných" : `/${p.capacity}`}</span>}
                      {p.source !== "osm" && <ParkingSourceBadge source={p.source} />}
                      {zone && <span className="font-mono text-xs text-muted-foreground">{f(haversine(p.c, zone.c) * 1000)} m</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {!zoneId && <p className="text-muted-foreground">Vyber zónu nebo klepni na bod v mapě.</p>}
              <p className="text-xs text-muted-foreground">Body M používají aktuální obsazenost z otevřených dat Ostravy (zelená: méně než 50 % obsazeno, žlutá: 50–84 %, červená: 85 % a více). Body P používají orientační skóre OSM. Značení na místě má vždy přednost.</p>
            </div>
          )}

          {tab === "Směna" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Stat l="Zakázek" v={String(log.length)} /><Stat l="Čistý zisk" v={`${f(tot.net)} Kč`} />
                <Stat l="Kč/h" v={log.length ? f(shiftPh) : "—"} /><Stat l="V pohybu" v={log.length ? `${f((tot.m / (tot.m + tot.w)) * 100)} %` : "—"} />
              </div>
              <StandMove S={S} />
              <label className="block"><span className="hud-label">Rychlostní limit pro HUD</span>
                <input className="hud-input" type="number" value={limit} onChange={(e) => setLimit(+e.target.value || 50)} /></label>
              <button className="hud-btn-ghost w-full" onClick={() => setLog([])}>Vynulovat směnu</button>
              <p className="text-xs text-muted-foreground">Za jízdy telefon do držáku. Rada je odhad, ne pokyn.</p>
            </div>
          )}
        </div>
      </aside>
    </main>
  );
}

function ScoreBadge({ s }: { s: number }) {
  const c = s >= 65 ? "bg-primary text-primary-foreground" : s >= 45 ? "bg-warning text-background" : "bg-destructive text-destructive-foreground";
  return <span className={`inline-grid h-7 w-9 place-items-center rounded font-mono text-xs font-bold ${c}`}>{s}</span>;
}
function ParkingSourceBadge({ source }: { source: Park["source"] }) {
  const label = source === "city" ? "M" : source === "both" ? "M+OSM" : "OSM";
  return <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{label}</span>;
}
function ParkingAvailability({ park }: { park: Park }) {
  if (park.available === undefined && park.capacity === undefined) return null;
  const color = park.occupancy === undefined ? "bg-muted-foreground" : park.occupancy < 50 ? "bg-primary" : park.occupancy < 85 ? "bg-warning" : "bg-destructive";
  const count = park.available === undefined
    ? `${park.capacity} míst celkem`
    : park.capacity === undefined
      ? `${park.available} volných míst`
      : park.available === 0
        ? `Plno · 0 z ${park.capacity} volných`
        : `${park.available} volných z ${park.capacity} míst`;
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <span className={`legend-dot ${color}`} />
      <span>{count}</span>
      {park.occupancy !== undefined && <span className="font-mono text-muted-foreground">· {park.occupancy}% obsazeno</span>}
      {park.observedAt && <span className="ml-auto text-muted-foreground">{new Date(park.observedAt).toLocaleTimeString("cs", { hour: "2-digit", minute: "2-digit" })}</span>}
    </div>
  );
}
function parkingSourceLabel(source: ParkingSource) {
  if (source.status === "unavailable") return "nedostupná";
  const time = source.fetchedAt ? new Date(source.fetchedAt).toLocaleTimeString("cs", { hour: "2-digit", minute: "2-digit" }) : "";
  return `${source.status === "stale" ? "uložená" : "aktuální"}${time ? ` k ${time}` : ""}`;
}
function DemandDot({ score }: { score: number }) {
  const level = score <= 0.25 ? "nízká" : score <= 0.6 ? "střední" : "špička";
  const color = score <= 0.25 ? "bg-zone-low" : score <= 0.6 ? "bg-zone-mid" : "bg-zone-high";
  return <span role="img" aria-label={`${level} poptávka`} className={`legend-dot shrink-0 ${color}`} />;
}
const Stat = ({ l, v }: { l: string; v: string }) => (
  <div className="rounded-md border border-border bg-secondary p-2"><div className="hud-label">{l}</div><div className="font-display text-lg">{v}</div></div>
);
function Num({ l, v, set, step = 1 }: { l: string; v: number; set: (n: number) => void; step?: number }) {
  return <label className="block"><span className="hud-label">{l}</span><input className="hud-input" type="number" inputMode="decimal" step={step} value={v || ""} onChange={(e) => set(parseFloat(e.target.value) || 0)} /></label>;
}

function OfferTab({ S, setS, onSave }: { S: Settings; setS: (s: Settings) => void; onSave: (x: LogItem) => void }) {
  const [o, setO] = useState({ reward: 0, pk: 0, dk: 0, driveMin: 0, waitMin: 5 });
  const r = evaluate({ reward: o.reward, km: o.pk + o.dk, driveMin: o.driveMin, waitMin: o.waitMin }, S);
  const set = (k: keyof typeof o) => (n: number) => setO({ ...o, [k]: n });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Num l="Odměna Kč" v={o.reward} set={set("reward")} /><Num l="Jízda celkem min" v={o.driveMin} set={set("driveMin")} />
        <Num l="K restauraci km" v={o.pk} set={set("pk")} step={0.1} /><Num l="K zákazníkovi km" v={o.dk} set={set("dk")} step={0.1} />
        <Num l="Čekání min" v={o.waitMin} set={set("waitMin")} />
      </div>
      {r ? (
        <>
          <div className="grid grid-cols-3 gap-2"><Stat l="Čistý" v={`${f(r.net)} Kč`} /><Stat l="Kč/h" v={f(r.perHour)} /><Stat l="Kč/km" v={f(r.perKm, 1)} /></div>
          <div className="grid grid-cols-3 gap-2">
            {(["eco", "max", "smart"] as const).map((k) => (
              <div key={k} className={`rounded-md p-2 text-center font-mono text-xs font-bold uppercase ${r[k] ? "bg-primary text-primary-foreground" : "bg-destructive/20 text-destructive"}`}>{k}<br />{r[k] ? "vzít" : "ne"}</div>
            ))}
          </div>
          <button className="hud-btn w-full" onClick={() => onSave({ net: r.net, km: o.pk + o.dk, mov: o.driveMin, wait: o.waitMin, t: Date.now() })}>Uložit do směny</button>
        </>
      ) : <p className="text-muted-foreground">Zadej odměnu, km a minuty.</p>}
      <details className="rounded-md border border-border p-2">
        <summary className="hud-label cursor-pointer">Nastavení auta (odhad, přepiš)</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Num l="Benzin Kč/l" v={S.fuel} set={(n) => setS({ ...S, fuel: n })} step={0.1} />
          <Num l="Spotřeba l/100" v={S.cons} set={(n) => setS({ ...S, cons: n })} step={0.1} />
          <Num l="Opotřebení Kč/km" v={S.wear} set={(n) => setS({ ...S, wear: n })} step={0.1} />
          <Num l="Cíl Kč/h" v={S.tgt} set={(n) => setS({ ...S, tgt: n })} />
          <Num l="ECO min Kč/km" v={S.eko} set={(n) => setS({ ...S, eko: n })} step={0.5} />
        </div>
      </details>
    </div>
  );
}

function StandMove({ S }: { S: Settings }) {
  const [p, setP] = useState({ hereNet: 0, hereWait: 0, thereNet: 0, thereWait: 0, cycle: 20, moveKm: 0, moveMin: 0 });
  const set = (k: keyof typeof p) => (n: number) => setP({ ...p, [k]: n });
  const r = p.hereNet && p.thereNet ? standOrMove(p, S) : null;
  return (
    <details className="rounded-md border border-border p-2" open>
      <summary className="hud-label cursor-pointer">Stát, nebo jet jinam?</summary>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Num l="Tady čistý/zak." v={p.hereNet} set={set("hereNet")} /><Num l="Tady čekání min" v={p.hereWait} set={set("hereWait")} />
        <Num l="Tam čistý/zak." v={p.thereNet} set={set("thereNet")} /><Num l="Tam čekání min" v={p.thereWait} set={set("thereWait")} />
        <Num l="Přesun km" v={p.moveKm} set={set("moveKm")} step={0.1} /><Num l="Přesun min" v={p.moveMin} set={set("moveMin")} />
      </div>
      {r && <p className="mt-2">Tady <b>{f(r.hh)}</b> Kč/h, tam <b>{f(r.th)}</b>. Přesun ≈ {f(r.cost)} Kč. {r.payback === null ? <b className="text-primary">Zůstaň.</b> : <>Návratnost {f(r.payback)} min — <b className={r.go ? "text-primary" : "text-destructive"}>{r.go ? "Jeď." : "Nevyplatí se."}</b></>}</p>}
    </details>
  );
}
