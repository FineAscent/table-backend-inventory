# Inventory System Rebuild — Progress

## Architecture

### Two barcode fields per item
- `upc` — external/universal barcode (from internet, NOT unique in DB, reference only)
- `internalBarcode` — system-generated unique identifier (our primary lookup key, user picks digit count)
  - GSI2 (`gsi2_pk`) keys on `internalBarcode` for uniqueness enforcement
  - Same UPC can exist multiple times; each entry has a different internalBarcode

### Two core workflows (tabs)
- **Receive Item** — scan/type UPC → auto-fill from barcodelookup.com → configure internal record (price, area, internalBarcode) → save to DB
- **Audit** — view all saved items, edit internal fields only, no external add allowed

---

## Steps

- [x] Write this plan
- [x] **Step 1 — Backend: rename barcode→upc, add internalBarcode** (`create.js`, `update.js`)
- [x] **Step 2 — Frontend HTML: tab panels + Receive Item UI + modal updates**
- [x] **Step 3 — Frontend JS: tab switching + receive flow + internalBarcode generator + field renames**
- [x] **Step 4 — Table columns: rename Barcode → Internal Barcode, add UPC column**
- [x] **Step 5 — CSS: tab-panel, audit-mode, receive UI, internal-barcode-row styles**

---

## Notes
- `gsi2_pk` in DynamoDB stays as the attribute name (no infra change needed); its value changes from `barcode` → `internalBarcode`
- Existing records in DB will have neither `internalBarcode` nor `upc` until edited — display gracefully as "—"
- Do NOT redeploy SAM infra — attribute names in template.yaml stay generic (`gsi2_pk`), only Lambda code changes
