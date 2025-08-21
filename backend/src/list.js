const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();

const { TABLE_NAME, DEFAULT_PAGE_SIZE } = process.env;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

function encodeKey(key) {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

function decodeKey(token) {
  if (!token) return undefined;
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
  } catch (_) {
    return undefined;
  }
}

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const limit = Math.min(parseInt(qs.limit || DEFAULT_PAGE_SIZE, 10) || 50, 200);
    const lastKey = decodeKey(qs.lastKey);
    const availability = qs.availability;

    let result;

    if (availability) {
      // Query GSI1 by availability, newest first by createdAt (gsi1_sk)
      result = await ddb.query({
        TableName: TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1_pk = :pk',
        ExpressionAttributeValues: {
          ':pk': availability
        },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: lastKey
      }).promise();
    } else {
      // Fallback scan for MVP when no filter is provided
      result = await ddb.scan({
        TableName: TABLE_NAME,
        Limit: limit,
        ExclusiveStartKey: lastKey
      }).promise();
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        items: result.Items || [],
        lastKey: encodeKey(result.LastEvaluatedKey)
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: 'Failed to list products', error: err.message })
    };
  }
};
