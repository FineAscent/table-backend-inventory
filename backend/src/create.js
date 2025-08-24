const AWS = require('aws-sdk');
const crypto = require('crypto');
const ddb = new AWS.DynamoDB.DocumentClient();

const { TABLE_NAME } = process.env;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

function ulid() {
  // Simple ULID-like: time-based prefix + random. For production, use a ULID lib.
  const time = Date.now().toString(36).toUpperCase().padStart(8, '0');
  const rand = crypto.randomBytes(10).toString('base64url').slice(0, 14).toUpperCase();
  return `${time}${rand}`;
}

function validate(body) {
  const required = ['name', 'description', 'category', 'price', 'barcode', 'availability'];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === '') {
      return `${k} is required`;
    }
  }
  if (typeof body.price !== 'number' || Number.isNaN(body.price)) return 'price must be a number';
  if (!['In Stock', 'Out of Stock'].includes(body.availability)) return 'availability must be In Stock or Out of Stock';
  if (body.priceUnit !== undefined && body.priceUnit !== null) {
    if (typeof body.priceUnit !== 'string') return 'priceUnit must be a string';
    // accept any string; frontend normalizes common variants
  }
  if (body.imageKeys !== undefined) {
    if (!Array.isArray(body.imageKeys)) return 'imageKeys must be an array of strings';
    if (body.imageKeys.length > 2) return 'imageKeys can contain at most 2 items';
    for (const s of body.imageKeys) {
      if (typeof s !== 'string') return 'imageKeys must be an array of strings';
    }
  }
  return null;
}

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const err = validate(body);
    if (err) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: err }) };
    }

    // Enforce barcode uniqueness via GSI2
    const existing = await ddb.query({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'gsi2_pk = :b',
      ExpressionAttributeValues: { ':b': body.barcode }
    }).promise();
    if (existing.Count && existing.Items && existing.Items.length > 0) {
      return { statusCode: 409, headers, body: JSON.stringify({ message: 'Barcode already exists' }) };
    }

    const now = new Date().toISOString();
    const item = {
      id: ulid(),
      name: body.name,
      description: body.description,
      category: body.category,
      price: body.price,
      priceUnit: body.priceUnit || 'piece',
      barcode: body.barcode,
      availability: body.availability,
      createdAt: now,
      updatedAt: now,
      gsi1_pk: body.availability,
      gsi1_sk: now,
      gsi2_pk: body.barcode,
      imageKeys: Array.isArray(body.imageKeys) ? body.imageKeys : []
    };

    await ddb.put({ TableName: TABLE_NAME, Item: item, ConditionExpression: 'attribute_not_exists(id)' }).promise();

    return { statusCode: 201, headers, body: JSON.stringify(item) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Failed to create product', error: err.message }) };
  }
};
