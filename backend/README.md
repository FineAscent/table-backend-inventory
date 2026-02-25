# AliBaba Inventory Backend (SAM)

> **Note:** The active SAM template is `inventory-stack/template.yml` (not this directory's `template.yaml`).

This folder contains an AWS SAM application that deploys:
- **DynamoDB** table with GSIs (barcode uniqueness, availability filter)
- **API Gateway** with Cognito auth and CORS
- **9 Lambda functions** (Node.js 18): list, create, get, update, delete, upload-url, image-url, barcode-lookup, image-proxy
- **S3 bucket** for product images

## Current Deployment

| Resource | Value |
|----------|-------|
| **Stack** | `aliabab-inventory-dev-v2` |
| **Region** | `us-east-1` |
| **API URL** | `https://q5mv3u14v5.execute-api.us-east-1.amazonaws.com/Prod` |

## Deploy

From `inventory-stack/` (not this directory):

```bash
sam build
sam deploy --stack-name aliabab-inventory-dev-v2 --capabilities CAPABILITY_IAM --resolve-s3 --no-confirm-changeset
```

## API Endpoints

Base URL: `https://q5mv3u14v5.execute-api.us-east-1.amazonaws.com/Prod`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/products` | List all products |
| `POST` | `/products` | Create product |
| `GET` | `/products/{id}` | Get single product |
| `PUT` | `/products/{id}` | Update product |
| `DELETE` | `/products/{id}` | Delete product + images |
| `POST` | `/upload-url` | Get presigned S3 upload URL |
| `POST` | `/image-url` | Get presigned S3 display URL |
| `POST` | `/barcode-lookup` | Proxy barcodelookup.com API |
| `POST` | `/image-proxy` | Proxy external image downloads |

**Auth:** `Authorization: Bearer <cognito_id_token>`

## DynamoDB

Table: `aliabab-inventory-dev-v2-InventoryTable-14VA3OM41Q0RR`

- PK: `id` (UUID)
- GSI1: `gsi1_pk` (availability) + `gsi1_sk` (createdAt)
- GSI2: `gsi2_pk` (barcode) — uniqueness

## Notes
- Auth uses Cognito JWT tokens (not API keys)
- CORS configured at API Gateway level (all origins allowed)
- See `Save-info/How-this-works.md` for full documentation
