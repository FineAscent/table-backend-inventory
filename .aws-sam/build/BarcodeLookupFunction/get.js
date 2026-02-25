const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();

const { TABLE_NAME } = process.env;

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
        // Get the ID from the path parameters (e.g. /products/123)
        const id = (event.pathParameters || {}).id;

        if (!id) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: 'Product ID is required' })
            };
        }

        // Fetch the item from DynamoDB
        const result = await ddb.get({
            TableName: TABLE_NAME,
            Key: { id }
        }).promise();

        // Check if item was found
        if (!result.Item) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ message: 'Product not found' })
            };
        }

        // Return the found item
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result.Item)
        };

    } catch (err) {
        console.error('Get product failed', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message: 'Failed to retrieve product', error: err.message })
        };
    }
};
