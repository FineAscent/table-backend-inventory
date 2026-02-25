/**
 * Lambda proxy for downloading external images.
 * Bypasses CORS restrictions by fetching the image server-side
 * and returning it as a base64-encoded data URI.
 *
 * Expects POST body: { url: "https://..." }
 * Returns: { dataUrl: "data:image/jpeg;base64,..." }
 */

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB limit

exports.handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { url } = body;

        if (!url || typeof url !== 'string') {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: 'url is required' })
            };
        }

        // Basic URL validation — only allow http/https
        let parsed;
        try {
            parsed = new URL(url);
        } catch (_) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: 'Invalid URL' })
            };
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: 'Only http and https URLs are allowed' })
            };
        }

        // Fetch the image server-side (no CORS issues)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);

        const resp = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ImageProxy/1.0)',
                'Accept': 'image/*,*/*'
            }
        });
        clearTimeout(timeout);

        if (!resp.ok) {
            return {
                statusCode: resp.status,
                headers,
                body: JSON.stringify({ message: `Image fetch failed: ${resp.status} ${resp.statusText}` })
            };
        }

        // Read the body as an ArrayBuffer
        const arrayBuffer = await resp.arrayBuffer();

        if (arrayBuffer.byteLength > MAX_SIZE) {
            return {
                statusCode: 413,
                headers,
                body: JSON.stringify({ message: 'Image too large (max 5 MB)' })
            };
        }

        // Determine content type
        const contentType = resp.headers.get('content-type') || 'image/jpeg';

        // Convert to base64
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const dataUrl = `data:${contentType};base64,${base64}`;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ dataUrl, contentType, size: arrayBuffer.byteLength })
        };
    } catch (err) {
        console.error('Image proxy error:', err);
        const message = err.name === 'AbortError'
            ? 'Image download timed out'
            : `Image proxy failed: ${err.message}`;
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message })
        };
    }
};
