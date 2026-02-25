const AWS = require('aws-sdk');
const s3 = new AWS.S3({ signatureVersion: 'v4' });

const { BUCKET_NAME } = process.env;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { fileName, contentType, productId } = body;

    if (!fileName || !contentType) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'fileName and contentType are required' }) };
    }

    // Optional: use productId prefix to keep keys grouped per product
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const keyPrefix = productId ? `products/${productId}/` : 'uploads/';
    const key = `${keyPrefix}${Date.now()}-${safeName}`;

    const params = {
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: contentType,
      // Objects remain private; frontend will read via CloudFront or signed GET if needed later
      Expires: 60 // seconds
    };

    const url = await s3.getSignedUrlPromise('putObject', params);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ uploadUrl: url, key })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Failed to create upload URL', error: err.message }) };
  }
};
