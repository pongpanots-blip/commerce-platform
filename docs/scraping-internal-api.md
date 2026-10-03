# Scraping Internal API

Machine-to-machine API for josh to fetch scraped competitor data. All requests must include header `X-Internal-Key` set to env `COMMERCE_INTERNAL_KEY`.

Base: `https://commerce-platform/api/internal/scraping`

## Endpoints

### GET /sources?ids=uuid,uuid,…

Fetch scraping sources by ids (max 200).

**Query:** `ids` (comma-separated UUIDs)
**Returns:** Array of `{ id, name, origin, config, revision }`
**Errors:** 400 on invalid UUID format, 401 on bad key

```bash
curl -H "X-Internal-Key: ${COMMERCE_INTERNAL_KEY}" \
  'https://commerce-platform/api/internal/scraping/sources?ids=550e8400-e29b-41d4-a716-446655440000,550e8400-e29b-41d4-a716-446655440001'
```

### GET /sources/by-origin?url=https://example.com

Fetch the scraping source configured for a website origin.

**Query:** `url` (absolute https:// URL)
**Returns:** `{ id, name, origin, config, revision, ... }` or 404
**Errors:** 400 on invalid URL, 401 on bad key

```bash
curl -H "X-Internal-Key: ${COMMERCE_INTERNAL_KEY}" \
  'https://commerce-platform/api/internal/scraping/sources/by-origin?url=https://makro.pro'
```

### GET /items/:id

Fetch a single scraped item by id (with source and config version).

**Param:** `id` (UUID)
**Returns:** `{ id, sourceId, url, pageUrl, name, sku, fields, priceIncVat, weightKg, currency, configVersion, observedAt, source, configCurrent }`
**Errors:** 404 if not found, 401 on bad key

```bash
curl -H "X-Internal-Key: ${COMMERCE_INTERNAL_KEY}" \
  'https://commerce-platform/api/internal/scraping/items/550e8400-e29b-41d4-a716-446655440000'
```

### POST /read-product

Read and extract a single product from a source (respects config, SSRF guards).

**Body:** `{ sourceId: uuid, url: string }`
**Returns:** `{ url, pageUrl, name, sku, fields, price, currency, weightKg, observedAt }`
**Errors:** 
- 400 if sourceId/url invalid or missing
- 400 if source has not been granted collection rights
- 400 if extraction fails (bad selector, missing name, etc.)
- 401 on bad key

```bash
curl -X POST -H "X-Internal-Key: ${COMMERCE_INTERNAL_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"sourceId": "550e8400-e29b-41d4-a716-446655440000", "url": "https://example.com/product/123"}' \
  'https://commerce-platform/api/internal/scraping/read-product'
```

## Security

- **X-Internal-Key:** Timing-safe string comparison. If not set and `NODE_ENV=production`, all requests rejected (401). If not set elsewhere, requests allowed (local dev only).
- **SSRF protection:** All fetches validate public DNS IPs, prohibit private ranges + localhost.
- **Rate limiting:** No hard limits; relies on config.delayMs and maxPages per source.

## Timeout

josh should call with timeout ≥ 30 seconds (read-product may do full page render + extraction).

## Shapes

```typescript
// Source (for list/by-origin)
{ id, name, origin, config, revision, enabled, status, progress, createdAt, updatedAt }

// Item (for get/:id)
{ id, sourceId, url, pageUrl, name, sku, fields, priceIncVat, weightKg, currency, configVersion, observedAt, updatedAt, source, configCurrent }

// ExtractedWebItem (for read-product)
{ url, pageUrl, name, sku, fields, price, currency, weightKg, observedAt }

// ScrapingConfig
{
  startUrls: string[],
  pathPrefixes: string[],
  mode: 'html' | 'browser',
  itemSelector: string,
  fields: { key, label, selector, attribute? }[],
  selectedFields?: string[],
  currency: string,
  vatIncluded: boolean,
  priceContext: string,
  collectionAllowed: boolean,
  intervalHours: number,
  maxPages: number,
  delayMs: number
}
```
