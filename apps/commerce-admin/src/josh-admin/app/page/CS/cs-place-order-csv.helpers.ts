export type CsPlaceOrderCsvRow = {
  sku: string;
  quantity: number;
};

const SKU_HEADERS = new Set(['sku', 'product_inventory_sku']);
const QTY_HEADERS = new Set(['quantity', 'qty', 'จำนวน']);

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  out.push(current);
  return out.map((cell) => cell.replace(/^"|"$/g, '').trim());
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

export function parseCsPlaceOrderCsv(text: string): CsPlaceOrderCsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const headerCells = parseCsvRow(lines[0]).map(normalizeHeader);
  const skuIdx = headerCells.findIndex((header) => SKU_HEADERS.has(header));
  const qtyIdx = headerCells.findIndex((header) => QTY_HEADERS.has(header));
  const hasHeader = skuIdx >= 0;
  const startRow = hasHeader ? 1 : 0;
  const resolvedSkuIdx = hasHeader ? skuIdx : 0;
  const resolvedQtyIdx = hasHeader ? (qtyIdx >= 0 ? qtyIdx : 1) : 1;

  const rows: CsPlaceOrderCsvRow[] = [];
  for (let i = startRow; i < lines.length; i += 1) {
    const cols = parseCsvRow(lines[i]);
    const sku = cols[resolvedSkuIdx]?.trim();
    if (!sku) continue;

    const qtyRaw = cols[resolvedQtyIdx]?.trim() ?? '1';
    const quantity = Math.max(1, Math.floor(Number(qtyRaw) || 1));
    rows.push({ sku, quantity });
  }

  return rows;
}

export function aggregateCsvQuantities(
  rows: CsPlaceOrderCsvRow[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const sku = row.sku.trim();
    if (!sku) continue;
    map.set(sku, (map.get(sku) ?? 0) + row.quantity);
  }
  return map;
}

export const CS_PLACE_ORDER_CSV_TEMPLATE = 'sku,quantity\nSKU001,2\nSKU002,5';
