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
    const { key } = body;
    if (!key) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'key is required' }) };
    }
    const url = await s3.getSignedUrlPromise('getObject', {
      Bucket: BUCKET_NAME,
      Key: key,
      Expires: 60
    });
    return { statusCode: 200, headers, body: JSON.stringify({ url }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Failed to create image URL', error: err.message }) };
  }
};
