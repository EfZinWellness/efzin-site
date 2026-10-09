# Squarespace import

Brings returning guests and their past orders from the old Squarespace site into the CRM, so
"own booking" counts (and the returning-guest perks that depend on them) carry over.

## 1. Export from Squarespace

- Customers: Commerce > Customers > Export (CSV).
- Orders: Commerce > Orders > Download CSV (choose all dates).

## 2. Expected headers

Matching is case-insensitive; unknown columns are ignored; a UTF-8 byte order mark, CRLF line
endings, quoted fields with commas and line breaks are all fine.

Customers CSV

| Header | Notes |
| --- | --- |
| `Email` | Required. Rows without an email are skipped and counted. |
| `First Name`, `Last Name` | Joined into the person's name. |
| `Accepts Marketing` (or `Subscribed to Marketing`) | `yes`/`true` sets marketing consent, dated at import time. Anything else leaves consent off. A consent the guest withdrew is never switched back on. |
| `Phone` | Optional. |

Orders CSV (one row per line item; rows of one order repeat the `Order ID`)

| Header | Notes |
| --- | --- |
| `Order ID` | Required. With the line's position in the order it forms `bookings.external_ref` = `sqsp:<orderId>:<lineIndex>`. |
| `Email` | Required. People who are only in the orders file are created too. |
| `Created at` (or `Paid at`) | Becomes the booking date. |
| `Lineitem name` | The product name, matched against the map file. |
| `Lineitem quantity`, `Lineitem price` | Booking amount is price x quantity. |
| `Currency` | AED amounts are stored as AED. Other currencies are stored as presentment amounts with `amount_aed_minor = 0` and listed in the result for manual conversion. |
| `Billing Name` | Used as the name when the customers file has none. |

## 3. Map products to experiences

`scripts/squarespace-map.json` maps a Squarespace product name to an experience slug, or to
`{ "slug": "...", "ticket": "<ticket key>" }` to pick a ticket type (default: the most expensive
ticket). The experience must already be in the database (`npm run sync:content`).
Unmapped products are listed, never guessed; their lines are not imported. Add them to the map and
rerun.

## 4. Run

```
# preview: counts and unmapped names, nothing written
npx tsx scripts/import-squarespace.ts --customers customers.csv --orders orders.csv --dry-run

# for real (uses DATABASE_URL)
npx tsx scripts/import-squarespace.ts --customers customers.csv --orders orders.csv
```

Each imported line becomes a `paid` booking flagged `imported`, with the booker checked in at the
experience start. People created by the import are tagged `imported_from = 'squarespace'`.
Rerunning is safe: bookings are matched on `external_ref`, existing people are matched by email
and only have blanks filled in.

Quantities above 1 produce one booking with the full amount and a single booker row.

## Images

`npx tsx scripts/download-images.ts` downloaded every site image from the Squarespace CDN into
`public/images/` (max 2000px wide, JPEG quality 82) and rewrote the references. The CDN is no
longer in `next.config.ts`, and a unit test fails if a content, app, component or lib file
mentions it again.
