export type Zone = { id: string; name: string; note: string; c: [number, number]; peaks: number[] };
// Hotspot centers (lng,lat). peaks = hours with typical demand — odhad, ověř si podle směn.
export const ZONES: Zone[] = [
  { id: "karolina", name: "Nová Karolina", note: "Hustota podniků, parkovací dům", c: [18.2856, 49.8330], peaks: [11,12,13,18,19,20] },
  { id: "stodolni", name: "Stodolní / Nádražní", note: "Husté restaurace, jen krátké stání", c: [18.2832, 49.8392], peaks: [12,19,20,21,22] },
  { id: "avion", name: "Avion Shopping Park", note: "Fastfoody, velké parkoviště", c: [18.2370, 49.8040], peaks: [11,12,17,18,19] },
  { id: "poruba", name: "Poruba – Hlavní třída", note: "Sídliště, stabilní špička", c: [18.1640, 49.8300], peaks: [12,18,19,20] },
  { id: "dubina", name: "Dubina / Belovezská", note: "Rezidenční poptávka večer", c: [18.2620, 49.7930], peaks: [18,19,20] },
];
export const OSTRAVA: [number, number] = [18.255, 49.825];
export const zoneScoreAt = (z: Zone, h: number) =>
  z.peaks.includes(h) ? 1 : z.peaks.some((p) => Math.abs(p - h) === 1) ? 0.6 : 0.25;
