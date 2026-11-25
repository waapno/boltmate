export type DeliverySpot = {
  id: string;
  name: string;
  address: string;
  category: string;
  access: string;
  c: [number, number];
};

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV obsahuje neuzavřenou uvozovku.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

export function parseDeliverySpotsCsv(csv: string): DeliverySpot[] {
  const rows = parseCsvRows(csv.replace(/^\uFEFF/, ""));
  const header = rows.shift()?.map((cell) => cell.trim().toLocaleLowerCase("cs"));
  if (!header) throw new Error("CSV neobsahuje hlavičku.");
  const column = (name: string) => header.indexOf(name.toLocaleLowerCase("cs"));
  const columns = {
    name: column("název"),
    address: column("adresa"),
    category: column("kategorie"),
    access: column("režim"),
    latitude: column("latitude"),
    longitude: column("longitude"),
  };
  if (Object.values(columns).some((index) => index < 0)) {
    throw new Error("CSV musí obsahovat Název, Adresa, Kategorie, Režim, Latitude a Longitude.");
  }

  return rows.map((cells, index) => {
    const rowNumber = index + 2;
    if (cells.length !== header.length) {
      throw new Error(`Neplatný počet sloupců na řádku ${rowNumber}.`);
    }
    const latitude = Number(cells[columns.latitude]);
    const longitude = Number(cells[columns.longitude]);
    const name = cells[columns.name]?.trim();
    const address = cells[columns.address]?.trim();
    const category = cells[columns.category]?.trim();
    const access = cells[columns.access]?.trim();

    if (
      !name ||
      !address ||
      !category ||
      !access ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      throw new Error(`Neplatná adresa nebo souřadnice na řádku ${rowNumber}.`);
    }

    const c: [number, number] = [longitude, latitude];
    return { id: String(rowNumber), name, address, category, access, c };
  });
}
