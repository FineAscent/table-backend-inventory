const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const { TABLE_NAME, BUCKET_NAME } = process.env;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

function validate(body) {
  const required = ['name', 'description', 'category', 'price', 'barcode', 'availability'];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === '') {
      return `${k} is required`;
    }
  }
  if (typeof body.price !== 'number' || Number.isNaN(body.price)) return 'price must be a number';
  if (!['In Stock', 'Out of Stock'].includes(body.availability)) return 'availability must be In Stock or Out of Stock';
  if (body.priceUnit !== undefined) {
    const allowed = ['piece', 'lb', 'oz', 'g', 'kg', 'gallon', 'dozen', 'loaf', 'bag', 'bags', 'carton', 'block', 'jar', 'cup', 'box', 'pack', 'can', 'bottle'];
    if (!allowed.includes(body.priceUnit)) return 'priceUnit must be one of ' + allowed.join(', ');
  }
  if (body.areaLocation !== undefined) {
    const areas = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'];
    if (!areas.includes(body.areaLocation)) return 'areaLocation must be one of ' + areas.join(', ');
  }
  if (body.imageKeys !== undefined) {
    if (!Array.isArray(body.imageKeys)) return 'imageKeys must be an array of strings';
    if (body.imageKeys.length > 2) return 'imageKeys can contain at most 2 items';
    for (const s of body.imageKeys) {
      if (typeof s !== 'string') return 'imageKeys must be an array of strings';
    }
  }
  if (body.deleteKeys !== undefined) {
    if (!Array.isArray(body.deleteKeys)) return 'deleteKeys must be an array of strings';
    for (const s of body.deleteKeys) {
      if (typeof s !== 'string') return 'deleteKeys must be an array of strings';
    }
  }
  if (body.scaleNeed !== undefined && typeof body.scaleNeed !== 'boolean') {
    return 'scaleNeed must be a boolean';
  }
  return null;
}

function normalizeCategory(cat) {
  const allowed = [
    'Fruits & Veggies',
    'Seafood',
    'Bakery',
    'Frozen Foods',
    'Beverages',
    'Snacks',
    'Infant Care',
    'Cereals & Breakfast',
    'Meat & Poultry'
  ];
  if (!cat || typeof cat !== 'string') return 'option';
  return allowed.includes(cat) ? cat : 'option';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  try {
    const id = (event.pathParameters || {}).id;
    if (!id) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'id path param is required' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const err = validate(body);
    if (err) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: err }) };
    }

    // Fetch current item
    const current = await ddb.get({ TableName: TABLE_NAME, Key: { id } }).promise();
    if (!current.Item) {
      return { statusCode: 404, headers, body: JSON.stringify({ message: 'Not found' }) };
    }

    // If barcode changed, enforce uniqueness
    if (current.Item.barcode !== body.barcode) {
      const exist = await ddb.query({
        TableName: TABLE_NAME,
        IndexName: 'GSI2',
        KeyConditionExpression: 'gsi2_pk = :b',
        ExpressionAttributeValues: { ':b': body.barcode }
      }).promise();
      if (exist.Count && exist.Items && exist.Items.length > 0) {
        return { statusCode: 409, headers, body: JSON.stringify({ message: 'Barcode already exists' }) };
      }
    }

    const now = new Date().toISOString();

    // Handle deletions of existing images
    const toDelete = Array.isArray(body.deleteKeys) ? body.deleteKeys : [];
    if (toDelete.length > 0 && BUCKET_NAME) {
      try {
        await s3.deleteObjects({
          Bucket: BUCKET_NAME,
          Delete: { Objects: toDelete.map(k => ({ Key: k })), Quiet: true }
        }).promise();
      } catch (_) { /* ignore */ }
    }

    // Compute final imageKeys: (current - deleted) + new uploads (cap 2)
    const currentKeys = Array.isArray(current.Item.imageKeys) ? current.Item.imageKeys : [];
    const remaining = currentKeys.filter(k => !toDelete.includes(k));
    const newUploads = Array.isArray(body.imageKeys) ? body.imageKeys : [];
    const finalKeys = [...remaining, ...newUploads].slice(0, 2);

    const updated = {
      ...current.Item,
      name: body.name,
      description: body.description,
      category: normalizeCategory(body.category),
      price: body.price,
      priceUnit: body.priceUnit || current.Item.priceUnit || 'piece',
      barcode: body.barcode,
      availability: body.availability,
      areaLocation: body.areaLocation || current.Item.areaLocation || 'A1',
      scaleNeed: (typeof body.scaleNeed === 'boolean') ? body.scaleNeed : (current.Item.scaleNeed === true),
      updatedAt: now,
      gsi1_pk: body.availability,
      gsi1_sk: current.Item.createdAt || now,
      gsi2_pk: body.barcode,
      imageKeys: finalKeys,
      allergySummary: (body.allergySummary !== undefined) ? body.allergySummary : (current.Item.allergySummary || 'none')
    };

    await ddb.put({ TableName: TABLE_NAME, Item: updated, ConditionExpression: 'attribute_exists(id)' }).promise();

    return { statusCode: 200, headers, body: JSON.stringify(updated) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Failed to update product', error: err.message }) };
  }
};
