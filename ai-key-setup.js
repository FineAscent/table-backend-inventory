/* Secret entry is isolated from the dashboard's third-party modules. */
(() => {
    if (window.top !== window.self) { document.body.replaceChildren(); return; }
    const endpoint = 'https://q5mv3u14v5.execute-api.us-east-1.amazonaws.com/Prod/ai/settings';
    const input = document.getElementById('ai-secret-key');
    const submit = document.getElementById('key-submit');
    const status = document.getElementById('key-status');
    const connection = document.getElementById('key-connection');
    let ready = false, saving = false;
    function message(value, error = false) { status.textContent = value; status.classList.toggle('error', error); }
    function clear() { input.value = ''; }
    function session() { try { return localStorage.getItem('id_token') || ''; } catch (_) { return ''; } }
    const messages = {
        sign_in_required: 'Sign in to the inventory dashboard, then reopen this page.',
        admin_required: 'This account is not enabled to manage the AI key.',
        setup_required: 'Secure key storage needs its one-time server setup. Nothing was saved.',
        invalid_key: 'Enter a valid OpenAI API key beginning with sk-.',
        key_or_model_unavailable: 'The key could not access GPT-6 Luna. Check its permissions and try again.',
        validation_unavailable: 'The provider could not validate the key. Nothing was saved. Try again later.',
        key_change_limited: 'The key was recently changed. Wait ten minutes before replacing it again.',
        save_failed: 'The key could not be saved. Try again later.'
    };
    async function check() {
        const token = session();
        if (!token) { connection.textContent = 'Sign in required'; message(messages.sign_in_required); return; }
        try {
            const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || typeof data.configured !== 'boolean') {
                connection.textContent = 'Not available'; message(messages[data.code] || messages.setup_required, true); return;
            }
            ready = true; input.disabled = false; submit.disabled = false;
            connection.textContent = data.configured ? 'Key configured' : 'No key configured';
            message(data.configured ? 'Enter a replacement key only if you want to change the connection.' : 'Enter your key to enable the AI connection.');
        } catch (_) { connection.textContent = 'Not available'; message('Could not reach secure key storage. Nothing was saved. The key field stays disabled until the service is available.', true); }
    }
    document.getElementById('key-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (!ready || saving) { clear(); return; }
        let key = input.value.trim();
        clear();
        if (!/^sk-[A-Za-z0-9_-]{20,500}$/.test(key)) { key = ''; message(messages.invalid_key, true); return; }
        const token = session();
        if (!token) { key = ''; message(messages.sign_in_required, true); return; }
        saving = true; input.disabled = true; submit.disabled = true;
        message('Validating and saving your key…');
        try {
            const request = fetch(endpoint, {
                method: 'PUT', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-AI-Setup': '1' },
                body: JSON.stringify({ apiKey: key })
            });
            key = '';
            const response = await request;
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.configured !== true) { message(messages[data.code] || 'The key was not saved. Please retry.', true); return; }
            connection.textContent = 'Key configured'; message('Key saved securely. It will not be shown again.');
        } catch (_) { message('Save status could not be confirmed. Reload this page to check the connection before trying again.', true); }
        finally { key = ''; clear(); saving = false; input.disabled = false; submit.disabled = false; }
    });
    document.getElementById('key-clear').addEventListener('click', clear);
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    check();
})();
