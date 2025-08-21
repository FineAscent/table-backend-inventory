AliBaba Inventory: How This Works
Project structure
Frontend (static)
Backend-admin.html
: Admin UI layout and elements.
styles.css
: All UI styling. Includes table, modal, carousel, and image-box styles.
script.js
: Frontend logic: loads products, add/edit modal, image upload, thumbnails, and API calls.
Backend (SAM)
backend/template.yaml
: AWS SAM template for API Gateway, Lambda, DynamoDB, and S3.
backend/src/
list.js
: GET /products list API.
create.js
: POST /products create API.
update.js
: PUT /products/{id} update API, supports image deletions via deleteKeys.
delete.js
: DELETE /products/{id} deletes product and its images from S3.
upload_url.js
: POST /upload-url returns a presigned S3 PUT URL for uploading an image.
get_image_url.js
: POST /image-url returns a presigned S3 GET URL for displaying an image.
Data model (DynamoDB)
Table name: ${ProjectName}-${StageName}, e.g. aliabab-inventory-dev
Item shape (fields used by frontend):
id (string, UUID)
name (string)
description (string)
category (string)
price (number)
barcode (string, unique)
availability (string: "In Stock" | "Out of Stock")
imageKeys (array of up to 2 strings) – S3 object keys for product images
Timestamps and GSIs for filtering/searching
Images: where and how they are saved
S3 bucket: ${ProjectName}-${StageName}-images (e.g., aliabab-inventory-dev-images), private.
Images are uploaded directly from the browser to S3 via a presigned PUT URL from POST /upload-url.
The S3 object key is saved into the product’s imageKeys array.
When rendering, the UI calls POST /image-url with a key to get a temporary signed GET URL, then uses that URL in <img src="...">.
Frontend flows
Load products
script.js
 calls GET /products.
Populates the table. If imageKeys exists, it requests a signed image URL for the first image to show a thumbnail.
Add product
Open modal, fill fields.
Optional: select up to 2 images.
For each selected image:
Call POST /upload-url ⇒ returns { uploadUrl, key }.
PUT the file to uploadUrl.
Collect keys into imageKeys.
Submit product via POST /products with body including imageKeys.
Edit product
Modal pre-fills fields and shows existing images (fetched via POST /image-url).
If an existing image is removed in the modal, its key is pushed to deleteKeys.
Any newly selected images are uploaded via upload-url.
Submit via PUT /products/{id} with optional imageKeys (new ones) and deleteKeys (to remove old ones).
Backend:
Deletes deleteKeys from S3.
Saves the final imageKeys = (existing − deleteKeys) + newUploads, capped at 2.
Delete product
DELETE /products/{id} deletes both the product item in DynamoDB and any imageKeys in S3.
Backend endpoints
Base URL: https://fqnz42nyi8.execute-api.us-east-1.amazonaws.com/dev

GET /products
Returns list of product items.
POST /products
Body: { name, description, category, price, barcode, availability, imageKeys? }
PUT /products/{id}
Body: { name, description, category, price, barcode, availability, imageKeys?, deleteKeys? }
DELETE /products/{id}
POST /upload-url
Body: { fileName, contentType, productId? }
Returns { uploadUrl, key }
POST /image-url
Body: { key }
Returns { url } (temporary signed GET URL)
CORS is enabled at API Gateway and on lambdas. S3 bucket has permissive CORS for PUT/GET/HEAD.

Styling notes (thumbnails)
Table thumbnail container: .product-image fixed at 168x133.
CSS forces child <img> to fully fill the box:
.product-image img { width: 100% !important; height: 100% !important; object-fit: cover; }
How to display items in another HTML page
If you want a separate site/page to list products with name, description, price, and first image, do this:

Include a script that fetches products
Use the same API base URL.
For each product, if it has imageKeys[0], call POST /image-url to get a signed URL for display.
Render the HTML
For each item, render an image, name, description, and price.
Example minimal HTML+JS:

html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Menu</title>
  <style>
    .card { width: 240px; border: 1px solid #eee; border-radius: 8px; padding: 12px; }
    .thumb { width: 100%; height: 160px; border-radius: 6px; overflow: hidden; background: #f0f0f0; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .name { font-weight: 600; margin-top: 8px; }
    .desc { color: #666; font-size: 14px; margin-top: 4px; }
    .price { font-weight: 700; margin-top: 6px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(240px,1fr)); gap: 16px; }
  </style>
</head>
<body>
  <div id="menu" class="grid"></div>

  <script>
    const API_BASE_URL = 'https://fqnz42nyi8.execute-api.us-east-1.amazonaws.com/dev';

    async function fetchJSON(url, opts) {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    }

    async function getImageUrl(key) {
      const body = JSON.stringify({ key });
      const r = await fetch(API_BASE_URL + '/image-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      if (!r.ok) return { url: '' };
      return r.json();
    }

    async function loadMenu() {
      const container = document.getElementById('menu');
      container.innerHTML = 'Loading...';
      try {
        const list = await fetchJSON(API_BASE_URL + '/products');
        const items = list.items || list.Items || [];
        const rows = [];
        for (const p of items) {
          let imgUrl = '';
          const keys = p.imageKeys || p.image_keys || [];
          if (Array.isArray(keys) && keys[0]) {
            try {
              const { url } = await getImageUrl(keys[0]);
              imgUrl = url || '';
            } catch (_) {}
          }
          rows.push(`
            <div class="card">
              <div class="thumb">${imgUrl ? `<img src="${imgUrl}" alt="">` : ''}</div>
              <div class="name">${p.name || ''}</div>
              <div class="desc">${p.description || ''}</div>
              <div class="price">$${Number(p.price || 0).toFixed(2)}</div>
            </div>
          `);
        }
        container.innerHTML = rows.join('');
      } catch (e) {
        container.innerHTML = 'Failed to load menu';
      }
    }

    loadMenu();
  </script>
</body>
</html>

Notes:

This page can be hosted anywhere; it calls the same backend.
Images are private in S3; the page relies on the POST /image-url endpoint for a short-lived link.
If you need public CDN access, add CloudFront with OAC and expose images securely without presigned URLs.
Operational notes
Deploy backend:
From inventory-stack/backend/: sam build && sam deploy --guided (first time), then sam deploy.
Common issues:
If you hit CORS preflight 403, wait a minute after deploy and refresh. CORS is configured on API + functions; OPTIONS methods exist for /upload-url and /image-url.