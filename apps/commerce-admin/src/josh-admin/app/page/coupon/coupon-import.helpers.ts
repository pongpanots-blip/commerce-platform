export type CsvImportRow = {
  user_id?: string;
  email?: string;
  custcode?: string;
};

export function parseCouponRecipientCsv(text: string): CsvImportRow[] {
  // Excel's "CSV UTF-8" prepends a BOM, which would hide the first header (`\uFEFFuser_id`).
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());

  const hasHeader = headers.some((header) =>
    ['user_id', 'email', 'custcode', 'customer_code', 'cust_code'].includes(
      header,
    ),
  );

  const rows: CsvImportRow[] = [];
  const startIndex = hasHeader ? 1 : 0;

  for (let i = startIndex; i < lines.length; i += 1) {
    const cells = lines[i].split(delimiter).map((cell) => cell.trim());
    if (cells.length === 0 || cells.every((cell) => !cell)) continue;

    if (hasHeader) {
      const row: CsvImportRow = {};
      headers.forEach((header, index) => {
        const value = cells[index]?.trim();
        if (!value) return;
        if (header === 'user_id' || header === 'userid') row.user_id = value;
        if (header === 'email') row.email = value;
        if (
          header === 'custcode' ||
          header === 'customer_code' ||
          header === 'cust_code'
        ) {
          row.custcode = value;
        }
      });
      if (row.user_id || row.email || row.custcode) rows.push(row);
      continue;
    }

    const [first, second, third] = cells;
    if (first?.includes('@')) {
      rows.push({ email: first });
    } else if (third) {
      rows.push({ user_id: first, email: second, custcode: third });
    } else if (second?.includes('@')) {
      rows.push({ custcode: first, email: second });
    } else if (first && first.includes('-') && first.length > 30) {
      rows.push({ user_id: first });
    } else {
      rows.push({ custcode: first, email: second });
    }
  }

  return rows;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paste-box parser: free-form user_id / email / custcode separated by newline, comma, semicolon, or tab. */
export function parseRecipientTokens(text: string): CsvImportRow[] {
  return text
    .split(/[\n,;\t]/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token): CsvImportRow => {
      if (token.includes('@')) return { email: token };
      if (UUID_RE.test(token)) return { user_id: token };
      return { custcode: token };
    });
}

export function rowsToImportPayload(rows: CsvImportRow[]) {
  const user_ids = [
    ...new Set(rows.map((row) => row.user_id).filter(Boolean) as string[]),
  ];
  const emails = [
    ...new Set(rows.map((row) => row.email).filter(Boolean) as string[]),
  ];
  const custcodes = [
    ...new Set(rows.map((row) => row.custcode).filter(Boolean) as string[]),
  ];
  return { user_ids, emails, custcodes };
}
