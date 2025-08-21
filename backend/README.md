# aliabab-inventory backend (SAM)

This folder contains an AWS SAM application that deploys:
- DynamoDB table with GSIs (barcode uniqueness, availability filter)
- API Gateway (REGIONAL) with API Key auth
- 4 Lambda functions (Node.js 20): list, create, update, delete

Resources are parameterized for environments: dev and prod.

## Prerequisites
- AWS account with credentials configured (us-east-1)
- AWS SAM CLI installed
- Node.js 20+ (for local packaging)

## Deploy (dev)

From the `backend/` directory:

```bash
sam build
sam deploy \
  --stack-name aliabab-inventory-dev \
  --region us-east-1 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides StageName=dev ProjectName=aliabab-inventory Region=us-east-1 DefaultPageSize=50
```

Outputs include:
- ApiBaseUrl (copy this for frontend)
- TableName

Get the API key value created by the stack:

```bash
# List API keys (note the keyId for aliabab-inventory-dev-admin-key)
aws apigateway get-api-keys --name-query aliabab-inventory-dev-admin-key --include-values --region us-east-1

# Alternatively, if you have the id:
aws apigateway get-api-key --api-key <keyId> --include-value --region us-east-1
```

The JSON output contains `value` which is the API key string to send in the `X-Api-Key` header.

## Deploy (prod)

```bash
sam build
sam deploy \
  --stack-name aliabab-inventory-prod \
  --region us-east-1 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides StageName=prod ProjectName=aliabab-inventory Region=us-east-1 DefaultPageSize=50
```

For production, you should lock CORS to your domain by replacing `AllowOrigin: "*"` in `template.yaml` with your domain (e.g., `https://app.example.com`).

## API
- GET    /products?availability=In%20Stock&limit=50&lastKey=...
- POST   /products
- PUT    /products/{id}
- DELETE /products/{id}

Headers: `Content-Type: application/json`, `X-Api-Key: <your-api-key>`

## DynamoDB
Table name: `${ProjectName}-${StageName}` (e.g., aliabab-inventory-dev)

- PK: id (S)
- Attributes: name, description, category, price (N), barcode, availability, createdAt, updatedAt
- GSIs:
  - GSI1: gsi1_pk (availability) + gsi1_sk (createdAt desc)
  - GSI2: gsi2_pk (barcode) for uniqueness lookup

Point-in-time recovery (PITR) is enabled.

## Frontend integration (script.js)
Replace the localStorage simulation with REST calls using fetch and include the API key.

Example patterns:

```js
// Load
const res = await fetch(`${API_BASE}/products?availability=In%20Stock`, {
  headers: { 'X-Api-Key': API_KEY }
});
const data = await res.json();

// Create
await fetch(`${API_BASE}/products`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
  body: JSON.stringify({ name, description, category, price, barcode, availability })
});

// Update
await fetch(`${API_BASE}/products/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
  body: JSON.stringify({ name, description, category, price, barcode, availability })
});

// Delete
await fetch(`${API_BASE}/products/${id}`, {
  method: 'DELETE',
  headers: { 'X-Api-Key': API_KEY }
});
```

I kept the UI contract identical to minimize changes.

## Notes
- Upgrade auth to Cognito + JWT when ready.
- For prod, restrict CORS and rotate API keys periodically.
- To change default page size, update `DefaultPageSize` parameter.
