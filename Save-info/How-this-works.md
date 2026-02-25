# AliBaba Inventory — How This Works

## Project Structure

### Frontend (Static — hosted on GitHub Pages)

| File | Purpose |
|------|---------|
| `index.html` | Main admin dashboard — product table, add/edit/delete, barcode scan, CSV import |
| `Backend-admin.html` | Simplified admin view (legacy) |
| `styles.css` | All UI styling: table, modals, carousel, barcode modal, search bar |
| `script.js` | Frontend logic: API calls, product CRUD, image upload, barcode lookup, auth |

### Backend (AWS SAM — `template.yml`)

| File | Lambda Handler | Endpoint | Purpose |
|------|---------------|----------|---------|
| `backend/src/list.js` | `list.handler` | `GET /products` | List all products |
| `backend/src/create.js` | `create.handler` | `POST /products` | Create a new product |
| `backend/src/get.js` | `get.handler` | `GET /products/{id}` | Get a single product |
| `backend/src/update.js` | `update.handler` | `PUT /products/{id}` | Update product, handles image deletions via `deleteKeys` |
| `backend/src/delete.js` | `delete.handler` | `DELETE /products/{id}` | Delete product + its images from S3 |
| `backend/src/upload_url.js` | `upload_url.handler` | `POST /upload-url` | Returns a presigned S3 PUT URL for image upload |
| `backend/src/get_image_url.js` | `get_image_url.handler` | `POST /image-url` | Returns a presigned S3 GET URL for image display |
| `backend/src/barcode_lookup.js` | `barcode_lookup.handler` | `POST /barcode-lookup` | Proxies barcodelookup.com API (bypasses CORS) |
| `backend/src/image_proxy.js` | `image_proxy.handler` | `POST /image-proxy` | Proxies external image downloads (bypasses CORS), returns base64 |

---

## AWS Resources

### Current Configuration

| Resource | Value |
|----------|-------|
| **Stack Name** | `aliabab-inventory-dev-v2` |
| **Region** | `us-east-1` |
| **API Base URL** | `https://q5mv3u14v5.execute-api.us-east-1.amazonaws.com/Prod` |
| **DynamoDB Table** | `aliabab-inventory-dev-v2-InventoryTable-14VA3OM41Q0RR` |
| **S3 Image Bucket** | `aliabab-inventory-dev-v2-imagebucket-rptc67hjm0qt` |
| **Auth** | AWS Cognito (domain: `aliabab-inventory-v2-dev-admin.auth.us-east-1.amazoncognito.com`) |
| **Frontend URL** | `https://fineascent.github.io/table-backend-inventory/` |

### API Endpoints

All endpoints are relative to:
```
https://q5mv3u14v5.execute-api.us-east-1.amazonaws.com/Prod
```

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/products` | — | List all products |
| `POST` | `/products` | `{ name, description, category, price, priceUnit, barcode, availability, areaLocation, scaleNeed, imageKeys?, allergySummary? }` | Create product |
| `GET` | `/products/{id}` | — | Get single product |
| `PUT` | `/products/{id}` | Same as POST + `deleteKeys?` | Update product |
| `DELETE` | `/products/{id}` | — | Delete product + S3 images |
| `POST` | `/upload-url` | `{ fileName, contentType, productId? }` | Get presigned S3 upload URL → `{ uploadUrl, key }` |
| `POST` | `/image-url` | `{ key }` | Get presigned S3 display URL → `{ url }` |
| `POST` | `/barcode-lookup` | `{ barcode, apiKey }` | Proxy barcodelookup.com API → product data |
| `POST` | `/image-proxy` | `{ url }` | Proxy external image download → `{ dataUrl, contentType, size }` |

**Auth:** Include `Authorization: Bearer <id_token>` header (from Cognito login).

**CORS:** Configured at API Gateway level. All endpoints support `OPTIONS` preflight with `Access-Control-Allow-Origin: *`.

---

## Data Model (DynamoDB)

**Item fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | String (UUID) | Auto | Primary key |
| `name` | String | ✓ | Product name |
| `description` | String | ✓ | Product description |
| `category` | String | ✓ | One of: Fruits & Veggies, Seafood, Bakery, Frozen Foods, Beverages, Snacks, Infant Care, Cereals & Breakfast, Meat & Poultry |
| `price` | Number | ✓ | Price value |
| `priceUnit` | String | — | per piece, lb, oz, g, kg, gallon, dozen, loaf, bag, bags, carton, block, jar, cup, box, pack, can, bottle |
| `barcode` | String | ✓ | Unique barcode (enforced via GSI2) |
| `availability` | String | ✓ | "In Stock" or "Out of Stock" |
| `areaLocation` | String | — | A1–A10 |
| `scaleNeed` | Boolean | — | Whether product requires scale |
| `imageKeys` | Array[String] | — | Up to 2 S3 object keys |
| `allergySummary` | String | — | AI-generated allergy info or "none" |
| `createdAt` | String (ISO) | Auto | Creation timestamp |
| `updatedAt` | String (ISO) | Auto | Last update timestamp |

**GSIs:**
- **GSI1:** `gsi1_pk` (availability) + `gsi1_sk` (createdAt) — filter by stock status
- **GSI2:** `gsi2_pk` (barcode) — enforce barcode uniqueness

---

## Images — How They Work

1. **Upload flow:**
   - Frontend calls `POST /upload-url` → gets `{ uploadUrl, key }`
   - Frontend PUTs image file directly to S3 via presigned URL
   - The S3 key is saved in the product's `imageKeys` array

2. **Display flow:**
   - Frontend calls `POST /image-url` with key → gets `{ url }` (temporary signed GET URL)
   - Uses URL in `<img src="...">`

3. **Deletion flow:**
   - When editing: removed images' keys go into `deleteKeys`
   - `PUT /products/{id}` with `deleteKeys` → backend calls `s3.deleteObjects()` to remove from S3
   - When deleting product: `DELETE /products/{id}` auto-deletes all associated images

4. **Barcode images:**
   - When adding by barcode, images are downloaded via the `/image-proxy` Lambda (server-side, bypasses CORS)
   - Images are processed to 760×600 JPEG on white background
   - Attached to carousel slots in the Add Product modal
   - Uploaded to S3 on save

---

## Key Frontend Flows

### Add Product by Barcode
1. Click **📦 Add by Barcode** → barcode modal opens
2. Enter/scan barcode → click **Search**
3. Product info fetched via `POST /barcode-lookup` (server-side proxy)
4. Click **Add to Products** → Add Product modal opens pre-filled with name, description, barcode
5. Images auto-downloaded via `POST /image-proxy` → attached to carousel
6. Fill remaining fields (category, price, area) → click **Save**
7. Images uploaded to S3, product saved to DynamoDB

### Import CSV
1. Click **Import CSV** → select `.csv` file
2. Expected columns: `ItemId, ItemName, ItemPrice, Availability, Description, Category, Barcode, PriceUnit, AreaLocation, ScaleNeed, ImageKeys, AllergySummary`
3. Products created via `POST /products` for each row

### Edit Product
1. Click edit icon on product row → modal opens with current data + images
2. Modify fields, add/remove images
3. Save → new images uploaded to S3, old removed images deleted from S3

---

## Deploy

### Build & Deploy

From `inventory-stack/` directory:

```bash
sam build
sam deploy --stack-name aliabab-inventory-dev-v2 --capabilities CAPABILITY_IAM --resolve-s3 --no-confirm-changeset
```

### After Deploy

Check the outputs for the new API URL:

```bash
aws cloudformation describe-stacks --stack-name aliabab-inventory-dev-v2 --query 'Stacks[0].Outputs' --output table
```

If the API URL changes, update `API_BASE_URL` in `script.js` line 2.

### Common Issues

- **CORS 403 on preflight:** Force a redeployment of the API stage:
  ```bash
  aws apigateway create-deployment --rest-api-id <api-id> --stage-name Prod
  ```
- **Empty table after deploy:** If DynamoDB table was recreated, re-import via CSV (`main-data.csv` in project root)

---

## Displaying Products on Another Page

Use the same API to build a customer-facing page:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Menu</title>
</head>
<body>
  <div id="menu"></div>
  <script>
    const API_BASE_URL = 'https://q5mv3u14v5.execute-api.us-east-1.amazonaws.com/Prod';

    async function getImageUrl(key) {
      const r = await fetch(API_BASE_URL + '/image-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });
      if (!r.ok) return { url: '' };
      return r.json();
    }

    async function loadMenu() {
      const container = document.getElementById('menu');
      const res = await fetch(API_BASE_URL + '/products');
      const data = await res.json();
      const items = data.items || [];

      for (const p of items) {
        let imgUrl = '';
        const keys = p.imageKeys || [];
        if (keys[0]) {
          try { imgUrl = (await getImageUrl(keys[0])).url || ''; } catch(_) {}
        }
        container.innerHTML += `
          <div>
            ${imgUrl ? `<img src="${imgUrl}" width="200">` : ''}
            <h3>${p.name}</h3>
            <p>${p.description}</p>
            <p><strong>$${Number(p.price).toFixed(2)}</strong></p>
          </div>
        `;
      }
    }
    loadMenu();
  </script>
</body>
</html>
```

> **Note:** Images are private in S3. The page must call `POST /image-url` to get short-lived signed URLs.