/**
 * Lambda proxy for barcodelookup.com API.
 * Bypasses CORS restrictions by making the API call server-side.
 *
 * Expects POST body: { barcode: "...", apiKey: "..." }
 * Returns the barcodelookup.com JSON response.
 */

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

exports.handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { barcode, apiKey } = body;

        if (!barcode || typeof barcode !== 'string') {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: 'barcode is required' })
            };
        }

        if (!apiKey || typeof apiKey !== 'string') {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: 'apiKey is required' })
            };
        }

        // Clean barcode (digits only)
        const cleanBarcode = barcode.trim().replace(/[^0-9]/g, '');
        if (cleanBarcode.length < 6) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: 'barcode must be at least 6 digits' })
            };
        }

        // Call barcodelookup.com API server-side (no CORS issues)
        const apiUrl = `https://api.barcodelookup.com/v3/products?barcode=${encodeURIComponent(cleanBarcode)}&formatted=y&key=${encodeURIComponent(apiKey.trim())}`;

        const resp = await fetch(apiUrl);
        const text = await resp.text();

        // Forward the response status and body
        return {
            statusCode: resp.status,
            headers,
            body: text
        };
    } catch (err) {
        console.error('Barcode lookup proxy error:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message: 'Barcode lookup proxy failed', error: err.message })
        };
    }
};
