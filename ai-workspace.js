/* Read-only monitoring for the automatic allergy pipeline. No approval step. */
(() => {
    const $ = id => document.getElementById(id);
    const state = { id: '', filter: '', onlyWaiting: false };
    const statuses = {
        pending: 'Scheduled after 24 hours', complete: 'Automatically checked',
        not_required: 'No notice for plain produce', needs_label: 'Source lookup pending',
        retry: 'Automatic retry scheduled', unavailable: 'No reliable source found', manual: 'Existing notice retained'
    };
    const text = (tag, value, className) => {
        const element = document.createElement(tag);
        element.textContent = value;
        if (className) element.className = className;
        return element;
    };
    function statusOf(product) {
        if (product.allergyAttempts >= 3 && ['needs_label', 'retry'].includes(product.allergyStatus)) return 'unavailable';
        return product.allergyStatus || (product.allergySummary && product.allergySummary !== 'none' ? 'manual' : 'pending');
    }
    function describe(product) {
        $('ai-detail').hidden = false;
        $('ai-empty-selection').hidden = true;
        $('ai-selected-name').textContent = product.name;
        $('ai-current-status').textContent = statuses[statusOf(product)] || 'Scheduled after 24 hours';
        $('ai-current-category').textContent = product.category || 'Uncategorized';
        $('ai-current-description').textContent = product.description || 'No description';
        $('ai-current-allergy').textContent = product.allergySummary && product.allergySummary.toLowerCase() !== 'none' ? product.allergySummary : 'No customer notice';
        $('ai-checked-at').textContent = product.allergyCheckedAt ? new Date(product.allergyCheckedAt).toLocaleString() : 'Not checked yet';
        const evidence = $('ai-evidence'); evidence.replaceChildren();
        if (product.allergySource === 'open_food_facts' && /^\d{8,14}$/.test(product.upc || '')) {
            const link = text('a', 'Source: Open Food Facts');
            link.href = 'https://world.openfoodfacts.org/product/' + product.upc;
            link.target = '_blank'; link.rel = 'noopener noreferrer'; evidence.append(link);
        } else {
            evidence.append(text('p', product.allergySource === 'package_label' ? 'Source: ingredient label' : product.allergySource === 'plain_produce' ? 'Plain produce: no API call needed.' : 'Sources are retrieved automatically when available.', 'ai-help'));
        }
        for (const [key, label] of [['contains', 'Contains'], ['mayContain', 'May contain']]) {
            for (const item of product.allergyEvidence?.[key] || []) {
                const card = document.createElement('div'); card.className = 'ai-suggestion';
                card.append(text('strong', `${label}: ${item.allergen}`), text('blockquote', item.evidence)); evidence.append(card);
            }
        }
        if (statusOf(product) === 'unavailable') evidence.append(text('p', 'Automatic source attempts finished without reliable evidence. No notice was invented. Changes to product information restart the automatic check.', 'ai-warning'));
    }
    function refresh() {
        if (!$('panel-ai')) return;
        const inventory = products.filter(p => p.entityType !== 'award');
        const waiting = p => ['pending', 'retry', 'needs_label'].includes(statusOf(p));
        $('ai-total').textContent = inventory.length;
        $('ai-pending').textContent = inventory.filter(waiting).length;
        $('ai-complete').textContent = inventory.filter(p => ['complete', 'not_required', 'manual'].includes(statusOf(p))).length;
        const list = $('ai-product-list'); list.replaceChildren();
        const filtered = inventory.filter(p => (!state.onlyWaiting || waiting(p)) && [p.name, p.internalBarcode, p.upc].some(v => String(v || '').toLowerCase().includes(state.filter)));
        $('ai-list-count').textContent = `${filtered.length} products`;
        if (!filtered.length) list.append(text('p', inventory.length ? 'No matching products.' : 'Your inventory appears here after products load.', 'ai-empty'));
        for (const product of filtered) {
            const button = document.createElement('button'); button.type = 'button';
            button.className = 'ai-product' + (state.id === product.id ? ' selected' : '');
            button.setAttribute('aria-pressed', String(state.id === product.id));
            button.append(text('strong', product.name), text('span', `${product.category || 'Uncategorized'} · ${product.internalBarcode || 'No barcode'}`), text('small', statuses[statusOf(product)] || statuses.pending, waiting(product) ? 'ai-issue' : 'ai-ready'));
            button.addEventListener('click', () => { state.id = product.id; refresh(); }); list.append(button);
        }
        const selected = inventory.find(p => p.id === state.id);
        if (selected) describe(selected);
        else { state.id = ''; $('ai-detail').hidden = true; $('ai-empty-selection').hidden = false; }
    }
    document.addEventListener('DOMContentLoaded', () => {
        try { localStorage.removeItem('openai_api_key'); localStorage.removeItem('inventory_ai_endpoint'); } catch (_) { /* Optional browser storage */ }
        const nav = document.querySelector('.sidebar-tabs');
        const button = text('button', 'AI Workspace', 'tab-item'); button.type = 'button'; button.dataset.tab = 'ai';
        button.addEventListener('click', () => switchTab('ai')); nav.append(button);
        if (!$('panel-products')) {
            const wrapper = document.createElement('div'); wrapper.id = 'panel-products'; wrapper.className = 'tab-panel';
            const table = document.querySelector('.main-content > .table-container'); table.before(wrapper); wrapper.append(table);
            const productsButton = nav.querySelector('button'); productsButton.dataset.tab = 'products'; productsButton.addEventListener('click', () => switchTab('products'));
        }
        const panel = document.createElement('section'); panel.id = 'panel-ai'; panel.className = 'tab-panel ai-workspace'; panel.style.display = 'none';
        panel.innerHTML = `
            <header class="ai-heading"><div><span class="ai-eyebrow">INVENTORY INTELLIGENCE</span><h1>Allergy notices, on autopilot.</h1><p>Source lookup, evidence checks, and saving happen automatically.</p></div><span class="ai-mode">Automatic after 24 hours</span></header>
            <p class="ai-key-settings-link"><a href="ai-key-setup.html" target="_blank" rel="noopener noreferrer">Add or replace AI API key ↗</a></p>
            <div class="ai-stats"><div><span>Products in inventory</span><strong id="ai-total">0</strong></div><div><span>Scheduled or retrying</span><strong id="ai-pending">0</strong></div><div><span>Processed or existing notices</span><strong id="ai-complete">0</strong></div></div>
            <p class="ai-automation-note">When enabled on the server, hourly checks process products at least 24 hours old. Supported notices are saved automatically. Plain produce stays blank. Missing sources retry automatically up to three times; unsupported claims stay blank. No approval is required.</p>
            <div class="ai-grid"><aside class="ai-card"><div class="ai-card-heading"><h2>Automation queue</h2><span id="ai-list-count"></span></div><label class="ai-sr-only" for="ai-search">Search products</label><input id="ai-search" type="search" placeholder="Search name or barcode"><label class="ai-filter"><input id="ai-waiting-only" type="checkbox"> Show scheduled and retrying products</label><div id="ai-product-list" class="ai-product-list"></div></aside>
            <section class="ai-card"><div id="ai-empty-selection" class="ai-empty-selection"><span class="ai-spark" aria-hidden="true">✦</span><h2>Everything runs automatically</h2><p>Select a product to see its processing status, customer notice, and source evidence. You do not need to generate, approve, or save anything here.</p></div>
            <div id="ai-detail" hidden><span class="ai-eyebrow">AUTOMATIC PROCESSING</span><h2 id="ai-selected-name"></h2><dl class="ai-current"><div><dt>Status</dt><dd id="ai-current-status"></dd></div><div><dt>Category</dt><dd id="ai-current-category"></dd></div><div><dt>Description</dt><dd id="ai-current-description"></dd></div><div><dt>Customer allergy notice</dt><dd id="ai-current-allergy"></dd></div><div><dt>Last automatic check</dt><dd id="ai-checked-at"></dd></div></dl><h3>Source evidence</h3><div id="ai-evidence"></div></div></section></div>`;
        document.querySelector('.main-content').append(panel);
        $('ai-search').addEventListener('input', event => { state.filter = event.target.value.trim().toLowerCase(); refresh(); });
        $('ai-waiting-only').addEventListener('change', event => { state.onlyWaiting = event.target.checked; refresh(); });
        window.aiWorkspace = { refresh }; refresh();
    });
})();
