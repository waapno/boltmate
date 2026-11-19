export type Settings = { fuel: number; cons: number; wear: number; tgt: number; eko: number };
export const DEFAULT_SETTINGS: Settings = { fuel: 38, cons: 7, wear: 2.5, tgt: 250, eko: 8 };

export const costPerKm = (s: Settings) => (s.fuel * s.cons) / 100 + s.wear;

export type Offer = { reward: number; km: number; driveMin: number; waitMin: number };
export function evaluate(o: Offer, s: Settings) {
  const t = o.driveMin + o.waitMin;
  if (!o.reward || !o.km || !t) return null;
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
