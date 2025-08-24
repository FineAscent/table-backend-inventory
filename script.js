 // Backend API Configuration
        const API_BASE_URL = 'https://w2bspt32w4.execute-api.us-east-1.amazonaws.com/prod';

        // Cognito (Admin) Auth Configuration
        const COGNITO_DOMAIN = 'https://aliabab-inventory-prod-admin.auth.us-east-1.amazoncognito.com';
        const COGNITO_CLIENT_ID = '7ujm0u63v834c054nf9juh3ook';
        const REDIRECT_URI = 'https://fineascent.github.io/table-backend-inventory/';

        // Simple auth state helpers
        function getIdToken() {
            return window.localStorage.getItem('id_token') || '';
        }

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
        const imageUrlCache = new Map(); // key -> url

        // Initialize the application
        document.addEventListener('DOMContentLoaded', function() {
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

        // Backend service (uses deployed API)
        class DynamoDBService {
            constructor() {
                // no-op
            }

            initializeData() {
                // no seed data; backend holds truth
            }

            async scanProducts() {
                const resp = await fetch(`${API_BASE_URL}/products`, {
                    method: 'GET'
                });
                if (!resp.ok) {
                    const t = await resp.text();
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
                    barcode: product.barcode,
                    availability: product.availability,
                    imageKeys: Array.isArray(product.imageKeys) ? product.imageKeys : [],
                    deleteKeys: Array.isArray(product.deleteKeys) ? product.deleteKeys : undefined
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
                if (imageUrlCache.has(key)) return { url: imageUrlCache.get(key) };
                const resp = await fetch(`${API_BASE_URL}/image-url`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key })
                });
                if (!resp.ok) {
                    const t = await resp.text();
                    throw new Error(`Image URL failed (${resp.status}): ${t}`);
                }
                const json = await resp.json();
                if (json && json.url) imageUrlCache.set(key, json.url);
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

        // Load products from backend API
        async function loadProducts() {
            try {
                showLoading(true);
                const result = await dbService.scanProducts();
                products = result.items || result.Items || [];
                renderProducts();
            } catch (error) {
                showError('Failed to load products: ' + error.message);
            } finally {
                showLoading(false);
            }
        }

        // Render products in the table
        function renderProducts() {
            const tbody = document.getElementById('products-tbody');
            const filteredProducts = applyFilters(products);
            
            tbody.innerHTML = '';
            
            filteredProducts.forEach(product => {
                const row = document.createElement('tr');
                const thumbCellId = `thumb-${product.id}`;
                const unit = (product.priceUnit || 'piece');
                const unitLabelMap = { piece: 'piece', lb: 'lb', oz: 'oz', g: 'g', kg: 'kg', gallon: 'gallon', dozen: 'dozen', loaf: 'loaf', bag: 'bag', bags: 'bags', carton: 'carton', block: 'block', jar: 'jar', cup: 'cup', box: 'box', pack: 'pack', can: 'can', bottle: 'bottle' };
                const unitLabel = unitLabelMap[unit] || unit;
                row.innerHTML = `
                    <td>
                        <div class="product-image" id="${thumbCellId}">📷</div>
                    </td>
                    <td><span class="product-name">${product.name}</span></td>
                    <td>${product.description}</td>
                    <td><span class="status-badge ${product.availability === 'In Stock' ? 'status-in-stock' : 'status-out-of-stock'}">${product.availability}</span></td>
                    <td>${product.barcode}</td>
                    <td>${product.category}</td>
                    <td><span class="price">$${product.price.toFixed(2)} / ${unitLabel}</span></td>
                    <td>
                        <button class="action-btn" onclick="editProduct('${product.id}')">Edit</button>
                        <button class="action-btn delete-btn" onclick="deleteProduct('${product.id}')">Delete</button>
                    </td>
                `;
                tbody.appendChild(row);

                // Render thumbnail if available
                const keys = product.imageKeys || product.image_keys || [];
                if (Array.isArray(keys) && keys.length > 0) {
                    const firstKey = keys[0];
                    dbService.getImageUrl(firstKey).then(({ url }) => {
                        const cell = document.getElementById(thumbCellId);
                        if (cell && url) {
                            cell.innerHTML = `<img src="${url}" alt="thumb" style="width:40px;height:40px;object-fit:cover;border-radius:6px;"/>`;
                        }
                    }).catch(() => {/* ignore */});
                }
            });
        }

        // Apply filters to products
        function applyFilters(products) {
            const term = (searchTerm || '').trim().toLowerCase();
            return products.filter(product => {
                // Availability filter
                if (filters['out-of-stock'] && product.availability === 'Out of Stock') return false;

                // Text search filter (name or barcode)
                if (term) {
                    const name = (product.name || '').toLowerCase();
                    const barcode = (product.barcode || '').toLowerCase();
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
            // reset images
            resetImages();
            existingImageKeys = [null, null];
            deleteKeys = [];
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
                document.getElementById('product-barcode').value = product.barcode;
                document.getElementById('product-availability').value = product.availability;
                document.getElementById('product-modal').style.display = 'block';
                resetImages();
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
                    }).catch(() => {/* ignore */});
                });
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
                    barcode: document.getElementById('product-barcode').value,
                    availability: document.getElementById('product-availability').value
                };

                if (currentEditingId) {
                    formData.id = currentEditingId;
                }

                // Upload new images to S3 if selected
                const imageKeys = [];
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
                    imageKeys.push(key);
                }

                if (imageKeys.length > 0) formData.imageKeys = imageKeys;
                if (currentEditingId && deleteKeys.length > 0) formData.deleteKeys = deleteKeys;

                await dbService.putProduct(formData);
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
        window.onclick = function(event) {
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
window.onclick = function(event) {
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
        dots.push(`<button type="button" class="dot ${has ? 'has' : ''} ${active ? 'active' : ''}" onclick="setCarousel(${i})" aria-label="Image ${i+1}"></button>`);
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
        if (errors.length) {
            const sample = errors.slice(0, 5).map(er => `Row ${er.row}: ${er.message}`).join('<br>');
            showError(`Some rows invalid. Importing valid rows. Errors:<br>${sample}${errors.length>5?'\n...':''}`);
        }
        let success = 0; let fail = 0;
        for (let i = 0; i < toImport.length; i++) {
            const p = toImport[i];
            try {
                await dbService.putProduct({
                    name: p.name,
                    description: p.description,
                    availability: p.availability,
                    barcode: p.barcode,
                    category: p.category,
                    price: Number(p.price),
                    priceUnit: p.priceUnit || 'piece',
                    imageKeys: []
                });
                success++;
            } catch (err) {
                fail++;
            }
        }
        showSuccess(`Import complete. Added: ${success}. Failed: ${fail + errors.length}.`);
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
    for (let i = 0; i < a.length; i++) if ((a[i]||'').trim() !== (b[i]||'').trim()) return false;
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
                if (i + 1 < line.length && line[i+1] === '"') { // escaped quote
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
    const allowedUnits = ['piece','lb','oz','g','kg','gallon','dozen','loaf','bag','bags','carton','block','jar','cup','box','pack','can','bottle'];
    const toImport = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
        const cols = rows[i];
        if (cols.length < headerInfo.count) {
            errors.push({ row: i+2, message: `Expected at least ${headerInfo.count} columns, got ${cols.length}` });
            continue;
        }
        const obj = {};
        // Build object using mapped indices
        for (const key of Object.keys(headerInfo.map)) {
            const idx = headerInfo.map[key];
            obj[key] = (idx >= 0 ? cols[idx] : '');
        }
        const required = ['name','description','category','price','barcode','availability'];
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
            errors.push({ row: i+2, message: bad });
            continue;
        }
        toImport.push(obj);
    }
    return { toImport, errors };
}

// Build a flexible header map: case-insensitive, ignore spaces/underscores, allow synonyms
function buildHeaderMap(headers) {
    const canon = name => name.toLowerCase().replace(/[_\s]+/g, '');
    const synonyms = {
        name: ['name','product','productname'],
        description: ['description','desc','details'],
        availability: ['availability','status','stock'],
        barcode: ['barcode','sku','code','upc','ean'],
        category: ['category','cat','type'],
        price: ['price','amount','cost'],
        priceUnit: ['priceunit','unit','uom','price_unit','per','perunit']
    };
    const required = ['name','description','availability','barcode','category','price','priceUnit'];
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
    const inStock = ['in stock','instock','available','yes','y','1'];
    const outStock = ['out of stock','outofstock','out','oos','unavailable','no','n','0'];
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
    const map = {
        pieces: 'piece', pcs: 'piece', piece: 'piece',
        lbs: 'lb', pound: 'lb', pounds: 'lb', lb: 'lb',
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

// Clean price string: remove $ and commas and spaces
function cleanPrice(val) {
    return (val || '').toString().replace(/[$,\s]/g, '');
}

// Expose CSV handlers for inline HTML attributes
window.triggerCsvPick = triggerCsvPick;
window.onCsvSelected = onCsvSelected;