// Backend API Configuration
const API_BASE_URL = 'https://q5mv3u14v5.execute-api.us-east-1.amazonaws.com/Prod';
window.API_BASE_URL = API_BASE_URL;

// Cognito (Admin) Auth Configuration
const COGNITO_DOMAIN = 'https://store-alibaba-inventory-dev-admin.auth.us-east-1.amazoncognito.com';
const COGNITO_CLIENT_ID = '7lop8c4imce82rgrh9sn1mb009';
const REDIRECT_URI = 'https://fineascent.github.io/table-backend-inventory/';

// Simple auth state helpers
function getIdToken() {
    return window.localStorage.getItem('id_token') || '';
}

async function pickSuggestedImageMain(imgUrl) {
    // Place into slot 0. If slot 0 was occupied and slot 1 is empty, shift old main to slot 1; otherwise mark old for deletion
    const prevMain = selectedImages[0];
    await pickSuggestedImage(0, imgUrl);
    if (prevMain && prevMain.existing && prevMain.key) {
        // try to keep previous main in slot 1 if empty; else delete
        if (!selectedImages[1]) {
            selectedImages[1] = prevMain;
            updateCarouselUI();
        } else {
            deleteKeys = deleteKeys || [];
            if (!deleteKeys.includes(prevMain.key)) deleteKeys.push(prevMain.key);
        }
    }
}

// ===== Suggested images (multiple candidates) =====
async function searchPixabayImages(query, { tokens = [], negative = [], useWhiteFilter = true, includeCategory = true } = {}, limit = 12) {
    const key = getPixabayApiKey();
    if (!key) return [];
    try {
        const q = encodeURIComponent(query);
        const base = `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${q}&image_type=photo${includeCategory ? `&category=food` : ''}&per_page=${Math.min(50, Math.max(5, limit * 2))}&orientation=horizontal&safesearch=true&order=popular`;
        const url = useWhiteFilter ? `${base}&colors=white` : base;
        const resp = await fetch(url);
        if (!resp.ok) return [];
        const data = await resp.json();
        const hits = (data && data.hits) || [];
        if (!hits.length) return [];
        const tset = new Set((tokens || []).map(t => t.toLowerCase()));
        const nset = new Set((negative || []).map(t => t.toLowerCase()));
        const scored = hits.map(h => {
            const tags = (h.tags || '').toLowerCase();
            const matched = countNameTokenHits(tags, tset);
            let score = matched * 8;
            if (tset.size && matched === tset.size) score += 12;
            if (tset.size && matched === 0) score -= 20;
            if (tags.includes('isolated')) score += 2;
            if (tags.includes('white')) score += 1;
            score += Math.min(4, Math.floor(((h.imageWidth || 0) + (h.imageHeight || 0)) / 1000));
            score += Math.min(5, (h.likes || 0) / 50);
            for (const n of nset) if (n && tags.includes(n)) score -= 5;
            const url = h.largeImageURL || h.webformatURL || '';
            if (typeof assignedImageUrlsSession !== 'undefined' && assignedImageUrlsSession.has(url)) score -= 10;
            return { url, score, matched };
        }).filter(x => x.url);
        const nameHits = scored.filter(x => x.matched > 0);
        const ranked = (nameHits.length ? nameHits : scored).sort((a, b) => b.score - a.score);
        const unique = [];
        const seen = new Set();
        for (const s of ranked) {
            if (!seen.has(s.url)) { seen.add(s.url); unique.push(s.url); }
            if (unique.length >= limit) break;
        }
        return unique;
    } catch (_) { return []; }
}

async function searchUnsplashImages(query, limit = 8) {
    const clientId = window.localStorage.getItem('unsplash_access_key') || '';
    if (!clientId) return [];
    try {
        const q = encodeURIComponent(query);
        const url = `https://api.unsplash.com/search/photos?query=${q}&per_page=${Math.min(30, Math.max(5, limit))}&content_filter=high&orientation=landscape&client_id=${encodeURIComponent(clientId)}`;
        const resp = await fetch(url);
        if (!resp.ok) return [];
        const data = await resp.json();
        const results = (data && data.results) || [];
        const tokens = buildNameTokens(query);
        const unique = [];
        const seen = new Set();
        for (const r of results) {
            const u = (r.urls && (r.urls.full || r.urls.regular)) || '';
            if (!u || seen.has(u)) continue;
            seen.add(u);
            const desc = `${r.alt_description || ''} ${(r.description || '')}`.toLowerCase();
            const matched = countNameTokenHits(desc, new Set(tokens));
            unique.push({ u, matched });
        }
        const nameHits = unique.filter(x => x.matched > 0);
        const ranked = (nameHits.length ? nameHits : unique).sort((a, b) => b.matched - a.matched);
        return ranked.map(x => x.u).slice(0, limit);
    } catch (_) { return []; }
}

async function suggestImagesForCurrentProduct() {
    try {
        const name = (document.getElementById('product-name')?.value || '').trim();
        if (!name) {
            showError('Enter a product name first to get suggestions.');
            return;
        }
        // Clear previous and show loading state
        const container = document.getElementById('suggested-images');
        if (container) container.innerHTML = '<div style="color:#666;">Loading suggestions…</div>';
        // Ensure keys
        const hasPixabay = !!(await ensurePixabayKeyOrPrompt());
        const unsplashKey = window.localStorage.getItem('unsplash_access_key') || '';
        const tokens = buildNameTokens(name);
        const variants = buildQueryVariants(name);
        let urls = [];
        if (hasPixabay) {
            for (const v of variants) {
                urls = await searchPixabayImages(v, { tokens, useWhiteFilter: false, includeCategory: false }, 12);
                if (urls.length) break;
            }
            if (urls.length === 0) {
                for (const v of variants) {
                    urls = await searchPixabayImages(v, { tokens, useWhiteFilter: false, includeCategory: true }, 12);
                    if (urls.length) break;
                }
            }
        }
        if (urls.length === 0 && unsplashKey) {
            for (const v of variants) {
                urls = await searchUnsplashImages(v, 12);
                if (urls.length) break;
            }
        }
        // We skip Wikipedia for multi-suggestions to avoid mixed licenses
        urls = Array.from(new Set(urls));
        if (!urls.length && !hasPixabay && !unsplashKey) {
            renderSuggestedImages([]);
            showError('No image providers configured. Set a Pixabay key (recommended) or Unsplash access key in localStorage.');
        } else {
            renderSuggestedImages(urls);
        }
    } catch (err) {
        showError('Failed to fetch suggestions: ' + (err && err.message ? err.message : err));
    }
}

// Debounce helper for auto-refreshing suggestions upon typing
function debounce(fn, wait) {
    let t = null;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    }
}

function renderSuggestedImages(urls) {
    const container = document.getElementById('suggested-images');
    if (!container) return;
    if (!urls || urls.length === 0) {
        container.innerHTML = '<div style="color:#666;">No suggestions found.</div>';
        return;
    }
    const cards = urls.slice(0, 16).map(u => {
        return `
                    <div style="display:flex; flex-direction:column; gap:6px; border:1px solid #eee; padding:8px; border-radius:8px; background:#fff;">
                        <img src="${u}" alt="suggested" style="width:100%; height:100px; object-fit:contain; background:#fff; border:1px solid #f0f0f0;"/>
                        <div style="display:flex; gap:6px;">
                            <button type="button" class="action-btn" onclick="pickSuggestedImageMain('${u.replace(/'/g, "\'")}')">Use as Main</button>
                            <button type="button" class="action-btn" onclick="pickSuggestedImage(0, '${u.replace(/'/g, "\'")}')">Use as 1</button>
                            <button type="button" class="action-btn" onclick="pickSuggestedImage(1, '${u.replace(/'/g, "\'")}')">Use as 2</button>
                        </div>
                    </div>`;
    });
    container.innerHTML = cards.join('');
}

async function pickSuggestedImage(slot, imgUrl) {
    try {
        const name = (document.getElementById('product-name')?.value || 'image').trim();
        // Fetch and process to 760x600 PNG preserving transparency, but do NOT upload yet; prepare for Save
        const resp = await fetch(imgUrl, { mode: 'cors' });
        if (!resp.ok) throw new Error('fetch failed');
        const orig = await resp.blob();
        const processed = await renderToFixedCanvasPng(orig, 760, 600);
        if (!processed) throw new Error('process failed');
        const file = new File([processed], `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image'}-${Date.now()}.png`, { type: 'image/png' });
        const url = URL.createObjectURL(processed);
        // If replacing an existing persisted image, mark it for deletion
        const prev = selectedImages[slot];
        if (prev && prev.existing && prev.key) {
            deleteKeys = deleteKeys || [];
            if (!deleteKeys.includes(prev.key)) deleteKeys.push(prev.key);
        }
        selectedImages[slot] = { file, url, width: 760, height: 600 };
        const firstIdx = selectedImages.findIndex(x => !!x);
        carouselIndex = firstIdx >= 0 ? firstIdx : slot;
        updateCarouselUI();
        showSuccess(`Selected suggestion for slot ${slot + 1}.`);
    } catch (err) {
        showError('Failed to select suggested image: ' + (err && err.message ? err.message : err));
    }
}

// Expose to window for UI hooks
window.suggestImagesForCurrentProduct = suggestImagesForCurrentProduct;
window.pickSuggestedImage = pickSuggestedImage;

function clearSuggestedImages() {
    const el = document.getElementById('suggested-images');
    if (el) el.innerHTML = '';
}

let detachSuggestListeners = null;
function attachSuggestionAutoRefresh() {
    try {
        // Detach previous if present
        if (typeof detachSuggestListeners === 'function') detachSuggestListeners();
        const nameEl = document.getElementById('product-name');
        const handler = debounce(() => {
            const hasName = (nameEl?.value || '').trim().length > 0;
            if (hasName) suggestImagesForCurrentProduct();
        }, 500);
        nameEl && nameEl.addEventListener('input', handler);
        detachSuggestListeners = () => {
            try { nameEl && nameEl.removeEventListener('input', handler); } catch (_) { }
        };
    } catch (_) { /* ignore */ }
}

// =====================
// Auto-assign images via free APIs (Pixabay primary, Unsplash fallback, Wikipedia last-resort)
// Target: grocery items on white background
// =====================
function getPixabayApiKey() {
    return window.localStorage.getItem('pixabay_api_key') || '';
}

function setPixabayApiKey(key) {
    if (key) window.localStorage.setItem('pixabay_api_key', key.trim());
}

async function ensurePixabayKeyOrPrompt() {
    let key = getPixabayApiKey();
    if (!key) {
        key = window.prompt('Enter your Pixabay API key to auto-assign product images:', '');
        if (key && key.trim()) {
            setPixabayApiKey(key.trim());
        }
    }
    return getPixabayApiKey();
}

function cleanProductName(name) {
    return (name || '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\b\d+\s*(ct|pk|lb|lbs|oz|g|kg|pack|count)\b/gi, ' ')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildNameTokens(name) {
    const stop = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'with', 'for', 'pack', 'pcs', 'piece', 'pieces', 'fresh']);
    return Array.from(new Set(cleanProductName(name).toLowerCase()
        .split(/\s+/)
        .filter(w => w && !stop.has(w) && w.length >= 3)));
}

function countNameTokenHits(text, tokens) {
    const hay = (text || '').toLowerCase();
    let matched = 0;
    for (const t of tokens) {
        if (!t) continue;
        if (hay.includes(t)) { matched++; continue; }
        const stem = t.endsWith('s') ? t.slice(0, -1) : t;
        if (stem.length >= 3 && hay.includes(stem)) matched++;
    }
    return matched;
}

function buildQueryVariants(name) {
    const cleaned = cleanProductName(name);
    return cleaned ? [cleaned] : [];
}

async function searchPixabayImage(query, { tokens = [], negative = [] } = {}) {
    const key = getPixabayApiKey();
    if (!key) return null;
    try {
        const q = encodeURIComponent(query);
        const url = `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${q}&image_type=photo&category=food&per_page=15&orientation=horizontal&safesearch=true&colors=white&order=popular`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        const hits = (data && data.hits) || [];
        if (!hits.length) return null;
        const tset = new Set(tokens.map(t => t.toLowerCase()));
        const nset = new Set((negative || []).map(t => t.toLowerCase()));
        const scored = hits.map(h => {
            const tags = (h.tags || '').toLowerCase();
            let score = 0;
            // prefer white/isolated keywords
            if (tags.includes('isolated')) score += 3;
            if (tags.includes('white')) score += 2;
            // token matches
            for (const t of tset) if (t && tags.includes(t)) score += 4;
            // size preference
            score += Math.min(4, Math.floor(((h.imageWidth || 0) + (h.imageHeight || 0)) / 1000));
            // likes as tie-breaker
            score += Math.min(5, (h.likes || 0) / 50);
            // penalize negatives
            for (const n of nset) if (n && tags.includes(n)) score -= 5;
            // penalize if already used
            const url = h.largeImageURL || h.webformatURL || '';
            if (assignedImageUrlsSession.has(url)) score -= 10;
            return { h, score };
        })
            .filter(x => x.score > -1) // drop very poor matches
            .sort((a, b) => b.score - a.score);
        const pick = scored.length ? scored[0].h : hits[0];
        const chosen = pick && (pick.largeImageURL || pick.webformatURL) || null;
        return chosen;
    } catch (_) { return null; }
}

async function searchUnsplashImage(query) {
    // Optional: use client_id if configured via localStorage to improve quota; otherwise rely on public hotlinking which may be rate limited/blocked
    const clientId = window.localStorage.getItem('unsplash_access_key') || '';
    if (!clientId) return null;
    try {
        const q = encodeURIComponent(query);
        const url = `https://api.unsplash.com/search/photos?query=${q}&per_page=5&content_filter=high&orientation=landscape&client_id=${encodeURIComponent(clientId)}`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        const results = (data && data.results) || [];
        if (!results.length) return null;
        // Prefer results with white backgrounds by checking tags/alt_description
        let pick = results.find(r => (r.alt_description || '').toLowerCase().includes('white background')) || results[0];
        // Use full or regular URLs
        return (pick && (pick.urls && (pick.urls.full || pick.urls.regular))) || null;
    } catch (_) { return null; }
}

async function searchWikipediaImage(query) {
    try {
        const q = encodeURIComponent(query);
        const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${q}&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=800&format=json&origin=*`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        if (!data || !data.query || !data.query.pages) return null;
        const pages = Object.values(data.query.pages);
        if (!pages.length) return null;
        const page = pages[0];
        const thumb = page && page.thumbnail && page.thumbnail.source;
        return thumb || null;
    } catch (_) { return null; }
}

async function searchGroceryImage(name) {
    const tokens = buildNameTokens(name);
    const variants = buildQueryVariants(name);
    for (const v of variants) {
        const urls = await searchPixabayImages(v, { tokens, useWhiteFilter: false, includeCategory: false }, 1);
        if (urls.length) return urls[0];
    }
    const query = cleanProductName(name) || name;
    const unsplash = await searchUnsplashImage(query);
    if (unsplash) return unsplash;
    return await searchWikipediaImage(query);
}

// Fit imported images without stretching, preserving alpha in a 760x600 PNG.
async function renderToFixedCanvasPng(blob, targetW = 760, targetH = 600) {
    // Create bitmap or HTMLImageElement
    let bitmap = null;
    try {
        if ('createImageBitmap' in window) {
            bitmap = await createImageBitmap(blob);
        }
    } catch (_) { bitmap = null; }
    if (!bitmap) {
        const url = URL.createObjectURL(blob);
        try {
            const img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.crossOrigin = 'anonymous';
                el.onload = () => resolve(el);
                el.onerror = reject;
                el.src = url;
            });
            // Draw using HTMLImageElement
            const canvas = document.createElement('canvas');
            canvas.width = targetW; canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            const iw = img.naturalWidth || img.width; const ih = img.naturalHeight || img.height;
            const scale = Math.min(targetW / iw, targetH / ih);
            const dw = Math.floor(iw * scale); const dh = Math.floor(ih * scale);
            const dx = Math.floor((targetW - dw) / 2); const dy = Math.floor((targetH - dh) / 2);
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, dx, dy, dw, dh);
            const out = await new Promise(res => canvas.toBlob(res, 'image/png'));
            return out;
        } finally {
            URL.revokeObjectURL(url);
        }
    } else {
        // Draw using ImageBitmap
        const canvas = document.createElement('canvas');
        canvas.width = targetW; canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        const iw = bitmap.width; const ih = bitmap.height;
        const scale = Math.min(targetW / iw, targetH / ih);
        const dw = Math.floor(iw * scale); const dh = Math.floor(ih * scale);
        const dx = Math.floor((targetW - dw) / 2); const dy = Math.floor((targetH - dh) / 2);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, dx, dy, dw, dh);
        const out = await new Promise(res => canvas.toBlob(res, 'image/png'));
        try { bitmap.close && bitmap.close(); } catch (_) { }
        return out;
    }
}

async function fetchAndUploadImage(imageUrl, product, attemptName) {
    try {
        const resp = await fetch(imageUrl, { mode: 'cors' });
        if (!resp.ok) throw new Error(`image fetch ${resp.status}`);
        const originalBlob = await resp.blob();
        // Normalize to 760x600 PNG preserving transparency
        const processed = await renderToFixedCanvasPng(originalBlob, 760, 600);
        if (!processed) throw new Error('failed to process image');
        const contentType = 'image/png';
        // File naming
        const safeBase = (attemptName || product.name || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
        const fileName = `${safeBase}-${Date.now()}.png`;
        const { uploadUrl, key } = await dbService.getUploadUrl({ fileName, contentType, productId: product.id });
        const putResp = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: processed });
        if (!putResp.ok) {
            const t = await putResp.text();
            throw new Error(`upload failed ${putResp.status}: ${t}`);
        }
        return key;
    } catch (e) {
        console.warn('fetchAndUploadImage failed', e);
        return null;
    }
}

async function autoAssignImagesForAll() {
    try {
        showLoading(true);
        let updated = 0;
        let skipped = 0;
        // Refresh products to ensure latest
        if (!products || !products.length) {
            await loadProducts();
        }
        // Ensure Pixabay key configured (prompt once)
        const key = await ensurePixabayKeyOrPrompt();
        if (!key) {
            showError('Pixabay API key is required to auto-assign images. You can also set an Unsplash key in localStorage under "unsplash_access_key".');
            return;
        }
        assignedImageUrlsSession = new Set();
        for (const p of products) {
            const existingKeys = Array.isArray(p.imageKeys) ? p.imageKeys : (p.image_keys || []);
            if (existingKeys && existingKeys.length > 0) { skipped++; continue; }
            const imgUrl = await searchGroceryImage(p.name, p.category, p.description);
            if (!imgUrl) { skipped++; continue; }
            const key = await fetchAndUploadImage(imgUrl, p, p.name);
            if (!key) { skipped++; continue; }
            assignedImageUrlsSession.add(imgUrl);
            try {
                await dbService.putProduct({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    category: p.category,
                    price: Number(p.price),
                    priceUnit: p.priceUnit || 'piece',
                    barcode: p.barcode,
                    availability: p.availability,
                    areaLocation: p.areaLocation || 'A1',
                    scaleNeed: p.scaleNeed === true,
                    imageKeys: [key]
                });
                updated++;
            } catch (err) {
                console.warn('putProduct failed', err);
            }
        }
        await loadProducts();
        showSuccess(`Auto-assign complete. Updated: ${updated}. Skipped: ${skipped}.`);
    } catch (err) {
        showError('Auto-assign images failed: ' + (err && err.message ? err.message : err));
    } finally {
        showLoading(false);
    }
}

// Expose to window for button click
window.autoAssignImagesForAll = autoAssignImagesForAll;

// =====================
// Bulk remove all images
// =====================
async function removeAllImages() {
    if (!confirm('Remove all images from all products? This cannot be undone.')) return;
    try {
        showLoading(true);
        // Ensure we have latest list
        if (!products || !products.length) {
            await loadProducts();
        }
        let changed = 0; let skipped = 0;
        for (const p of products) {
            const existingKeys = Array.isArray(p.imageKeys) ? p.imageKeys : (p.image_keys || []);
            if (!existingKeys || existingKeys.length === 0) { skipped++; continue; }
            try {
                await dbService.putProduct({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    category: p.category,
                    price: Number(p.price),
                    priceUnit: p.priceUnit || 'piece',
                    barcode: p.barcode,
                    availability: p.availability,
                    areaLocation: p.areaLocation || 'A1',
                    scaleNeed: p.scaleNeed === true,
                    imageKeys: [],
                    deleteKeys: existingKeys
                });
                changed++;
            } catch (err) {
                console.warn('removeAllImages: putProduct failed for', p.id, err);
            }
        }
        await loadProducts();
        showSuccess(`Remove images complete. Updated: ${changed}. Skipped (no images): ${skipped}.`);
    } catch (err) {
        showError('Remove all images failed: ' + (err && err.message ? err.message : err));
    } finally {
        showLoading(false);
    }
}

window.removeAllImages = removeAllImages;

// =====================
// Barcode Lookup (barcodelookup.com) Integration
// =====================

// API key management (same pattern as Pixabay)
function getBarcodeLookupApiKey() {
    return window.localStorage.getItem('barcodelookup_api_key') || '';
}

function setBarcodeLookupApiKey(key) {
    if (key) window.localStorage.setItem('barcodelookup_api_key', key.trim());
}

async function ensureBarcodeLookupKeyOrPrompt() {
    let key = getBarcodeLookupApiKey();
    if (!key) {
        key = window.prompt(
            'Enter your Barcode Lookup API key (from barcodelookup.com/api).\n\n' +
            'Sign up at barcodelookup.com to get your key:',
            ''
        );
        if (key && key.trim()) {
            setBarcodeLookupApiKey(key.trim());
        }
    }
    return getBarcodeLookupApiKey();
}

// Core lookup function — calls our Lambda proxy (UPCitemdb + Open Food Facts, no API key needed)
async function fetchBarcodeLookup(barcode) {
    const cleanBarcode = (barcode || '').trim().replace(/[^0-9]/g, '');
    if (!cleanBarcode || cleanBarcode.length < 6) {
        throw new Error('Please enter a valid barcode (at least 6 digits).');
    }

    const proxyUrl = `${API_BASE_URL}/barcode-lookup`;
    const headers = { 'Content-Type': 'application/json' };
    const token = getIdToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetch(proxyUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ barcode: cleanBarcode })
    });

    if (resp.status === 404) {
        throw new Error('Product not found for this barcode.');
    }
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Barcode lookup failed (${resp.status}). ${t}`);
    }

    const data = await resp.json();
    const products = data && data.products;
    if (!products || !products.length) {
        throw new Error('No product data returned for this barcode.');
    }
    return products[0];
}

// Parse API response into a clean product object
function parseBarcodeLookupResult(apiProduct) {
    const result = {
        name: apiProduct.title || apiProduct.product_name || '',
        description: apiProduct.description || '',
        brand: apiProduct.brand || '',
        category: apiProduct.category || '',
        barcode: apiProduct.barcode_number || '',
        imageUrl: '',
        allImages: []
    };

    // Get images (API returns an images array of URLs)
    if (Array.isArray(apiProduct.images) && apiProduct.images.length > 0) {
        result.imageUrl = apiProduct.images[0];
        result.allImages = apiProduct.images.slice(0, 2); // max 2 images
    }

    return result;
}

// Download an image URL as a File object for the image picker
// Tries direct fetch first, then falls back to Lambda image proxy to bypass CORS
async function downloadImageAsFile(imageUrl, fileName) {
    const safeName = (fileName || 'barcode-image').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) + '.png';

    // Strategy 1: Direct fetch with CORS (fast path — works if CDN allows it)
    try {
        const resp = await fetch(imageUrl, { mode: 'cors' });
        if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
        const blob = await resp.blob();
        const processed = await renderToFixedCanvasPng(blob, 760, 600);
        if (!processed) throw new Error('Image processing failed');
        console.log('downloadImageAsFile: direct fetch succeeded');
        return new File([processed], safeName, { type: 'image/png' });
    } catch (e) {
        console.warn('downloadImageAsFile: direct fetch failed, trying Lambda proxy:', e.message);
    }

    // Strategy 2: Lambda image proxy (downloads server-side, returns base64 — bypasses CORS entirely)
    try {
        const proxyUrl = `${API_BASE_URL}/image-proxy`;
        const headers = { 'Content-Type': 'application/json' };
        const token = getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const resp = await fetch(proxyUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ url: imageUrl })
        });

        if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            throw new Error(`Proxy returned ${resp.status}: ${t}`);
        }

        const data = await resp.json();
        if (!data.dataUrl) throw new Error('No dataUrl in proxy response');

        // Convert data URL to blob
        const dataResp = await fetch(data.dataUrl);
        const blob = await dataResp.blob();

        // Process to standardized 760x600 PNG
        const processed = await renderToFixedCanvasPng(blob, 760, 600);
        if (!processed) throw new Error('Image processing after proxy failed');

        console.log('downloadImageAsFile: Lambda proxy succeeded');
        return new File([processed], safeName, { type: 'image/png' });
    } catch (e2) {
        console.warn('downloadImageAsFile: Lambda proxy failed:', e2.message);
    }

    // Strategy 3: Load via <img crossOrigin="anonymous"> + draw to canvas (last resort)
    try {
        const blob = await new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = 760;
                    canvas.height = 600;
                    const ctx = canvas.getContext('2d');
                    const iw = img.naturalWidth || img.width;
                    const ih = img.naturalHeight || img.height;
                    const scale = Math.min(760 / iw, 600 / ih);
                    const dw = Math.floor(iw * scale);
                    const dh = Math.floor(ih * scale);
                    const dx = Math.floor((760 - dw) / 2);
                    const dy = Math.floor((600 - dh) / 2);
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, dx, dy, dw, dh);
                    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob null')), 'image/png');
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = () => reject(new Error('img load failed'));
            img.src = imageUrl;
        });
        if (blob) {
            console.log('downloadImageAsFile: img+canvas fallback succeeded');
            return new File([blob], safeName, { type: 'image/png' });
        }
    } catch (e3) {
        console.warn('downloadImageAsFile: all strategies failed:', e3.message);
    }

    return null;
}

// Set a downloaded image file into the product modal's image slot
function setImageInSlot(file, slotIdx) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        selectedImages[slotIdx] = { file, url, width: img.naturalWidth, height: img.naturalHeight };
        carouselIndex = slotIdx;
        updateCarouselUI();
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        console.warn('Failed to load downloaded image into slot', slotIdx);
    };
    img.src = url;
}

// =====================
// In-modal "Lookup" button (inside Add/Edit Product modal)
// =====================
async function lookupBarcode() {
    const barcodeInput = document.getElementById('product-barcode');
    const statusEl = document.getElementById('barcode-lookup-status');
    const lookupBtn = document.getElementById('barcode-lookup-btn');
    const barcode = (barcodeInput && barcodeInput.value || '').trim();

    if (!barcode) {
        if (statusEl) statusEl.innerHTML = '<span class="lookup-error">Please enter a barcode first.</span>';
        return;
    }

    // Show loading
    if (statusEl) statusEl.innerHTML = '<span class="lookup-loading"><span class="spinner"></span> Looking up barcode...</span>';
    if (lookupBtn) lookupBtn.disabled = true;

    try {
        const apiProduct = await fetchBarcodeLookup(barcode);
        const result = parseBarcodeLookupResult(apiProduct);

        // Auto-fill name
        const nameInput = document.getElementById('product-name');
        if (nameInput && result.name) {
            nameInput.value = result.name;
        }

        // Auto-fill description if empty
        const descInput = document.getElementById('product-description');
        if (descInput && !descInput.value.trim() && result.description) {
            // Truncate long descriptions
            descInput.value = result.description.length > 300
                ? result.description.slice(0, 297) + '...'
                : result.description;
        }

        // Download and attach images
        let imageCount = 0;
        if (result.allImages.length > 0) {
            for (let i = 0; i < Math.min(result.allImages.length, 2); i++) {
                if (selectedImages[i]) continue; // don't overwrite existing images
                const file = await downloadImageAsFile(result.allImages[i], result.name || 'product');
                if (file) {
                    setImageInSlot(file, i);
                    imageCount++;
                }
            }
        }

        // Success message
        const parts = [];
        if (result.name) parts.push(`Name: "${result.name}"`);
        if (imageCount > 0) parts.push(`${imageCount} image${imageCount > 1 ? 's' : ''} loaded`);
        if (result.brand) parts.push(`Brand: ${result.brand}`);

        if (statusEl) {
            statusEl.innerHTML = `<span class="lookup-success">✓ Found! ${parts.join(' · ')}</span>`;
            setTimeout(() => { if (statusEl) statusEl.innerHTML = ''; }, 6000);
        }

        // Trigger image suggestions refresh
        if (typeof suggestImagesForCurrentProduct === 'function') {
            setTimeout(() => suggestImagesForCurrentProduct(), 100);
        }
    } catch (err) {
        if (statusEl) statusEl.innerHTML = `<span class="lookup-error">✗ ${err.message}</span>`;
    } finally {
        if (lookupBtn) lookupBtn.disabled = false;
    }
}

// =====================
// "Add by Barcode" Quick-Scan Modal
// =====================
let scannedProductData = null; // stores the parsed result for the "Add" action

function openBarcodeLookupModal() {
    const overlay = document.getElementById('barcode-modal-overlay');
    if (!overlay) return;
    overlay.classList.add('open');
    scannedProductData = null;
    // Reset UI
    const input = document.getElementById('scan-barcode-input');
    if (input) { input.value = ''; input.focus(); }
    const status = document.getElementById('scan-status');
    if (status) status.innerHTML = '';
    const card = document.getElementById('scan-result-card');
    if (card) card.classList.remove('show');
    const addBtn = document.getElementById('scan-add-btn');
    if (addBtn) addBtn.disabled = true;
}

function closeBarcodeLookupModal() {
    const overlay = document.getElementById('barcode-modal-overlay');
    if (overlay) overlay.classList.remove('open');
    scannedProductData = null;
}

async function scanBarcodeLookup() {
    const input = document.getElementById('scan-barcode-input');
    const statusEl = document.getElementById('scan-status');
    const card = document.getElementById('scan-result-card');
    const goBtn = document.getElementById('scan-go-btn');
    const addBtn = document.getElementById('scan-add-btn');
    const barcode = (input && input.value || '').trim();

    if (!barcode) {
        if (statusEl) statusEl.innerHTML = '<span class="lookup-error">Please enter a barcode.</span>';
        return;
    }

    // Loading
    if (statusEl) statusEl.innerHTML = '<span class="lookup-loading"><span class="spinner"></span> Searching barcodelookup.com...</span>';
    if (goBtn) goBtn.disabled = true;
    if (addBtn) addBtn.disabled = true;
    if (card) card.classList.remove('show');

    try {
        const apiProduct = await fetchBarcodeLookup(barcode);
        const result = parseBarcodeLookupResult(apiProduct);
        scannedProductData = result;

        // Populate result card
        const nameEl = document.getElementById('scan-result-name');
        const brandEl = document.getElementById('scan-result-brand');
        const barcodeEl = document.getElementById('scan-result-barcode');
        const imgEl = document.getElementById('scan-result-img');

        if (nameEl) nameEl.textContent = result.name || 'Unknown Product';
        if (brandEl) brandEl.textContent = result.brand ? `Brand: ${result.brand}` : '';
        if (barcodeEl) barcodeEl.textContent = `Barcode: ${result.barcode}`;
        if (imgEl) {
            if (result.imageUrl) {
                imgEl.src = result.imageUrl;
                imgEl.style.display = 'block';
            } else {
                imgEl.style.display = 'none';
            }
        }

        // Show card
        if (card) card.classList.add('show');
        if (addBtn) addBtn.disabled = false;
        if (statusEl) statusEl.innerHTML = '<span class="lookup-success">✓ Product found! Review below and click "Add to Products".</span>';
    } catch (err) {
        scannedProductData = null;
        if (statusEl) statusEl.innerHTML = `<span class="lookup-error">✗ ${err.message}</span>`;
        if (card) card.classList.remove('show');
        if (addBtn) addBtn.disabled = true;
    } finally {
        if (goBtn) goBtn.disabled = false;
    }
}

// Use the scanned result — opens the standard Add Product modal pre-filled
async function useScannedProduct() {
    if (!scannedProductData) return;
    const data = scannedProductData;

    // Close the barcode modal
    closeBarcodeLookupModal();

    // Open the standard Add Product modal
    openAddProductModal();

    // Fill in fields
    const nameInput = document.getElementById('product-name');
    if (nameInput && data.name) nameInput.value = data.name;

    const descInput = document.getElementById('product-description');
    if (descInput && data.description) {
        descInput.value = data.description.length > 300
            ? data.description.slice(0, 297) + '...'
            : data.description;
    }

    const barcodeInput = document.getElementById('product-barcode');
    if (barcodeInput && data.barcode) barcodeInput.value = data.barcode;

    // Download and attach images to the carousel
    if (data.allImages && data.allImages.length > 0) {
        const modalError = document.getElementById('modal-error');
        if (modalError) modalError.innerHTML = '<div style="color:#2563eb;padding:8px 12px;background:#eff6ff;border-radius:8px;margin-bottom:8px;font-size:13px;">📦 Downloading product images from barcode lookup...</div>';

        let attachedCount = 0;
        for (let i = 0; i < Math.min(data.allImages.length, 2); i++) {
            const file = await downloadImageAsFile(data.allImages[i], data.name || 'product');
            if (file) {
                setImageInSlot(file, i);
                attachedCount++;
            }
        }

        if (modalError) {
            if (attachedCount > 0) {
                modalError.innerHTML = `<div style="color:#16a34a;padding:8px 12px;background:#f0fdf4;border-radius:8px;margin-bottom:8px;font-size:13px;">✓ ${attachedCount} image${attachedCount > 1 ? 's' : ''} attached from barcode lookup. Fill in remaining fields and save.</div>`;
            } else {
                modalError.innerHTML = '<div style="color:#d97706;padding:8px 12px;background:#fffbeb;border-radius:8px;margin-bottom:8px;font-size:13px;">⚠ Could not download product images. You can add images manually.</div>';
            }
            setTimeout(() => { if (modalError) modalError.innerHTML = ''; }, 6000);
        }
    }
}

// Expose to window for HTML onclick handlers
window.lookupBarcode = lookupBarcode;
window.openBarcodeLookupModal = openBarcodeLookupModal;
window.closeBarcodeLookupModal = closeBarcodeLookupModal;
window.scanBarcodeLookup = scanBarcodeLookup;
window.useScannedProduct = useScannedProduct;

function setIdToken(token) {
    if (token) window.localStorage.setItem('id_token', token);
}

function clearSession() {
    window.localStorage.removeItem('id_token');
}

function parseHashForToken() {
    if (window.location.hash && window.location.hash.includes('id_token')) {
        const params = new URLSearchParams(window.location.hash.substring(1));
        const idToken = params.get('id_token');
        if (idToken) {
            setIdToken(idToken);
            // Clean hash from URL
            history.replaceState(null, document.title, window.location.pathname + window.location.search);
        }
    }
}

function decodeJwtPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return {};
        const payload = parts[1]
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        const json = atob(payload);
        return JSON.parse(json);
    } catch { return {}; }
}

function getSignedInEmail() {
    const t = getIdToken();
    if (!t) return '';
    const p = decodeJwtPayload(t);
    return p.email || p['cognito:username'] || '';
}

function isLoggedIn() {
    return !!getIdToken();
}

function login() {
    const url = `${COGNITO_DOMAIN}/oauth2/authorize?client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}&response_type=token&scope=openid+email+profile&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    window.location.href = url;
}

function logout() {
    const logoutUrl = `${COGNITO_DOMAIN}/logout?client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}&logout_uri=${encodeURIComponent(REDIRECT_URI)}`;
    clearSession();
    window.location.href = logoutUrl;
}

// Global variables
let products = [];
let currentEditingId = null;
// Images selected in the modal (frontend-only for now)
let selectedImages = [null, null]; // { file, url, width, height }
let carouselIndex = 0;
// Existing images for currently edited product
let existingImageKeys = [null, null];
let deleteKeys = [];
// Search state
let searchTerm = '';
let filters = {
    'out-of-stock': true
};
// In-memory cache for signed GET URLs
const imageUrlCache = new Map(); // key -> { url, expiresAt }

// Initialize the application
document.addEventListener('DOMContentLoaded', function () {
    parseHashForToken();
    const email = getSignedInEmail();
    const signedMsg = document.getElementById('signed-in-msg');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    if (isLoggedIn()) {
        if (signedMsg) signedMsg.textContent = `signed user in to this admin at ${email}`;
        if (loginBtn) loginBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    } else {
        if (signedMsg) signedMsg.textContent = '';
        if (loginBtn) loginBtn.style.display = 'inline-flex';
        if (logoutBtn) logoutBtn.style.display = 'none';
    }
    loadProducts();
});

// =====================
// Tab switching
// =====================
function switchTab(name) {
    document.body.classList.toggle('ai-workspace-active', name === 'ai');
    const panelName = (name === 'audit') ? 'products' : name;
    document.querySelectorAll('.tab-panel').forEach(p => { p.style.display = 'none'; });
    const panel = document.getElementById('panel-' + panelName);
    if (panel) panel.style.display = '';
    const productsPanel = document.getElementById('panel-products');
    if (productsPanel) {
        if (name === 'audit') {
            productsPanel.classList.add('audit-mode');
        } else {
            productsPanel.classList.remove('audit-mode');
        }
    }
    document.querySelectorAll('.tab-item').forEach(btn => {
        btn.classList.remove('active');
        btn.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab-item[data-tab="' + name + '"]').forEach(btn => {
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
    });
    if (name === 'ai' && window.aiWorkspace) window.aiWorkspace.refresh();
    if (name === 'label-print') renderLabelPrintList('');
}

// =====================
// Internal barcode generation
// =====================
function generateInternalBarcode(digits) {
    const d = parseInt(digits) || 8;
    let result = '';
    for (let i = 0; i < d; i++) {
        result += Math.floor(Math.random() * 10).toString();
    }
    if (result[0] === '0') result = (Math.floor(Math.random() * 9) + 1).toString() + result.slice(1);
    return result;
}

function generateReceiveBarcode() {
    const digits = parseInt(document.getElementById('receive-barcode-digits')?.value) || 8;
    const code = generateInternalBarcode(digits);
    const input = document.getElementById('receive-internal-barcode');
    if (input) input.value = code;
}

function generateAndFillInternalBarcode() {
    const digits = parseInt(document.getElementById('product-barcode-digits')?.value) || 8;
    const code = generateInternalBarcode(digits);
    const input = document.getElementById('product-internal-barcode');
    if (input) input.value = code;
}

// =====================
// Receive Inventory flow
// =====================
async function lookupReceiveUpc() {
    const upcInput = document.getElementById('receive-upc-input');
    const barcode = (upcInput?.value || '').trim();
    const statusEl = document.getElementById('receive-lookup-status');
    if (!barcode) {
        statusEl.innerHTML = '<span style="color:red">Enter a UPC barcode first.</span>';
        return;
    }
    const btn = document.getElementById('receive-lookup-btn');
    statusEl.innerHTML = '<span style="color:#888">Looking up UPC...</span>';
    if (btn) btn.disabled = true;
    try {
        const result = await fetchBarcodeLookup(barcode);
        statusEl.innerHTML = '';
        document.getElementById('receive-preview-name').textContent = result.name || '';
        document.getElementById('receive-preview-brand').textContent = result.brand || '';
        const img = document.getElementById('receive-preview-img');
        if (img) {
            img.src = result.imageUrl || '';
            img.style.display = result.imageUrl ? '' : 'none';
        }
        document.getElementById('receive-name').value = result.name || '';
        document.getElementById('receive-description').value = result.description || result.brand || '';
        document.getElementById('receive-upc-value').value = barcode;
        const catMap = {
            'produce': 'Fruits & Veggies', 'fruit': 'Fruits & Veggies', 'vegetable': 'Fruits & Veggies',
            'beverage': 'Beverages', 'drink': 'Beverages',
            'bakery': 'Bakery', 'bread': 'Bakery',
            'seafood': 'Seafood', 'fish': 'Seafood',
            'frozen': 'Frozen Foods',
            'cereal': 'Cereals & Breakfast', 'breakfast': 'Cereals & Breakfast',
            'meat': 'Meat & Poultry', 'poultry': 'Meat & Poultry',
            'infant': 'Infant Care', 'baby': 'Infant Care',
            'snack': 'Snacks', 'food': 'Snacks'
        };
        const catEl = document.getElementById('receive-category');
        if (catEl && result.category) {
            const lc = (result.category || '').toLowerCase();
            let matched = 'option';
            for (const [k, v] of Object.entries(catMap)) {
                if (lc.includes(k)) { matched = v; break; }
            }
            catEl.value = matched;
        }
        generateReceiveBarcode();
        document.getElementById('receive-form-section').style.display = '';
    } catch (err) {
        statusEl.innerHTML = '<span style="color:red">Lookup failed: ' + (err.message || err) + '</span>';
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function saveReceivedItem() {
    const name = (document.getElementById('receive-name')?.value || '').trim();
    const internalBarcode = (document.getElementById('receive-internal-barcode')?.value || '').trim();
    const price = parseFloat(document.getElementById('receive-price')?.value);
    const statusEl = document.getElementById('receive-lookup-status');
    if (!name) { statusEl.innerHTML = '<span style="color:red">Name is required.</span>'; return; }
    if (!internalBarcode) { statusEl.innerHTML = '<span style="color:red">Generate an internal barcode first.</span>'; return; }
    if (isNaN(price) || price < 0) { statusEl.innerHTML = '<span style="color:red">Enter a valid price.</span>'; return; }
    statusEl.innerHTML = '<span style="color:#888">Saving...</span>';
    try {
        await dbService.putProduct({
            name,
            description: (document.getElementById('receive-description')?.value || '').trim(),
            category: document.getElementById('receive-category')?.value || 'option',
            price,
            priceUnit: document.getElementById('receive-price-unit')?.value || 'piece',
            upc: (document.getElementById('receive-upc-value')?.value || '').trim(),
            internalBarcode,
            quantity: parseFloat(document.getElementById('receive-quantity')?.value) || 0,
            lowStockThreshold: parseFloat(document.getElementById('receive-low-stock-threshold')?.value) || 5,
            availability: document.getElementById('receive-availability')?.value || 'In Stock',
            areaLocation: document.getElementById('receive-area')?.value || 'A1',
            scaleNeed: document.getElementById('receive-scale-need')?.checked === true,
            imageKeys: []
        });
        statusEl.innerHTML = '<span style="color:#52c41a">✓ Item added to inventory!</span>';
        loadProducts();
        setTimeout(() => { clearReceiveForm(); }, 2500);
    } catch (err) {
        statusEl.innerHTML = '<span style="color:red">Save failed: ' + (err.message || err) + '</span>';
    }
}

function clearReceiveForm() {
    const upcInput = document.getElementById('receive-upc-input');
    if (upcInput) upcInput.value = '';
    document.getElementById('receive-form-section').style.display = 'none';
    document.getElementById('receive-lookup-status').innerHTML = '';
    const form = document.getElementById('receive-form');
    if (form) form.reset();
}

// Backend service (uses deployed API)
class DynamoDBService {
    constructor() {
        // no-op
    }

    initializeData() {
        // no seed data; backend holds truth
    }

    async scanProducts(lastKey) {
        const headers = {};
        const token = getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const url = new URL(`${API_BASE_URL}/products`);
        if (lastKey) url.searchParams.set('lastKey', lastKey);
        const resp = await fetch(url.toString(), {
            method: 'GET',
            headers
        });
        if (!resp.ok) {
            const t = await resp.text();
            if (resp.status === 401) {
                throw new Error('Unauthorized. Please login to access products.');
            }
            throw new Error(`List failed (${resp.status}): ${t}`);
        }
        return resp.json(); // expected shape: { items: [...], nextToken? }
    }

    async putProduct(product) {
        const hasId = !!product.id;
        const url = hasId ? `${API_BASE_URL}/products/${encodeURIComponent(product.id)}` : `${API_BASE_URL}/products`;
        const method = hasId ? 'PUT' : 'POST';
        const body = JSON.stringify({
            name: product.name,
            description: product.description,
            category: product.category,
            price: Number(product.price),
            priceUnit: product.priceUnit || 'piece',
            upc: product.upc || product.barcode || '',
            internalBarcode: product.internalBarcode || product.barcode || '',
            quantity: typeof product.quantity === 'number' ? product.quantity : (parseFloat(product.quantity) || 0),
            lowStockThreshold: typeof product.lowStockThreshold === 'number' ? product.lowStockThreshold : (Number.isFinite(parseFloat(product.lowStockThreshold)) ? parseFloat(product.lowStockThreshold) : 5),
            availability: product.availability,
            areaLocation: product.areaLocation || 'A1',
            scaleNeed: product.scaleNeed === true,
            imageKeys: Array.isArray(product.imageKeys) ? product.imageKeys : [],
            deleteKeys: Array.isArray(product.deleteKeys) ? product.deleteKeys : undefined,
            ingredients: product.ingredients,
            expectedUpdatedAt: product.updatedAt,
            allergySummary: product.allergySummary
        });
        const headers = { 'Content-Type': 'application/json' };
        const token = getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const resp = await fetch(url, {
            method,
            headers,
            body
        });
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`Save failed (${resp.status}): ${t}`);
        }
        return resp.json();
    }

    async getUploadUrl({ fileName, contentType, productId }) {
        const headers = { 'Content-Type': 'application/json' };
        const token = getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const resp = await fetch(`${API_BASE_URL}/upload-url`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ fileName, contentType, productId })
        });
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`Upload URL failed (${resp.status}): ${t}`);
        }
        return resp.json();
    }

    async getImageUrl(key) {
        const cached = imageUrlCache.get(key);
        if (cached && cached.expiresAt > Date.now()) return { url: cached.url };
        imageUrlCache.delete(key);
        // The backend signs URLs for 60 seconds. Allow time for the request
        // and image download instead of reusing expired URLs indefinitely.
        const requestedAt = Date.now();
        const headers = { 'Content-Type': 'application/json' };
        const token = getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const resp = await fetch(`${API_BASE_URL}/image-url`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ key })
        });
        if (!resp.ok) {
            const t = await resp.text();
            if (resp.status === 401) {
                throw new Error('Unauthorized while fetching image URL. Please login again.');
            }
            throw new Error(`Image URL failed (${resp.status}): ${t}`);
        }
        const json = await resp.json();
        if (json && json.url) imageUrlCache.set(key, { url: json.url, expiresAt: requestedAt + 45000 });
        return json;
    }

    async deleteProduct(id) {
        const headers = {};
        const token = getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const resp = await fetch(`${API_BASE_URL}/products/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
        if (!resp.ok && resp.status !== 204) {
            const t = await resp.text();
            throw new Error(`Delete failed (${resp.status}): ${t}`);
        }
        return true;
    }
}

const dbService = new DynamoDBService();

// Track used image URLs in current auto-assign session to avoid repeats
let assignedImageUrlsSession = new Set();

// Load products from backend API
async function loadProducts() {
    try {
        showLoading(true);
        const all = [];
        let safety = 0;
        let lastKey = undefined;
        do {
            const result = await dbService.scanProducts(lastKey);
            const items = result.items || result.Items || [];
            all.push(...items);
            lastKey = result.lastKey;
            safety++;
        } while (lastKey && safety < 100);
        products = all;
        renderProducts();
        if (window.aiWorkspace) window.aiWorkspace.refresh();
    } catch (error) {
        showError('Failed to load products: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// Returns a colored stock-level badge for the Qty table cell
function renderStockLevel(product) {
    const qty = product.quantity;
    const threshold = product.lowStockThreshold !== undefined ? product.lowStockThreshold : 5;
    const unit = product.priceUnit || 'pcs';
    const isWeight = ['lb', 'oz', 'g', 'kg'].includes(unit);
    const display = qty === undefined ? '—' : (isWeight ? `${qty} ${unit}` : `${qty} ${unit === 'piece' ? 'pcs' : unit}`);

    if (qty === undefined) return `<span class="stock-badge stock-unknown">—</span>`;
    if (qty <= 0) return `<span class="stock-badge stock-out">Out ${display}</span>`;
    if (qty <= threshold) return `<span class="stock-badge stock-low">Low ${display}</span>`;
    return `<span class="stock-badge stock-ok">${display}</span>`;
}

// Fallbacks must match the saved image key exactly. Never show a shared
// category photo as though it were the actual product.
const VERIFIED_PRODUCT_IMAGES = Object.freeze({
    "products/MUP0KGVN6PYEKSHFWQU16W/transparent-20261026-carrots-loose.png": "assets/product-images/carrots-loose.png",
    "products/MUP0KE5B_RI5PRLFJTKMEG/transparent-20261025-ground-beef.png": "assets/product-images/ground-beef.png",
    "products/MUP0KERJVGNQU_S2O3LA-W/transparent-20261025-orange-juice.png": "assets/product-images/orange-juice.png",
    "products/MUP0KIAULGBI_NTXB9OGIW/transparent-20261025-granola-bars.png": "assets/product-images/granola-bars.png",
    "products/MUP0KEHJ8HDWAYFTNVY37W/transparent-20261025-apples.png": "assets/product-images/apples.png",
    "products/MODSQNQ45YVRQZGXH1G2SQ/transparent-20261025-arizona.png": "assets/product-images/arizona.png",
    "products/MUP0KDIJI6AIUNXVXYH3SW/transparent-20261025-eggs.png": "assets/product-images/eggs.png",
    "products/MUVS3T8UTVTS_VU97UW5ZQ/transparent-20261025-hershey.png": "assets/product-images/hershey.png",
    "products/MUP0KF4VI19J2SSYCNQRBQ/transparent-20261025-cheddar-cheese.png": "assets/product-images/cheddar-cheese.png",
    "products/MUP0KGVN6PYEKSHFWQU16W/transparent-20261025-carrots.png": "assets/product-images/carrots.png",
    "products/MUP0KGHR9_H5QE_6GAT0QG/transparent-20261025-onions.png": "assets/product-images/onions.png",
    "products/MUP0KFN7QLEWXWK8CAUITQ/transparent-20261025-pasta.png": "assets/product-images/pasta.png",
    "products/MUP0KH3F7R8CARVGWAWFXG/transparent-20261025-peanut-butter.png": "assets/product-images/peanut-butter.png",
    "products/MUP0KD8JIWV3WVFIQRT9VW/transparent-20261025-bread.png": "assets/product-images/bread.png",
    "products/MUP0KJYRSMFCEJVQPO7UTQ/transparent-20261025-soda.png": "assets/product-images/soda.png",
    "products/MUP0KFDRRVOBGNMWN5GXHQ/transparent-20261025-rice.png": "assets/product-images/rice.png",
    "products/MUP0KFW3NVABKEDIK6JAHA/transparent-20261025-tomato-sauce.png": "assets/product-images/tomato-sauce.png",
    "products/MUP0KHBRXTQB2UYZLPTAIW/transparent-20261025-jelly.png": "assets/product-images/jelly.png",
    "products/MUP0KI1VCTCVOTU1CCHEFW/transparent-20261025-yogurt.png": "assets/product-images/yogurt.png",
    "products/MUP0KJSN-IQGIQPO1HEJ9G/transparent-20261025-canola-oil.png": "assets/product-images/canola-oil.png",
    "products/MUP0KIKR8MG9XBARHMWUSW/transparent-20261025-coffee.png": "assets/product-images/coffee.png",
    "products/MUP0KITN4THKABFNG7I18W/transparent-20261025-tea.png": "assets/product-images/tea.png",
    "products/MUP0KJBGHMCFQT6O-JKTYQ/transparent-20261025-flour.png": "assets/product-images/flour.png",
    "products/MM1JS4NQ9PFVFKSI5MOPEG/transparent-20261025-pink-lady-apple.png": "assets/product-images/pink-lady-apple.png",
    "products/MUP0KGNV-RGFJC0AD2FXKQ/transparent-20261025-lettuce.png": "assets/product-images/lettuce.png",
    "products/MUP0KCZ3UJG5AXHUWU5GYG/transparent-20261025-bananas.png": "assets/product-images/bananas.png",
    "products/MUP0KJKVHXWGA1211I7INQ/transparent-20261025-olive-oil.png": "assets/product-images/olive-oil.png",
    "products/MUP0KG6NPXGXGO45JVA9CG/transparent-20261025-potatoes.png": "assets/product-images/potatoes.png",
    "products/MUP0KCMXEMUAOER9D_UUWW/transparent-20261025-milk.png": "assets/product-images/milk.png",
    "products/MUP0KJ3NSHTLVANXZ6SGXQ/transparent-20261025-sugar.png": "assets/product-images/sugar.png",
    "products/MUP0KK6JUSH-G2-JCNCO9G/transparent-20261025-water.png": "assets/product-images/water.png",
    "products/MUP0KDU8NIF-OOIYNQFKCW/transparent-20261025-chicken-breast.png": "assets/product-images/chicken-breast.png"
});
const NO_PRODUCT_IMAGE = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="760" height="600" viewBox="0 0 760 600"><text x="380" y="310" text-anchor="middle" font-family="sans-serif" font-size="36" fill="#64748b">No image</text></svg>'
);

function getProductFallbackImage(product) {
    const keys = product.imageKeys || product.image_keys || [];
    return (Array.isArray(keys) && VERIFIED_PRODUCT_IMAGES[keys[0]]) || NO_PRODUCT_IMAGE;
}

function escapeProductText(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// Render products in the table
function renderProducts() {
    const tbody = document.getElementById('products-tbody');
    const filteredProducts = applyFilters(products);

    tbody.innerHTML = '';
    // Update product count badge
    const countEl = document.getElementById('product-count');
    if (countEl) countEl.textContent = `(${filteredProducts.length})`;

    filteredProducts.forEach(product => {
        const row = document.createElement('tr');
        const thumbCellId = `thumb-${product.id}`;
        const fallbackImage = getProductFallbackImage(product);
        const unit = (product.priceUnit || 'piece');
        const unitLabelMap = { piece: 'piece', lb: 'lb', oz: 'oz', g: 'g', kg: 'kg', gallon: 'gallon', dozen: 'dozen', loaf: 'loaf', bag: 'bag', bags: 'bags', carton: 'carton', block: 'block', jar: 'jar', cup: 'cup', box: 'box', pack: 'pack', can: 'can', bottle: 'bottle' };
        const unitLabel = unitLabelMap[unit] || unit;
        row.innerHTML = `
                    <td>
                        <div class="product-image" id="${thumbCellId}">
                            <img src="${fallbackImage}" alt="${escapeProductText(product.name || 'Product')}" loading="lazy">
                        </div>
                    </td>
                    <td><span class="product-name">${escapeProductText(product.name)}</span></td>
                    <td>${escapeProductText(product.description)}</td>
                    <td><span class="status-badge ${product.availability === 'In Stock' ? 'status-in-stock' : 'status-out-of-stock'}">${escapeProductText(product.availability)}</span></td>
                    <td style="font-family:monospace">${escapeProductText(product.internalBarcode || product.barcode || '—')}</td>
                    <td style="color:#888;font-size:12px">${escapeProductText(product.upc || '—')}</td>
                    <td>${escapeProductText(product.category)}</td>
                    <td>${renderStockLevel(product)}</td>
                    <td>${escapeProductText(product.areaLocation || 'A1')}</td>
                    <td><span class="price">$${product.price.toFixed(2)} / ${escapeProductText(unitLabel)}</span></td>
                    <td>
                        <button class="action-btn" onclick="editProduct('${product.id}')">Edit</button>
                        <button class="action-btn delete-btn" onclick="deleteProduct('${product.id}')">Delete</button>
                    </td>
                `;
        const allergyCell = document.createElement('td');
        allergyCell.className = 'product-allergy-cell';
        const summary = product.allergySummary && product.allergySummary.toLowerCase() !== 'none' ? product.allergySummary : '';
        const labels = { not_required: '—', complete: 'No notice generated', needs_label: 'Automatic source lookup pending', retry: 'Retry scheduled', unavailable: 'No reliable source found', manual: 'Manually reviewed' };
        allergyCell.textContent = summary || labels[product.allergyStatus] || 'Automatic check after 24h';
        if (!summary && product.allergyAttempts >= 3 && ['needs_label', 'retry'].includes(product.allergyStatus)) allergyCell.textContent = 'No reliable source found';
        if (product.allergySource === 'open_food_facts') {
            const source = document.createElement('a');
            source.textContent = 'Open Food Facts';
            const code = String(product.upc || '');
            if (/^\d{8,14}$/.test(code)) source.href = 'https://world.openfoodfacts.org/product/' + code;
            source.target = '_blank'; source.rel = 'noopener noreferrer';
            allergyCell.append(document.createElement('br'), source);
        }
        row.insertBefore(allergyCell, row.lastElementChild);
        tbody.appendChild(row);

        // Render thumbnail if available
        const keys = product.imageKeys || product.image_keys || [];
        const cell = document.getElementById(thumbCellId);
        if (Array.isArray(keys) && keys.length > 0) {
            const firstKey = keys[0];
            const isDirectUrl = typeof firstKey === 'string' && /^https?:\/\//i.test(firstKey);
            const setImg = (src) => {
                const c = document.getElementById(thumbCellId);
                if (!c) return;
                if (!src) {
                    c.innerHTML = `<img id="${thumbCellId}-img" src="${fallbackImage}" alt="${escapeProductText(product.name || 'Product')}" loading="lazy">`;
                    return;
                }
                c.innerHTML = `<img id="${thumbCellId}-img" src="${src}" alt="${escapeProductText(product.name || 'Product')}" loading="lazy" onerror="window.refreshThumb && window.refreshThumb('${firstKey}','${thumbCellId}')"/>`;
            };
            if (isDirectUrl) {
                setImg(firstKey);
            } else {
                dbService.getImageUrl(firstKey).then(({ url }) => {
                    setImg(url);
                }).catch((e) => {
                    console.warn('getImageUrl failed for key', firstKey, e);
                    setImg(null);
                });
            }
        } else {
            // Keep the catalog polished even when no uploaded image exists.
            if (cell) cell.innerHTML = `<img id="${thumbCellId}-img" src="${fallbackImage}" alt="${escapeProductText(product.name || 'Product')}" loading="lazy">`;
        }
    });
}

// Attempt to refresh a thumbnail when a signed URL has expired (403). Will try once.
window.refreshThumb = async function (key, cellId) {
    try {
        const cell = document.getElementById(cellId);
        const img = document.getElementById(cellId + '-img');
        if (!cell) return;
        // Prevent infinite loops: if we've already retried, bail out
        if (img && img.dataset && img.dataset.retried === '1') {
            const product = products.find(item => `thumb-${item.id}` === cellId);
            cell.innerHTML = `<img src="${getProductFallbackImage(product || {})}" alt="Product" loading="lazy">`;
            return;
        }
        // Fetch a fresh signed URL (bypass cache by temporarily clearing)
        try { imageUrlCache.delete && imageUrlCache.delete(key); } catch (_) { }
        const { url } = await dbService.getImageUrl(key);
        if (!url) {
            cell.innerHTML = `<img src="${getProductFallbackImage(products.find(item => `thumb-${item.id}` === cellId) || {})}" alt="Product" loading="lazy">`;
            return;
        }
        // S3 signs the complete query string; adding a cache buster invalidates it.
        const finalUrl = url;
        if (img) {
            img.dataset.retried = '1';
            img.src = finalUrl;
            img.onerror = function () {
                this.onerror = null;
                const product = products.find(item => `thumb-${item.id}` === cellId);
                this.src = getProductFallbackImage(product || {});
            };
        } else {
            cell.innerHTML = `<img id="${cellId}-img" src="${finalUrl}" alt="Product" loading="lazy"/>`;
        }
    } catch (e) {
        const cell = document.getElementById(cellId);
        if (cell) {
            const product = products.find(item => `thumb-${item.id}` === cellId);
            cell.innerHTML = `<img src="${getProductFallbackImage(product || {})}" alt="Product" loading="lazy">`;
        }
    }
}

// Apply filters to products
function applyFilters(products) {
    const term = (searchTerm || '').trim().toLowerCase();
    return products.filter(product => {
        // Text search filter (name or barcode)
        if (term) {
            const name = (product.name || '').toLowerCase();
            const barcode = ((product.internalBarcode || product.barcode || '') + ' ' + (product.upc || '')).toLowerCase();
            if (!name.includes(term) && !barcode.includes(term)) return false;
        }
        return true;
    });
}

// Toggle filter
function toggleFilter(filterType) {
    const checkbox = document.getElementById(filterType + '-checkbox');
    filters[filterType] = !filters[filterType];

    if (filters[filterType]) {
        checkbox.classList.add('active');
    } else {
        checkbox.classList.remove('active');
    }

    renderProducts();
}

// Show/hide loading
function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
    document.getElementById('products-table').style.display = show ? 'none' : 'table';
}

// Show error message
function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.innerHTML = `<div class="error">${message}</div>`;
    setTimeout(() => {
        errorDiv.innerHTML = '';
    }, 5000);
}

// Show success message
function showSuccess(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.innerHTML = `<div class="success">${message}</div>`;
    setTimeout(() => {
        errorDiv.innerHTML = '';
    }, 3000);
}

// =====================
// Search controls
// =====================
function onSearchInput(e) {
    searchTerm = e.target.value || '';
    renderProducts();
}

function clearSearch() {
    searchTerm = '';
    const input = document.getElementById('product-search');
    if (input) input.value = '';
    renderProducts();
}

// Open add product modal
function openAddProductModal() {
    currentEditingId = null;
    document.getElementById('modal-title').textContent = 'Add Product';
    document.getElementById('product-form').reset();
    document.getElementById('product-modal').style.display = 'block';
    const unitEl = document.getElementById('product-price-unit');
    if (unitEl) unitEl.value = 'piece';
    const areaEl = document.getElementById('product-area');
    if (areaEl) areaEl.value = 'A1';
    const scaleEl = document.getElementById('product-scale-need');
    if (scaleEl) scaleEl.checked = false;
    // reset images
    resetImages();
    existingImageKeys = [null, null];
    deleteKeys = [];
    clearSuggestedImages();
    attachSuggestionAutoRefresh();
    const allergyEl = document.getElementById('product-allergy-summary');
    if (allergyEl) allergyEl.value = '';
    const ingredientsEl = document.getElementById('product-ingredients');
    if (ingredientsEl) ingredientsEl.value = '';
}

// Edit product
function editProduct(id) {
    const product = products.find(p => p.id === id);
    if (product) {
        currentEditingId = id;
        document.getElementById('modal-title').textContent = 'Edit Product';
        document.getElementById('product-name').value = product.name;
        document.getElementById('product-description').value = product.description;
        document.getElementById('product-category').value = product.category;
        document.getElementById('product-price').value = product.price;
        const unitEl = document.getElementById('product-price-unit');
        if (unitEl) unitEl.value = product.priceUnit || 'piece';
        const upcEl = document.getElementById('product-upc');
        if (upcEl) upcEl.value = product.upc || product.barcode || '';
        const intBarcodeEl = document.getElementById('product-internal-barcode');
        if (intBarcodeEl) intBarcodeEl.value = product.internalBarcode || product.barcode || '';
        document.getElementById('product-availability').value = product.availability;
        const qtyEl = document.getElementById('product-quantity');
        if (qtyEl) qtyEl.value = product.quantity !== undefined ? product.quantity : 0;
        const lstEl = document.getElementById('product-low-stock-threshold');
        if (lstEl) lstEl.value = product.lowStockThreshold !== undefined ? product.lowStockThreshold : 5;
        const qtyHintEl = document.getElementById('product-qty-unit-hint');
        if (qtyHintEl) qtyHintEl.textContent = product.priceUnit ? `(${product.priceUnit})` : '';
        const areaEl = document.getElementById('product-area');
        if (areaEl) areaEl.value = product.areaLocation || 'A1';
        const scaleEl = document.getElementById('product-scale-need');
        if (scaleEl) scaleEl.checked = product.scaleNeed === true;
        const allergyEl = document.getElementById('product-allergy-summary');
        if (allergyEl) allergyEl.value = product.allergySummary || '';
        const ingredientsEl = document.getElementById('product-ingredients');
        if (ingredientsEl) ingredientsEl.value = product.ingredients || '';
        document.getElementById('product-modal').style.display = 'block';
        resetImages();
        clearSuggestedImages();
        attachSuggestionAutoRefresh();
        // Load persisted images (up to 2) as existing
        const keys = Array.isArray(product.imageKeys) ? product.imageKeys : (product.image_keys || []);
        existingImageKeys = [keys[0] || null, keys[1] || null];
        deleteKeys = [];
        keys.forEach((k, idx) => {
            if (!k) return;
            dbService.getImageUrl(k).then(({ url }) => {
                if (!url) return;
                selectedImages[idx] = { file: null, url, width: 0, height: 0, key: k, existing: true };
                updateCarouselUI();
            }).catch(() => {/* ignore */ });
        });
        // Auto-trigger suggestions from the product name
        setTimeout(() => {
            const hasName = (document.getElementById('product-name')?.value || '').trim().length > 0;
            if (hasName) suggestImagesForCurrentProduct();
        }, 50);
    }
}

// Save product (uploads images first to S3, then persists product with imageKeys)
async function saveProduct() {
    try {
        const formData = {
            name: document.getElementById('product-name').value,
            description: document.getElementById('product-description').value,
            category: document.getElementById('product-category').value,
            price: parseFloat(document.getElementById('product-price').value),
            priceUnit: (document.getElementById('product-price-unit') && document.getElementById('product-price-unit').value) || 'piece',
            upc: (document.getElementById('product-upc')?.value || '').trim(),
            internalBarcode: (document.getElementById('product-internal-barcode')?.value || '').trim(),
            quantity: parseFloat(document.getElementById('product-quantity')?.value) || 0,
            lowStockThreshold: Number.isFinite(parseFloat(document.getElementById('product-low-stock-threshold')?.value)) ? parseFloat(document.getElementById('product-low-stock-threshold').value) : 5,
            availability: document.getElementById('product-availability').value,
            areaLocation: (document.getElementById('product-area') && document.getElementById('product-area').value) || 'A1',
            scaleNeed: (document.getElementById('product-scale-need') && document.getElementById('product-scale-need').checked) === true,
            ingredients: document.getElementById('product-ingredients')?.value,
            allergySummary: document.getElementById('product-allergy-summary') ? document.getElementById('product-allergy-summary').value : ''
        };

        if (currentEditingId) {
            formData.id = currentEditingId;
            formData.updatedAt = products.find(p => p.id === currentEditingId)?.updatedAt;
        }

        // Upload new images to S3 per slot and track uploadedKey on selectedImages entries
        for (let i = 0; i < selectedImages.length; i++) {
            const sel = selectedImages[i];
            if (!sel || !sel.file) continue; // only new files get uploaded
            const file = sel.file;
            const contentType = file.type || 'application/octet-stream';
            const { uploadUrl, key } = await dbService.getUploadUrl({
                fileName: file.name,
                contentType,
                productId: currentEditingId || undefined
            });
            const putResp = await fetch(uploadUrl, {
                method: 'PUT',
                headers: { 'Content-Type': contentType },
                body: file
            });
            if (!putResp.ok) {
                const t = await putResp.text();
                throw new Error(`Image upload failed (${putResp.status}): ${t}`);
            }
            selectedImages[i].uploadedKey = key;
        }

        // Build final imageKeys list in slot order (0..1), using existing keys for kept images and uploadedKey for new ones
        const finalKeys = [];
        for (let i = 0; i < selectedImages.length; i++) {
            const sel = selectedImages[i];
            if (!sel) continue;
            if (sel.existing && sel.key) finalKeys.push(sel.key);
            else if (sel.uploadedKey) finalKeys.push(sel.uploadedKey);
        }

        // Always send imageKeys (even if empty) so backend can clear images if needed
        formData.imageKeys = finalKeys;
        if (currentEditingId && deleteKeys.length > 0) formData.deleteKeys = deleteKeys;

        await dbService.putProduct(formData);
        // Clear cached signed URLs for deleted keys to prevent stale thumbnails
        if (Array.isArray(deleteKeys)) {
            for (const k of deleteKeys) {
                try { imageUrlCache.delete(k); } catch (_) { }
            }
        }
        closeModal();
        showSuccess(currentEditingId ? 'Product updated successfully!' : 'Product added successfully!');
        loadProducts();
    } catch (error) {
        const modalError = document.getElementById('modal-error');
        modalError.innerHTML = `<div class="error">Failed to save product: ${error.message}</div>`;
    }
}

// Delete product
async function deleteProduct(id) {
    if (confirm('Are you sure you want to delete this product?')) {
        try {
            await dbService.deleteProduct(id);
            showSuccess('Product deleted successfully!');
            loadProducts();
        } catch (error) {
            showError('Failed to delete product: ' + error.message);
        }
    }
}

// Close modal
function closeModal() {
    document.getElementById('product-modal').style.display = 'none';
    document.getElementById('modal-error').innerHTML = '';
}

// Publish changes (placeholder function)
function publishChanges() {
    showSuccess('Changes published successfully!');
}

// Close modal when clicking outside
window.onclick = function (event) {
    const modal = document.getElementById('product-modal');
    if (event.target === modal) {
        closeModal();
    }
}

// =====================
// Image picker controls
// =====================

function resetImages() {
    // Revoke any existing URLs
    selectedImages.forEach(img => { if (img && img.url) URL.revokeObjectURL(img.url); });
    selectedImages = [null, null];
    carouselIndex = 0;
    updateCarouselUI();
}

function onSelectImage(e, idx) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        // Validate minimum resolution 760x600
        if (w < 760 || h < 600) {
            URL.revokeObjectURL(url);
            e.target.value = '';
            const modalError = document.getElementById('modal-error');
            modalError.innerHTML = `<div class="error">Image is too small (${w}×${h}). Minimum is 760×600.</div>`;
            return;
        }
        // Accept any image format per user instruction
        selectedImages[idx] = { file, url, width: w, height: h };
        // Set carousel to first available image (main = first slot if present)
        const firstIdx = selectedImages.findIndex(x => !!x);
        carouselIndex = firstIdx >= 0 ? firstIdx : 0;
        updateCarouselUI();
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        e.target.value = '';
        const modalError = document.getElementById('modal-error');
        modalError.innerHTML = `<div class="error">Unsupported image file.</div>`;
    };
    img.src = url;
}

function removeImage(idx) {
    const input = document.getElementById(`file-${idx}`);
    if (selectedImages[idx] && selectedImages[idx].url) {
        URL.revokeObjectURL(selectedImages[idx].url);
    }
    // If removing an existing persisted image, track it for backend deletion
    const toRemove = selectedImages[idx];
    if (toRemove && toRemove.existing && toRemove.key) {
        deleteKeys = deleteKeys || [];
        if (!deleteKeys.includes(toRemove.key)) deleteKeys.push(toRemove.key);
    }
    selectedImages[idx] = null;
    if (input) input.value = '';

    // Move carousel to next available image
    const available = getAvailableIndices();
    carouselIndex = available.length ? available[0] : 0;
    updateCarouselUI();
}

function getAvailableIndices() {
    const indices = [];
    if (selectedImages[0]) indices.push(0);
    if (selectedImages[1]) indices.push(1);
    return indices;
}

function carouselPrev() {
    const indices = getAvailableIndices();
    if (indices.length <= 1) return;
    const pos = indices.indexOf(carouselIndex);
    const nextPos = (pos - 1 + indices.length) % indices.length;
    carouselIndex = indices[nextPos];
    updateCarouselUI();
}



// Delete product
async function deleteProduct(id) {
    if (confirm('Are you sure you want to delete this product?')) {
        try {
            await dbService.deleteProduct(id);
            showSuccess('Product deleted successfully!');
            loadProducts();
        } catch (error) {
            showError('Failed to delete product: ' + error.message);
        }
    }
}

// Close modal
function closeModal() {
    document.getElementById('product-modal').style.display = 'none';
    document.getElementById('modal-error').innerHTML = '';
}

// Publish changes (placeholder function)
function publishChanges() {
    showSuccess('Changes published successfully!');
}

// Close modal when clicking outside
window.onclick = function (event) {
    const modal = document.getElementById('product-modal');
    if (event.target === modal) {
        closeModal();
    }
}

// =====================
// Image picker controls
// =====================

function resetImages() {
    // Revoke any existing URLs
    selectedImages.forEach(img => { if (img && img.url) URL.revokeObjectURL(img.url); });
    selectedImages = [null, null];
    carouselIndex = 0;
    updateCarouselUI();
}

function onSelectImage(e, idx) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        // Validate minimum resolution 760x600
        if (w < 760 || h < 600) {
            URL.revokeObjectURL(url);
            e.target.value = '';
            const modalError = document.getElementById('modal-error');
            modalError.innerHTML = `<div class="error">Image is too small (${w}×${h}). Minimum is 760×600.</div>`;
            return;
        }
        // Accept any image format per user instruction
        selectedImages[idx] = { file, url, width: w, height: h };
        // Set carousel to first available image (main = first slot if present)
        const firstIdx = selectedImages.findIndex(x => !!x);
        carouselIndex = firstIdx >= 0 ? firstIdx : 0;
        updateCarouselUI();
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        e.target.value = '';
        const modalError = document.getElementById('modal-error');
        modalError.innerHTML = `<div class="error">Unsupported image file.</div>`;
    };
    img.src = url;
}

function removeImage(idx) {
    const input = document.getElementById(`file-${idx}`);
    if (selectedImages[idx] && selectedImages[idx].url) {
        URL.revokeObjectURL(selectedImages[idx].url);
    }
    // If removing an existing persisted image, track it for backend deletion
    const toRemove = selectedImages[idx];
    if (toRemove && toRemove.existing && toRemove.key) {
        deleteKeys = deleteKeys || [];
        if (!deleteKeys.includes(toRemove.key)) deleteKeys.push(toRemove.key);
    }
    selectedImages[idx] = null;
    if (input) input.value = '';

    // Move carousel to next available image
    const available = getAvailableIndices();
    carouselIndex = available.length ? available[0] : 0;
    updateCarouselUI();
}

function getAvailableIndices() {
    const indices = [];
    if (selectedImages[0]) indices.push(0);
    if (selectedImages[1]) indices.push(1);
    return indices;
}

function carouselPrev() {
    const indices = getAvailableIndices();
    if (indices.length <= 1) return;
    const pos = indices.indexOf(carouselIndex);
    const nextPos = (pos - 1 + indices.length) % indices.length;
    carouselIndex = indices[nextPos];
    updateCarouselUI();
}

function carouselNext() {
    const indices = getAvailableIndices();
    if (indices.length <= 1) return;
    const pos = indices.indexOf(carouselIndex);
    const nextPos = (pos + 1) % indices.length;
    carouselIndex = indices[nextPos];
    updateCarouselUI();
}

function updateCarouselUI() {
    const imgEl = document.getElementById('carousel-image');
    const emptyEl = document.getElementById('carousel-empty');
    const dotsEl = document.getElementById('image-dots');
    if (!imgEl || !emptyEl || !dotsEl) return; // modal might not be in DOM yet

    const current = selectedImages[carouselIndex];
    const any = selectedImages.some(Boolean);
    if (any && current) {
        imgEl.src = current.url;
        imgEl.style.display = 'block';
        emptyEl.style.display = 'none';
    } else {
        imgEl.src = '';
        imgEl.style.display = 'none';
        emptyEl.style.display = 'flex';
    }

    // Dots
    const dots = [];
    for (let i = 0; i < 2; i++) {
        const has = !!selectedImages[i];
        const active = i === carouselIndex && has;
        dots.push(`<button type="button" class="dot ${has ? 'has' : ''} ${active ? 'active' : ''}" onclick="setCarousel(${i})" aria-label="Image ${i + 1}"></button>`);
    }
    dotsEl.innerHTML = dots.join('');
}

function setCarousel(i) {
    if (!selectedImages[i]) return;
    carouselIndex = i;
    updateCarouselUI();
}

// =====================
// CSV Import helpers
// =====================
function triggerCsvPick() {
    const input = document.getElementById('csv-input');
    if (input) input.click();
}

async function onCsvSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
        showLoading(true);
        const text = await file.text();
        const { headers, rows } = parseCsv(text);
        const headerInfo = buildHeaderMap(headers);
        if (!headerInfo.ok) {
            showError('CSV header mismatch. Required columns: name, description, category, price, barcode, availability, priceUnit');
            return;
        }
        const { toImport, errors } = validateCsvRows(rows, headerInfo);
        // Build sets to avoid duplicates: existing names and names within the file
        let existingNameSet = new Set();
        try {
            const list = await dbService.scanProducts();
            const items = list.items || list.Items || [];
            existingNameSet = new Set(items.map(p => normalizeName(p.name || '')));
        } catch (_) { /* ignore listing error; proceed with file-only dedupe */ }
        const seenInFile = new Set();

        const filtered = [];
        const dupErrors = [];
        for (const obj of toImport) {
            const key = normalizeName(obj.name || '');
            if (!key) {
                dupErrors.push({ row: obj.__row || '?', message: 'name is required' });
                continue;
            }
            if (existingNameSet.has(key)) {
                dupErrors.push({ row: obj.__row || '?', message: 'duplicate name (already exists): ' + obj.name });
                continue;
            }
            if (seenInFile.has(key)) {
                dupErrors.push({ row: obj.__row || '?', message: 'duplicate name in CSV: ' + obj.name });
                continue;
            }
            seenInFile.add(key);
            filtered.push(obj);
        }
        if (errors.length) {
            const sample = errors.slice(0, 5).map(er => `Row ${er.row}: ${er.message}`).join('<br>');
            showError(`Some rows invalid. Importing valid rows. Errors:<br>${sample}${errors.length > 5 ? '\n...' : ''}`);
        }
        if (dupErrors.length) {
            const sample = dupErrors.slice(0, 5).map(er => `Row ${er.row}: ${er.message}`).join('<br>');
            showError(`Duplicates skipped:<br>${sample}${dupErrors.length > 5 ? '\n...' : ''}`);
        }
        let success = 0; let fail = 0;
        for (let i = 0; i < filtered.length; i++) {
            const p = filtered[i];
            try {
                await dbService.putProduct({
                    name: p.name,
                    description: p.description,
                    availability: p.availability,
                    barcode: p.barcode,
                    category: p.category,
                    price: Number(p.price),
                    priceUnit: p.priceUnit || 'piece',
                    areaLocation: 'A1',
                    imageKeys: []
                });
                success++;
            } catch (err) {
                fail++;
            }
        }
        const invalidCount = errors.length;
        const dupCount = dupErrors.length;
        showSuccess(`Import complete. Added: ${success}. Skipped - invalid: ${invalidCount}, duplicates: ${dupCount}, failed on save: ${fail}.`);
        if (success > 0) await loadProducts();
    } catch (err) {
        showError('CSV import failed: ' + err.message);
    } finally {
        showLoading(false);
        e.target.value = '';
    }
}

function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if ((a[i] || '').trim() !== (b[i] || '').trim()) return false;
    return true;
}

function parseCsv(text) {
    if (!text) return { headers: [], rows: [] };
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };
    const headers = parseCsvLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        if (cols.length === 1 && cols[0] === '') continue;
        rows.push(cols);
    }
    return { headers, rows };
}

function parseCsvLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') { // escaped quote
                    cur += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += ch;
            }
        } else {
            if (ch === ',') {
                result.push(cur);
                cur = '';
            } else if (ch === '"') {
                inQuotes = true;
            } else {
                cur += ch;
            }
        }
    }
    result.push(cur);
    return result.map(s => s.trim());
}

function validateCsvRows(rows, headerInfo) {
    const allowedUnits = ['piece', 'lb', 'oz', 'g', 'kg', 'gallon', 'dozen', 'loaf', 'bag', 'bags', 'carton', 'block', 'jar', 'cup', 'box', 'pack', 'can', 'bottle'];
    const toImport = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
        const cols = rows[i];
        if (cols.length < headerInfo.count) {
            errors.push({ row: i + 2, message: `Expected at least ${headerInfo.count} columns, got ${cols.length}` });
            continue;
        }
        const obj = {};
        // Build object using mapped indices
        for (const key of Object.keys(headerInfo.map)) {
            const idx = headerInfo.map[key];
            obj[key] = (idx >= 0 ? cols[idx] : '');
        }
        const required = ['name', 'description', 'category', 'price', 'barcode', 'availability'];
        let bad = null;
        for (const k of required) {
            if (obj[k] === undefined || obj[k] === null || String(obj[k]).trim() === '') { bad = `${k} is required`; break; }
        }
        if (!bad) {
            const price = Number(cleanPrice(String(obj.price)));
            if (!Number.isFinite(price)) bad = 'price must be a number';
            else obj.price = price;
        }
        if (!bad) obj.availability = normalizeAvailability(String(obj.availability));
        if (!bad && !obj.availability) bad = 'availability must be In Stock or Out of Stock';
        if (!bad) {
            const unit = normalizeUnit(String(obj.priceUnit || 'piece'));
            if (!allowedUnits.includes(unit)) bad = 'priceUnit must be one of ' + allowedUnits.join(', ');
            else obj.priceUnit = unit;
        }
        if (bad) {
            errors.push({ row: i + 2, message: bad });
            continue;
        }
        obj.__row = i + 2; // preserve original row for later messages
        toImport.push(obj);
    }
    return { toImport, errors };
}

// Build a flexible header map: case-insensitive, ignore spaces/underscores, allow synonyms
function buildHeaderMap(headers) {
    const canon = name => name.toLowerCase().replace(/[_\s]+/g, '');
    const synonyms = {
        name: ['name', 'product', 'productname'],
        description: ['description', 'desc', 'details'],
        availability: ['availability', 'status', 'stock'],
        barcode: ['barcode', 'sku', 'code', 'upc', 'ean'],
        category: ['category', 'cat', 'type'],
        price: ['price', 'amount', 'cost'],
        priceUnit: ['priceunit', 'unit', 'uom', 'price_unit', 'per', 'perunit']
    };
    const required = ['name', 'description', 'availability', 'barcode', 'category', 'price', 'priceUnit'];
    const map = {};
    for (let i = 0; i < headers.length; i++) {
        const h = canon(headers[i] || '');
        for (const key of Object.keys(synonyms)) {
            if (synonyms[key].some(s => canon(s) === h)) {
                if (map[key] === undefined) map[key] = i;
            }
        }
    }
    const ok = required.every(k => map[k] !== undefined);
    return { ok, map, count: Object.keys(map).length };
}

// Normalize availability to exact values
function normalizeAvailability(val) {
    const v = (val || '').toString().trim().toLowerCase();
    if (!v) return '';
    const inStock = ['in stock', 'instock', 'available', 'yes', 'y', '1'];
    const outStock = ['out of stock', 'outofstock', 'out', 'oos', 'unavailable', 'no', 'n', '0'];
    if (inStock.includes(v)) return 'In Stock';
    if (outStock.includes(v)) return 'Out of Stock';
    // Try partial matches
    if (v.includes('in') && v.includes('stock')) return 'In Stock';
    if (v.includes('out') && v.includes('stock')) return 'Out of Stock';
    return '';
}

// Normalize unit: lowercase, singularize common plurals, accept "per x" formats
function normalizeUnit(val) {
    let u = (val || '').toString().trim().toLowerCase();
    if (!u) return 'piece';
    u = u.replace(/^per\s+/, '');
    // remove internal spaces (e.g., "l b" -> "lb")
    u = u.replace(/\s+/g, '');
    const map = {
        pieces: 'piece', pcs: 'piece', piece: 'piece',
        lbs: 'lb', pound: 'lb', pounds: 'lb', lb: 'lb', ib: 'lb', // handle common typo 'Ib'
        ounces: 'oz', ounce: 'oz', oz: 'oz',
        grams: 'g', gram: 'g', g: 'g',
        kilograms: 'kg', kilogram: 'kg', kg: 'kg',
        gallons: 'gallon', gallon: 'gallon',
        dozens: 'dozen', dozen: 'dozen',
        loaves: 'loaf', loaf: 'loaf',
        bags: 'bags', bag: 'bag',
        cartons: 'carton', carton: 'carton',
        blocks: 'block', block: 'block',
        jars: 'jar', jar: 'jar',
        cups: 'cup', cup: 'cup',
        boxes: 'box', box: 'box',
        packs: 'pack', pack: 'pack',
        cans: 'can', can: 'can',
        bottles: 'bottle', bottle: 'bottle'
    };
    return map[u] || u;
}

// Normalize name for duplicate detection
function normalizeName(name) {
    return (name || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

// Clean price string: remove $ and commas and spaces
function cleanPrice(val) {
    return (val || '').toString().replace(/[$,\s]/g, '');
}

// Expose CSV handlers for inline HTML attributes
window.triggerCsvPick = triggerCsvPick;
window.onCsvSelected = onCsvSelected;

// =====================
// AI Allergies
// =====================

// AI reviews are prepared in the workspace and saved only after review.
function autoAssignAllergiesForAll() { switchTab('ai'); }
window.autoAssignAllergiesForAll = autoAssignAllergiesForAll;

// =====================
// Label Print tab
// =====================
let labelPrintSelected = new Set();
let labelPreviewProductId = null;

function renderLabelPrintList(filterTerm) {
    const term = (filterTerm || '').trim().toLowerCase();
    const tbody = document.getElementById('label-print-tbody');
    if (!tbody) return;
    const filtered = products.filter(p => {
        if (!term) return true;
        const name = (p.name || '').toLowerCase();
        const barcode = (p.internalBarcode || p.barcode || '').toLowerCase();
        return name.includes(term) || barcode.includes(term);
    });
    tbody.innerHTML = '';
    filtered.forEach(p => {
        const barcode = p.internalBarcode || p.barcode || '—';
        const hasBarcode = !!(p.internalBarcode || p.barcode);
        const checked = labelPrintSelected.has(p.id) ? 'checked' : '';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="text-align:center"><input type="checkbox" class="label-row-check" data-id="${p.id}" ${checked} onchange="onLabelRowCheck('${p.id}',this.checked)"></td>
            <td><span class="product-name">${p.name}</span></td>
            <td style="font-family:monospace;font-size:13px">${hasBarcode ? barcode : '<span style="color:#d97706">No barcode</span>'}</td>
            <td>$${p.price.toFixed(2)} / ${p.priceUnit || 'piece'}</td>
            <td>${p.category || '—'}</td>
            <td>${p.areaLocation || 'A1'}</td>
            <td>
                <button class="action-btn" onclick="openLabelPreview('${p.id}')" ${hasBarcode ? '' : 'disabled title="No internal barcode"'}>👁 Preview ZPL</button>
                <button class="action-btn" style="color:#1677ff;border-color:#91caff" onclick="downloadProductZpl('${p.id}')" ${hasBarcode ? '' : 'disabled title="No internal barcode"'}>⬇ ZPL</button>
            </td>`;
        tbody.appendChild(row);
    });
    updateLabelSelectedCount();
    updateLabelCheckAll();
}

function onLabelRowCheck(productId, checked) {
    if (checked) labelPrintSelected.add(productId);
    else labelPrintSelected.delete(productId);
    updateLabelSelectedCount();
    updateLabelCheckAll();
}

function toggleLabelPrintAll(checked) {
    const checkboxes = document.querySelectorAll('.label-row-check');
    if (checked) {
        checkboxes.forEach(cb => { cb.checked = true; labelPrintSelected.add(cb.dataset.id); });
    } else {
        checkboxes.forEach(cb => { cb.checked = false; });
        labelPrintSelected.clear();
    }
    const allCheck = document.getElementById('label-check-all');
    if (allCheck) { allCheck.checked = checked; allCheck.indeterminate = false; }
    updateLabelSelectedCount();
}

function updateLabelCheckAll() {
    const checkboxes = Array.from(document.querySelectorAll('.label-row-check'));
    const allCheck = document.getElementById('label-check-all');
    if (!allCheck || !checkboxes.length) return;
    const allChecked = checkboxes.every(cb => cb.checked);
    const someChecked = checkboxes.some(cb => cb.checked);
    allCheck.checked = allChecked;
    allCheck.indeterminate = !allChecked && someChecked;
}

function updateLabelSelectedCount() {
    const el = document.getElementById('label-selected-count');
    if (el) el.textContent = `${labelPrintSelected.size} product${labelPrintSelected.size === 1 ? '' : 's'} selected`;
}

// ZPL helpers
function sanitizeZplText(str) {
    return (str || '').replace(/[\^~]/g, '').replace(/[\x00-\x1F]/g, ' ').trim();
}

function calcCode128X(barcodeStr, moduleWidth, labelWidthDots) {
    // Use full string length (Code 128B width) — matches what Labelary/ZPL actually renders
    // start(11) + data chars(11 each) + check(11) + stop(13) = 35 + 11*n modules
    const totalModules = 35 + 11 * barcodeStr.length;
    const barcodeWidth = totalModules * moduleWidth;
    return Math.max(10, Math.floor((labelWidthDots - barcodeWidth) / 2));
}

function getLabelSize() {
    return document.getElementById('label-size-select')?.value || '4x2';
}

function getLabelCopies() {
    return Math.max(1, Math.min(99, parseInt(document.getElementById('label-copies-input')?.value) || 1));
}

function generateZpl(product, copies, labelSize) {
    const name = sanitizeZplText(product.name || 'Unknown');
    const rawBarcode = (product.internalBarcode || product.barcode || '').replace(/[^\x20-\x7E]/g, '').trim();
    if (!rawBarcode) return null;
    const price = sanitizeZplText(`$${(product.price || 0).toFixed(2)} / ${product.priceUnit || 'piece'}`);

    let singleLabel;
    if (labelSize === '2x1') {
        // 2" x 1" = 406 x 203 dots @ 203 dpi
        const bx = calcCode128X(rawBarcode, 2, 406);
        singleLabel = [
            '^XA',
            '^CI28',
            `^FO0,8^A0N,22,15^FB406,1,0,C^FD${name}^FS`,
            `^FO${bx},38^BY2,3,68^BCN,68,Y,N,N^FD${rawBarcode}^FS`,
            `^FO0,173^A0N,22,15^FB396,1,0,R^FD${price}^FS`,
            '^XZ'
        ].join('\n');
    } else if (labelSize === '4x3') {
        // 4" x 3" = 812 x 609 dots @ 203 dpi
        const bx = calcCode128X(rawBarcode, 4, 812);
        singleLabel = [
            '^XA',
            '^CI28',
            `^FO0,20^A0N,46,32^FB812,2,0,C^FD${name}^FS`,
            `^FO${bx},120^BY4,3,160^BCN,160,Y,N,N^FD${rawBarcode}^FS`,
            `^FO0,368^A0N,38,26^FB787,1,0,R^FD${price}^FS`,
            '^XZ'
        ].join('\n');
    } else if (labelSize === '4x6') {
        // 4" x 6" = 812 x 1218 dots @ 203 dpi
        const bx = calcCode128X(rawBarcode, 5, 812);
        singleLabel = [
            '^XA',
            '^CI28',
            `^FO0,30^A0N,54,38^FB812,2,0,C^FD${name}^FS`,
            `^FO${bx},150^BY5,3,200^BCN,200,Y,N,N^FD${rawBarcode}^FS`,
            `^FO0,445^A0N,44,32^FB787,1,0,R^FD${price}^FS`,
            '^XZ'
        ].join('\n');
    } else {
        // Default: 4" x 2" = 812 x 406 dots @ 203 dpi
        const bx = calcCode128X(rawBarcode, 4, 812);
        singleLabel = [
            '^XA',
            '^CI28',
            `^FO0,15^A0N,40,28^FB812,2,0,C^FD${name}^FS`,
            `^FO${bx},98^BY4,3,130^BCN,130,Y,N,N^FD${rawBarcode}^FS`,
            `^FO0,305^A0N,34,24^FB787,1,0,R^FD${price}^FS`,
            '^XZ'
        ].join('\n');
    }

    const n = Math.max(1, Math.min(99, parseInt(copies) || 1));
    return Array(n).fill(singleLabel).join('\n');
}

function downloadZplFile(content, filename) {
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadProductZpl(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    const zpl = generateZpl(product, getLabelCopies(), getLabelSize());
    if (!zpl) { showError('This product has no internal barcode — cannot generate ZPL.'); return; }
    const safeName = (product.name || 'product').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
    downloadZplFile(zpl, `label-${safeName}.zpl`);
}

function downloadSelectedZpl() {
    if (!labelPrintSelected.size) { showError('No products selected. Select at least one product first.'); return; }
    const size = getLabelSize();
    const copies = getLabelCopies();
    const parts = [];
    let skipped = 0;
    for (const id of labelPrintSelected) {
        const product = products.find(p => p.id === id);
        if (!product) continue;
        const zpl = generateZpl(product, copies, size);
        if (!zpl) { skipped++; continue; }
        parts.push(zpl);
    }
    if (!parts.length) { showError('None of the selected products have an internal barcode.'); return; }
    downloadZplFile(parts.join('\n'), `labels-${labelPrintSelected.size}-products.zpl`);
    if (skipped > 0) showError(`${skipped} product(s) skipped — no internal barcode.`);
    else showSuccess(`Downloaded ZPL for ${parts.length} product label${parts.length === 1 ? '' : 's'}.`);
}

// Label preview modal
function openLabelPreview(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    labelPreviewProductId = productId;
    const overlay = document.getElementById('label-preview-overlay');
    if (!overlay) return;
    overlay.classList.add('open');
    const info = document.getElementById('label-preview-product-info');
    if (info) info.innerHTML = `<strong>${product.name}</strong>&nbsp;&nbsp;·&nbsp;&nbsp;Barcode: <code style="font-size:13px;background:#f1f5f9;padding:2px 6px;border-radius:4px">${product.internalBarcode || product.barcode || '—'}</code>`;
    const zpl = generateZpl(product, getLabelCopies(), getLabelSize());
    const textarea = document.getElementById('label-zpl-text');
    if (textarea) textarea.value = zpl || '(No internal barcode — cannot generate ZPL)';
    showLabelPreviewTab('text');
}

function closeLabelPreview() {
    const overlay = document.getElementById('label-preview-overlay');
    if (overlay) overlay.classList.remove('open');
    labelPreviewProductId = null;
    const img = document.getElementById('label-visual-img');
    if (img) { img.src = ''; img.style.display = 'none'; }
    const err = document.getElementById('label-visual-error');
    if (err) err.style.display = 'none';
}

function showLabelPreviewTab(tab) {
    const textSection = document.getElementById('label-preview-text-section');
    const visualSection = document.getElementById('label-preview-visual-section');
    const textTab = document.getElementById('tab-zpl-text');
    const visualTab = document.getElementById('tab-zpl-visual');
    if (tab === 'visual') {
        if (textSection) textSection.style.display = 'none';
        if (visualSection) visualSection.style.display = '';
        if (textTab) textTab.classList.remove('active');
        if (visualTab) visualTab.classList.add('active');
        renderLabelaryPreview();
    } else {
        if (textSection) textSection.style.display = '';
        if (visualSection) visualSection.style.display = 'none';
        if (textTab) textTab.classList.add('active');
        if (visualTab) visualTab.classList.remove('active');
    }
}

async function renderLabelaryPreview() {
    const loadingEl = document.getElementById('label-visual-loading');
    const imgEl = document.getElementById('label-visual-img');
    const errEl = document.getElementById('label-visual-error');
    if (!labelPreviewProductId) return;
    const product = products.find(p => p.id === labelPreviewProductId);
    if (!product) return;
    const zpl = generateZpl(product, 1, getLabelSize());
    if (!zpl) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (errEl) { errEl.textContent = 'No barcode — cannot render label.'; errEl.style.display = ''; }
        return;
    }
    const sizeMap = { '2x1': '2x1', '4x2': '4x2', '4x3': '4x3', '4x6': '4x6' };
    const dims = sizeMap[getLabelSize()] || '4x2';
    if (loadingEl) loadingEl.style.display = '';
    if (imgEl) imgEl.style.display = 'none';
    if (errEl) errEl.style.display = 'none';
    try {
        const resp = await fetch(`https://api.labelary.com/v1/printers/8dpmm/labels/${dims}/0/`, {
            method: 'POST',
            headers: { 'Accept': 'image/png', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: zpl
        });
        if (!resp.ok) throw new Error(`Labelary ${resp.status}`);
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        if (imgEl) { imgEl.src = blobUrl; imgEl.style.display = 'block'; }
        if (loadingEl) loadingEl.style.display = 'none';
    } catch (e) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (errEl) { errEl.textContent = 'Visual preview unavailable: ' + (e.message || e); errEl.style.display = ''; }
    }
}

function copyLabelZpl() {
    const textarea = document.getElementById('label-zpl-text');
    if (!textarea) return;
    navigator.clipboard.writeText(textarea.value).then(() => {
        showSuccess('ZPL code copied to clipboard!');
    }).catch(() => {
        textarea.select();
        document.execCommand('copy');
        showSuccess('ZPL code copied to clipboard!');
    });
}

function downloadCurrentLabelZpl() {
    if (!labelPreviewProductId) return;
    downloadProductZpl(labelPreviewProductId);
}

// Wire up window globals for HTML onclick handlers
window.renderLabelPrintList = renderLabelPrintList;
window.toggleLabelPrintAll = toggleLabelPrintAll;
window.onLabelRowCheck = onLabelRowCheck;
window.openLabelPreview = openLabelPreview;
window.closeLabelPreview = closeLabelPreview;
window.showLabelPreviewTab = showLabelPreviewTab;
window.downloadProductZpl = downloadProductZpl;
window.downloadSelectedZpl = downloadSelectedZpl;
window.copyLabelZpl = copyLabelZpl;
window.downloadCurrentLabelZpl = downloadCurrentLabelZpl;
