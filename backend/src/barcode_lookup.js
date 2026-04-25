/**
 * Lambda proxy for UPC barcode lookup.
 * No API key required — uses UPCitemdb (100/day free) with Open Food Facts fallback.
 *
 * Expects POST body: { barcode: "..." }
 * Returns: { products: [{ name, description, brand, category, barcode_number, images }] }
 */

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { barcode } = body;

        if (!barcode || typeof barcode !== 'string') {
            return { statusCode: 400, headers, body: JSON.stringify({ message: 'barcode is required' }) };
        }

        const cleanBarcode = barcode.trim().replace(/[^0-9]/g, '');
        if (cleanBarcode.length < 6) {
            return { statusCode: 400, headers, body: JSON.stringify({ message: 'barcode must be at least 6 digits' }) };
        }

        // --- Source 1: UPCitemdb (100 free lookups/day, no key) ---
        try {
            const upcResp = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${cleanBarcode}`, {
                headers: { 'Accept': 'application/json' }
            });
            console.log(`upcitemdb: ${upcResp.status}`);
            if (upcResp.ok) {
                const data = await upcResp.json();
                if (data.items && data.items.length > 0) {
                    const item = data.items[0];
                    return {
                        statusCode: 200, headers,
                        body: JSON.stringify({
                            products: [{
                                name: item.title || '',
                                description: item.description || '',
                                brand: item.brand || '',
                                category: item.category || '',
                                barcode_number: cleanBarcode,
                                images: item.images || []
                            }]
                        })
                    };
                }
            }
        } catch (e) { console.log('upcitemdb error:', e.message); }

        // --- Source 2: Open Food Facts (unlimited free, food products) ---
        try {
            const offResp = await fetch(
                `https://world.openfoodfacts.org/api/v2/product/${cleanBarcode}.json?fields=product_name,brands,categories,image_url,ingredients_text`,
                { headers: { 'Accept': 'application/json' } }
            );
            console.log(`openfoodfacts: ${offResp.status}`);
            if (offResp.ok) {
                const data = await offResp.json();
                if (data.status === 1 && data.product) {
                    const p = data.product;
                    return {
                        statusCode: 200, headers,
                        body: JSON.stringify({
                            products: [{
                                name: p.product_name || '',
                                description: p.ingredients_text || '',
                                brand: p.brands || '',
                                category: p.categories || '',
                                barcode_number: cleanBarcode,
                                images: p.image_url ? [p.image_url] : []
                            }]
                        })
                    };
                }
            }
        } catch (e) { console.log('openfoodfacts error:', e.message); }

        return { statusCode: 404, headers, body: JSON.stringify({ message: 'Product not found for this barcode.' }) };

    } catch (err) {
        console.error('Barcode lookup proxy error:', err);
        return { statusCode: 500, headers, body: JSON.stringify({ message: 'Lookup failed', error: err.message }) };
    }
};
