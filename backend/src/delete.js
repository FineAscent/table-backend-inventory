const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const { TABLE_NAME, BUCKET_NAME } = process.env;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  try {
    const id = (event.pathParameters || {}).id;
    if (!id) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'id path param is required' }) };
    }

    // Ensure item exists
    const existing = await ddb.get({ TableName: TABLE_NAME, Key: { id } }).promise();
    if (!existing.Item) {
      return { statusCode: 404, headers, body: JSON.stringify({ message: 'Not found' }) };
    }

    // Delete images from S3 if present
    const keys = Array.isArray(existing.Item.imageKeys) ? existing.Item.imageKeys : [];
    if (keys.length > 0 && BUCKET_NAME) {
      const objects = keys.map(k => ({ Key: k }));
      try {
        await s3.deleteObjects({ Bucket: BUCKET_NAME, Delete: { Objects: objects, Quiet: true } }).promise();
      } catch (_) {
        // proceed even if image deletion fails, but you may log in CloudWatch
      }
    }

    await ddb.delete({ TableName: TABLE_NAME, Key: { id } }).promise();

    return { statusCode: 204, headers, body: '' };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Failed to delete product', error: err.message }) };
  }
};
