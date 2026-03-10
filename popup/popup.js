const $ = (s) => document.getElementById(s);

const loadingEl = $('loading');
const loggedOutEl = $('logged-out');
const loggedInEl = $('logged-in');
const usernameEl = $('username');
const statsEl = $('stats');
const followCountEl = $('follow-count');
const chaptersReadEl = $('chapters-read');
const adapterCountEl = $('adapter-count');
const pendingCountEl = $('pending-count');
const pendingSection = $('pending-section');
const pendingList = $('pending-list');
const retryAllBtn = $('retry-all-btn');
const clearQueueBtn = $('clear-queue-btn');
const versionEl = $('version');
const librarySearch = $('library-search');
const libraryList = $('library-list');
const libraryLoading = $('library-loading');
const libraryEmpty = $('library-empty');
const historyList = $('history-list');
const historyEmpty = $('history-empty');
const exportSettingsBtn = $('export-settings-btn');
const importSettingsBtn = $('import-settings-btn');
const importFileInput = $('import-file');
const clearCacheBtn = $('clear-cache-btn');

let cachedLibrary = [];
let cachedSettings = {};

function showState(s) {
    loadingEl.classList.toggle('on', s === 'loading');
    loggedOutEl.classList.toggle('on', s === 'logged-out');
    loggedInEl.classList.toggle('on', s === 'logged-in');
}

// tabs
document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('on'));
        tab.classList.add('on');
        document.querySelector(`.panel[data-panel="${tab.dataset.tab}"]`).classList.add('on');
        if (tab.dataset.tab === 'library') loadLibrary();
        if (tab.dataset.tab === 'history') loadHistory();
        if (tab.dataset.tab === 'settings') loadSettings();
    });
});

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ago(ts) {
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
}

function msg(m) {
    return new Promise((resolve) => chrome.runtime.sendMessage(m, resolve));
}

// ── home ──

async function loadStatus() {
    showState('loading');
    const status = await msg({ type: 'GET_STATUS' });
    if (!status?.authenticated) { showState('logged-out'); return; }

    const info = status.userInfo;
    usernameEl.textContent = info.username;
    statsEl.textContent = info.chapterCount?.toLocaleString() + ' chapters read on Comick';
    followCountEl.textContent = (info.followCount ?? 0).toLocaleString();
    chaptersReadEl.textContent = (info.chapterCount ?? 0).toLocaleString();
    adapterCountEl.textContent = (status.adapterCount ?? 0).toLocaleString();
    pendingCountEl.textContent = (status.pendingSyncs ?? 0).toString();

    if (status.pendingSyncs > 0) {
        pendingSection.hidden = false;
        renderQueue(status.syncQueue ?? []);
    } else {
        pendingSection.hidden = true;
    }

    versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
    showState('logged-in');
}

function renderQueue(q) {
    pendingList.innerHTML = q.slice(0, 15).map((i) => `
        <div class="entry">
            <div class="entry-dot err"></div>
            <div class="entry-body">
                <div class="entry-title">${esc(i.title)}</div>
                <div class="entry-sub">Ch. ${esc(i.episode)} &middot; ${esc(i.error ?? '?')} &middot; ${ago(i.timestamp)}</div>
            </div>
        </div>
    `).join('');
}

// ── library ──

async function loadLibrary() {
    libraryLoading.hidden = false;
    libraryEmpty.hidden = true;
    libraryList.innerHTML = '';

    const r = await msg({ type: 'GET_LIBRARY' });
    cachedLibrary = r?.library ?? [];
    libraryLoading.hidden = true;

    if (!cachedLibrary.length) { libraryEmpty.hidden = false; return; }
    renderLibrary(cachedLibrary);
}

function renderLibrary(items) {
    const q = (librarySearch.value ?? '').toLowerCase().trim();
    const filtered = q
        ? items.filter((i) => (i.md_comics?.title ?? i.md_comics?.slug ?? '').toLowerCase().includes(q))
        : items;

    libraryEmpty.hidden = filtered.length > 0;

    libraryList.innerHTML = filtered.slice(0, 80).map((item) => {
        const c = item.md_comics ?? {};
        const title = c.title ?? c.slug ?? '?';
        const at = item.md_chapters?.chap ?? '?';
        const last = c.last_chapter ?? '?';
        const done = at !== '?' && last !== '?' && Number(at) >= Number(last);
        return `
            <div class="entry click" data-slug="${esc(c.slug ?? '')}">
                <div class="entry-dot${done ? ' ok' : ''}"></div>
                <div class="entry-body">
                    <div class="entry-title">${esc(title)}</div>
                    <div class="entry-sub">Ch. ${esc(at)} / ${esc(last)}</div>
                </div>
                <div class="entry-tag">${done ? 'caught up' : 'Ch. ' + esc(at)}</div>
            </div>
        `;
    }).join('');

    libraryList.querySelectorAll('.entry.click').forEach((el) => {
        el.addEventListener('click', () => {
            if (el.dataset.slug) chrome.tabs.create({ url: `https://comick.dev/comic/${el.dataset.slug}` });
        });
    });
}

librarySearch.addEventListener('input', () => renderLibrary(cachedLibrary));

// ── history ──

async function loadHistory() {
    const r = await msg({ type: 'GET_SYNC_HISTORY' });
    const h = r?.history ?? {};
    const entries = Object.entries(h)
        .map(([k, v]) => ({ k, ...v }))
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

    if (!entries.length) {
        historyEmpty.hidden = false;
        historyList.innerHTML = '';
        return;
    }
    historyEmpty.hidden = true;

    historyList.innerHTML = entries.slice(0, 40).map((e) => `
        <div class="entry">
            <div class="entry-dot ok"></div>
            <div class="entry-body">
                <div class="entry-title">${esc(e.comicTitle ?? 'Ch. ' + e.episode)}</div>
                <div class="entry-sub">${e.comicTitle ? 'Ch. ' + esc(e.episode) + ' &middot; ' : ''}${esc(e.adapterId ?? '?')} &middot; ${ago(e.timestamp)}</div>
            </div>
        </div>
    `).join('');
}

// ── settings ──

const STYPES = {
    confirmBeforeSync: 'checkbox', autoRetryFailed: 'checkbox',
    retryIntervalMinutes: 'select', syncLanguages: 'text',
    notifications: 'checkbox', notifyOnSync: 'checkbox', notifyOnError: 'checkbox',
    floatButton: 'checkbox', floatButtonPosition: 'select', toastDuration: 'number',
};

async function loadSettings() {
    const r = await msg({ type: 'GET_SETTINGS' });
    cachedSettings = r?.settings ?? {};
    for (const [k, t] of Object.entries(STYPES)) {
        const el = $('setting-' + k);
        if (!el) continue;
        if (t === 'checkbox') el.checked = cachedSettings[k] ?? false;
        else if (k === 'syncLanguages') el.value = Array.isArray(cachedSettings[k]) ? cachedSettings[k].join(', ') : '';
        else el.value = cachedSettings[k] ?? '';
    }
}

for (const [k, t] of Object.entries(STYPES)) {
    const el = $('setting-' + k);
    if (!el) continue;
    el.addEventListener('change', () => {
        let v;
        if (t === 'checkbox') v = el.checked;
        else if (k === 'syncLanguages') v = el.value.split(',').map((s) => s.trim()).filter(Boolean);
        else if (t === 'number') v = Number(el.value);
        else v = el.value;
        cachedSettings[k] = v;
        msg({ type: 'SET_SETTING', key: k, value: v });
    });
}

exportSettingsBtn.addEventListener('click', async () => {
    const r = await msg({ type: 'GET_SETTINGS' });
    const blob = new Blob([JSON.stringify(r?.settings ?? {}, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: 'comicksync-settings.json' }).click();
    URL.revokeObjectURL(url);
});

importSettingsBtn.addEventListener('click', () => importFileInput.click());

importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
        const s = JSON.parse(await file.text());
        if (typeof s !== 'object' || !s) throw 0;
        await msg({ type: 'IMPORT_SETTINGS', settings: s });
        loadSettings();
    } catch { alert('Bad file'); }
    importFileInput.value = '';
});

clearCacheBtn.addEventListener('click', async () => {
    if (!confirm('Clear cached data? Your Comick account is unaffected.')) return;
    await msg({ type: 'CLEAR_CACHES' });
    loadStatus();
});

// ── queue actions ──

retryAllBtn.addEventListener('click', async () => {
    retryAllBtn.disabled = true;
    retryAllBtn.textContent = '...';
    await msg({ type: 'RETRY_SYNC_QUEUE' });
    await loadStatus();
    retryAllBtn.disabled = false;
    retryAllBtn.textContent = 'Retry';
});

clearQueueBtn.addEventListener('click', async () => {
    await msg({ type: 'CLEAR_SYNC_QUEUE' });
    loadStatus();
});

// ── auth ──

$('login-btn').addEventListener('click', () => msg({ type: 'LOGIN' }));

$('refresh-btn').addEventListener('click', async () => {
    const r = await msg({ type: 'REFRESH_AUTH' });
    if (r?.ok) loadStatus();
});

$('refresh-auth-btn').addEventListener('click', async () => {
    const r = await msg({ type: 'REFRESH_AUTH' });
    if (r?.ok) loadStatus();
});

loadStatus();
