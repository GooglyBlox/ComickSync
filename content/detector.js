(() => {
    const DEBOUNCE_MS = 1200;
    const PANEL_ID = 'comicksync-inline-panel';
    const STYLE_ID = 'comicksync-inline-style';
    const TOAST_ID = 'comicksync-toast';
    const DEBUG = false;
    const LOG_PREFIX = '[ComickSync][content]';
    const TOAST_DURATION_MS = 2600;
    let runnerPromise = null;
    let activeRequestId = 0;
    let lastDetectionKey = '';
    let inFlightDetectionKey = '';
    let lastRenderedState = null;
    let lastToastKey = '';
    let toastTimer = null;

    function log(...args) {
        if (!DEBUG) {
            return;
        }
        console.log(LOG_PREFIX, ...args);
    }

    function makeDetectionKey(detection) {
        const normalizedUrl = String(detection.url ?? '')
            .replace(/[#?].*/, '')
            .replace(/\/+$/, '')
            .toLowerCase();
        const normalizedIdentifier = String(detection.identifier ?? '')
            .trim()
            .toLowerCase();
        const normalizedEpisode = detection.episode == null ? '' : String(detection.episode);

        return [
            detection.adapterId ?? '',
            detection.pageType ?? '',
            normalizedIdentifier || normalizedUrl,
            normalizedEpisode,
        ].join(':');
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${PANEL_ID} {
                display: flex;
                flex-direction: column;
                gap: 4px;
                margin: 10px 0;
                padding: 8px 10px;
                border: 1px solid currentColor;
                color: inherit;
                font-family: inherit;
                background: transparent;
            }

            #${PANEL_ID}.is-success {
                border-color: currentColor;
            }

            #${PANEL_ID}.is-warning {
                border-color: currentColor;
            }

            #${PANEL_ID}.is-error {
                border-color: currentColor;
            }

            #${PANEL_ID} .comicksync-panel__eyebrow {
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.04em;
                text-transform: uppercase;
                color: inherit;
                opacity: 0.7;
            }

            #${PANEL_ID} .comicksync-panel__title {
                font-size: 13px;
                font-weight: 600;
                line-height: 1.25;
                color: inherit;
            }

            #${PANEL_ID} .comicksync-panel__meta {
                display: grid;
                gap: 3px;
                font-size: 12px;
                line-height: 1.35;
                color: inherit;
                opacity: 0.82;
            }

            #${PANEL_ID} .comicksync-panel__meta-line {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                align-items: baseline;
            }

            #${PANEL_ID} .comicksync-panel__meta-label {
                font-weight: 600;
                color: inherit;
                opacity: 0.72;
            }

            [data-comicksync-read="true"] {
                outline: 1px solid currentColor;
                outline-offset: 1px;
            }

            .comicksync-read-badge {
                display: inline-flex;
                align-items: center;
                margin-left: 8px;
                padding: 0;
                border: 0;
                color: inherit;
                font-size: 10px;
                font-family: inherit;
                font-weight: 500;
                opacity: 0.7;
                white-space: nowrap;
            }

            #${TOAST_ID} {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 2147483647;
                max-width: 320px;
                padding: 10px 12px;
                border: 1px solid currentColor;
                background: rgba(20, 24, 30, 0.92);
                color: #fff;
                font: 12px/1.4 inherit;
                opacity: 0;
                transform: translateY(8px);
                transition: opacity 140ms ease, transform 140ms ease;
                pointer-events: none;
            }

            #${TOAST_ID}.is-visible {
                opacity: 1;
                transform: translateY(0);
            }

        `;
        document.documentElement.appendChild(style);
    }

    function createPanel() {
        const panel = document.createElement('section');
        panel.id = PANEL_ID;
        panel.setAttribute('aria-live', 'polite');
        panel.innerHTML = `
            <div class="comicksync-panel__eyebrow">ComickSync</div>
            <div class="comicksync-panel__title"></div>
            <div class="comicksync-panel__meta"></div>
        `;
        return panel;
    }

    function getPanel() {
        let panel = document.getElementById(PANEL_ID);
        if (!panel) {
            panel = createPanel();
        }
        return panel;
    }

    function clearPanel() {
        document.getElementById(PANEL_ID)?.remove();
    }

    function getToast() {
        let toast = document.getElementById(TOAST_ID);
        if (!toast) {
            toast = document.createElement('div');
            toast.id = TOAST_ID;
            document.documentElement.appendChild(toast);
        }
        return toast;
    }

    function clearToast() {
        if (toastTimer) {
            clearTimeout(toastTimer);
            toastTimer = null;
        }

        const toast = document.getElementById(TOAST_ID);
        if (!toast) {
            return;
        }
        toast.classList.remove('is-visible');
    }

    function showToast(title, detail = '', toastKey = '') {
        if (toastKey && toastKey === lastToastKey) {
            return;
        }
        if (toastKey) {
            lastToastKey = toastKey;
        }

        ensureStyle();
        const toast = getToast();
        toast.innerHTML = detail
            ? `<strong>${escapeHtml(title)}</strong><br>${escapeHtml(detail)}`
            : `<strong>${escapeHtml(title)}</strong>`;
        toast.classList.add('is-visible');

        if (toastTimer) {
            clearTimeout(toastTimer);
        }
        toastTimer = setTimeout(() => {
            toast.classList.remove('is-visible');
            toastTimer = null;
        }, TOAST_DURATION_MS);
    }

    function clearChapterIndicators() {
        document.querySelectorAll('[data-comicksync-read="true"]').forEach((element) => {
            element.removeAttribute('data-comicksync-read');
        });
        document.querySelectorAll('.comicksync-read-badge').forEach((element) => {
            element.remove();
        });
    }

    function findFallbackAnchor() {
        return document.querySelector(
            'main, article, .postbody, .entry-content, .site-main, .container, .content, body'
        );
    }

    function getInjectionSections(pageType) {
        return pageType === 'sync' ? ['sync', 'overview'] : ['overview', 'sync'];
    }

    function normalizeLooseText(value) {
        return String(value ?? '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function isPlaceholderTitle(adapter, title) {
        const normalizedTitle = normalizeLooseText(title);
        if (!normalizedTitle) {
            return false;
        }

        const adapterNames = [
            adapter?.name,
            window.location.hostname.replace(/^www\./, '').split('.')[0],
        ]
            .map(normalizeLooseText)
            .filter(Boolean);

        return adapterNames.includes(normalizedTitle);
    }

    function getInjectionSpec(adapter, runner, pageType) {
        if (!runner) {
            return { target: findFallbackAnchor(), mode: 'prepend' };
        }

        for (const section of getInjectionSections(pageType)) {
            const script = adapter?.[section]?.uiInjection;
            if (!Array.isArray(script) || script.length === 0) {
                continue;
            }

            const lastInstruction = script[script.length - 1];
            const mode = Array.isArray(lastInstruction)
                ? (
                    {
                        uiBefore: 'before',
                        uiAfter: 'after',
                    }[lastInstruction[0]] ?? 'append'
                )
                : 'append';

            let target = null;
            try {
                target = runner.evaluateField(section, 'uiInjection');
            } catch {
                target = null;
            }

            if (target?.nodeType === 1) {
                return { target, mode };
            }
        }

        return { target: findFallbackAnchor(), mode: 'prepend' };
    }

    function placePanel(panel, adapter, runner, pageType) {
        const { target, mode } = getInjectionSpec(adapter, runner, pageType);
        if (!target?.isConnected) {
            return;
        }

        if (mode === 'before') {
            target.before(panel);
            return;
        }

        if (mode === 'after') {
            target.after(panel);
            return;
        }

        target.prepend(panel);
    }

    function setPanelState(adapter, runner, pageType, state, title, metaLines) {
        ensureStyle();

        const panel = getPanel();
        panel.className = '';
        panel.classList.add(`is-${state}`);

        const titleElement = panel.querySelector('.comicksync-panel__title');
        const metaElement = panel.querySelector('.comicksync-panel__meta');
        if (!titleElement || !metaElement) {
            return;
        }

        titleElement.textContent = title;
        metaElement.innerHTML = metaLines
            .filter(({ value }) => Boolean(value))
            .slice(0, 2)
            .map(({ label, value }) => {
                return `
                    <div class="comicksync-panel__meta-line">
                        <span class="comicksync-panel__meta-label">${escapeHtml(label)}</span>
                        <span>${escapeHtml(value)}</span>
                    </div>
                `;
            })
            .join('');

        placePanel(panel, adapter, runner, pageType);
    }

    function renderResponseState(adapter, runner, detection, response, options = {}) {
        const pageType = detection.pageType;
        const shouldNotify = options.notify !== false;

        if (pageType === 'sync' && response?.synced) {
            clearPanel();
            applyChapterIndicators(runner, response);
            if (shouldNotify) {
                showToast(
                    response.comicTitle ?? detection.title,
                    response.skipped
                        ? `Chapter ${detection.episode} was already marked as read`
                        : `Chapter ${detection.episode} marked as read on Comick`,
                    `${makeDetectionKey(detection)}:synced:${response.skipped ? 'skipped' : 'done'}`
                );
            }
            return true;
        }

        if (pageType !== 'sync' && response?.matched) {
            applyChapterIndicators(runner, response);
            setPanelState(adapter, runner, pageType, 'success', response.comicTitle ?? detection.title, [
                {
                    label: 'Read',
                    value: response.libraryEpisode != null
                        ? `Up to Chapter ${response.libraryEpisode}`
                        : response.inLibrary
                            ? 'In your Comick library'
                            : 'No read progress on Comick',
                },
                {
                    label: 'Latest',
                    value: response.libraryLastChapter != null
                        ? `Chapter ${response.libraryLastChapter}`
                        : 'Latest chapter unavailable',
                },
            ]);
            return true;
        }

        if (response?.reason === 'comic_not_found') {
            clearChapterIndicators();
            setPanelState(adapter, runner, pageType, 'warning', detection.title, [
                { label: 'Status', value: 'No matching series found on Comick' },
            ]);
            return true;
        }

        if (response?.reason === 'chapter_not_found') {
            if (pageType === 'sync') {
                clearPanel();
                if (shouldNotify) {
                    showToast(
                        response.comicTitle ?? detection.title,
                        `Chapter ${detection.episode} was not found on Comick`,
                        `${makeDetectionKey(detection)}:chapter_not_found`
                    );
                }
                return true;
            }
            setPanelState(adapter, runner, pageType, 'warning', response.comicTitle ?? detection.title, [
                { label: 'Status', value: `Chapter ${detection.episode} was not found on Comick` },
            ]);
            return true;
        }

        if (response?.reason === 'not_authenticated') {
            if (pageType === 'sync') {
                clearPanel();
                if (shouldNotify) {
                    showToast('ComickSync', 'Log in to Comick to sync progress', `${makeDetectionKey(detection)}:not_authenticated`);
                }
                return true;
            }
            setPanelState(adapter, runner, pageType, 'warning', detection.title, [
                { label: 'Status', value: 'Log in to Comick to sync progress' },
            ]);
            return true;
        }

        if (response?.reason === 'sync_error' || response?.error) {
            if (pageType === 'sync') {
                clearPanel();
                if (shouldNotify) {
                    showToast(detection.title, 'Sync failed', `${makeDetectionKey(detection)}:sync_error`);
                }
                return true;
            }
            setPanelState(adapter, runner, pageType, 'error', detection.title, [
                { label: 'Status', value: 'Sync failed' },
            ]);
            return true;
        }

        return false;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;');
    }

    function applyChapterIndicators(runner, response) {
        const readEpisodes = new Set(
            Array.isArray(response?.readEpisodes)
                ? response.readEpisodes
                    .map((episode) => Number(episode))
                    .filter((episode) => !Number.isNaN(episode))
                : []
        );
        const libraryEpisode = Number(response?.libraryEpisode);
        const hasLibraryProgress = !Number.isNaN(libraryEpisode);

        if (!response || (readEpisodes.size === 0 && !hasLibraryProgress)) {
            clearChapterIndicators();
            return;
        }

        let elements = [];
        try {
            elements = runner.evaluateField('list', 'elementsSelector') ?? [];
        } catch {
            elements = [];
        }

        if (!Array.isArray(elements) || elements.length === 0) {
            return;
        }

        ensureStyle();
        clearChapterIndicators();
        for (const element of elements) {
            let episode = null;
            try {
                episode = runner.evaluateFieldWithInput('list', 'elementEp', element, false);
            } catch {
                episode = null;
            }

            const numericEpisode = Number(episode);
            const isRead = !Number.isNaN(numericEpisode)
                && (readEpisodes.has(numericEpisode) || (hasLibraryProgress && numericEpisode <= libraryEpisode));
            if (!isRead) {
                continue;
            }

            element.setAttribute('data-comicksync-read', 'true');
            if (!element.querySelector('.comicksync-read-badge')) {
                const badge = document.createElement('span');
                badge.className = 'comicksync-read-badge';
                badge.textContent = '(read on Comick)';
                element.appendChild(badge);
            }
        }
    }

    async function getRunnerModule() {
        if (!runnerPromise) {
            log('Loading evaluator module');
            runnerPromise = import(chrome.runtime.getURL('chibi/evaluator.js'));
        }
        return runnerPromise;
    }

    async function detectAndSync() {
        const url = window.location.href;
        const requestId = ++activeRequestId;
        log('Detecting page', url);

        function isStale() {
            return requestId !== activeRequestId || url !== window.location.href;
        }

        function clearInFlightIfCurrent(key) {
            if (inFlightDetectionKey === key) {
                inFlightDetectionKey = '';
            }
        }

        chrome.runtime.sendMessage({ type: 'GET_MATCHING_ADAPTER', url }, async (adapterResponse) => {
            if (isStale()) {
                return;
            }

            if (chrome.runtime.lastError || !adapterResponse?.adapter) {
                log('No matching adapter or runtime error', chrome.runtime.lastError?.message ?? null, adapterResponse);
                clearPanel();
                clearChapterIndicators();
                return;
            }

            try {
                const adapter = adapterResponse.adapter;
                const { CompiledPageRunner } = await getRunnerModule();
                if (isStale()) {
                    return;
                }

                const runner = new CompiledPageRunner(adapter, url, document);
                const isSyncPage = Boolean(runner.evaluateField('sync', 'isSyncPage'));
                const isOverviewPage = Boolean(runner.evaluateField('overview', 'isOverviewPage'));
                if (!isSyncPage && !isOverviewPage) {
                    clearPanel();
                    clearChapterIndicators();
                    return;
                }

                const pageType = isSyncPage ? 'sync' : 'overview';

                let title = runner.evaluateField(pageType, 'getTitle');
                const identifier = runner.evaluateField(pageType, 'getIdentifier');
                const overviewUrl = isSyncPage ? runner.evaluateField('sync', 'getOverviewUrl') : url;
                const nextEpUrl = isSyncPage ? runner.evaluateField('sync', 'nextEpUrl') : null;
                const image = runner.evaluateField(pageType, 'getImage');
                const volume = isSyncPage ? runner.evaluateField('sync', 'getVolume') : null;
                const episode = isSyncPage ? runner.evaluateField('sync', 'getEpisode') : null;

                if (typeof title === 'string') {
                    title = title.trim();
                }

                if (!title) {
                    setPanelState(adapter, runner, pageType, 'error', adapter.name, [
                        { label: 'Status', value: 'Unable to read title from this page' },
                    ]);
                    return;
                }

                if (isPlaceholderTitle(adapter, title)) {
                    clearPanel();
                    return;
                }

                let episodeNumber = null;
                if (isSyncPage) {
                    episodeNumber = typeof episode === 'number' ? episode : Number(episode);
                    if (episode === null || episode === undefined || Number.isNaN(episodeNumber)) {
                        setPanelState(adapter, runner, pageType, 'error', title, [
                            { label: 'Status', value: 'Unable to read chapter number from this page' },
                        ]);
                        return;
                    }
                }

                const detection = {
                    url,
                    pageType,
                    adapterId: adapter.id,
                    adapterName: adapter.name,
                    title,
                    episode: episodeNumber,
                    identifier: identifier ? String(identifier).trim() : null,
                    overviewUrl: overviewUrl ? String(overviewUrl).trim() : null,
                    nextEpUrl: nextEpUrl ? String(nextEpUrl).trim() : null,
                    image: image ? String(image).trim() : null,
                    volume: volume ?? null,
                };
                log('Detection payload', detection);

                const detectionKey = makeDetectionKey(detection);
                if (detectionKey === lastDetectionKey && lastRenderedState?.key === detectionKey) {
                    renderResponseState(adapter, runner, detection, lastRenderedState.response, { notify: false });
                    return;
                }

                if (detectionKey === inFlightDetectionKey) {
                    return;
                }

                const sendDetection = () => {
                    inFlightDetectionKey = detectionKey;
                    const messageType = isSyncPage ? 'SYNC_DETECTION' : 'RESOLVE_SERIES';
                    chrome.runtime.sendMessage({ type: messageType, detection }, (response) => {
                        if (isStale()) {
                            clearInFlightIfCurrent(detectionKey);
                            return;
                        }

                        if (chrome.runtime.lastError) {
                            clearInFlightIfCurrent(detectionKey);
                            log('Background message error', chrome.runtime.lastError.message);
                            return;
                        }

                        if (
                            isSyncPage && response?.synced
                            || !isSyncPage && response?.matched
                            || response?.reason === 'comic_not_found'
                            || response?.reason === 'chapter_not_found'
                            || response?.reason === 'not_authenticated'
                            || response?.reason === 'sync_error'
                            || response?.error
                        ) {
                            lastDetectionKey = detectionKey;
                            lastRenderedState = { key: detectionKey, response };
                            clearInFlightIfCurrent(detectionKey);
                            renderResponseState(adapter, runner, detection, response);
                            return;
                        }

                        clearInFlightIfCurrent(detectionKey);
                    });
                };

                sendDetection();
            } catch (error) {
                log('Detection failed', error);
                inFlightDetectionKey = '';
                setPanelState(adapterResponse.adapter, null, 'overview', 'error', adapterResponse.adapter.name, [
                    { label: 'Status', value: `Detection failed: ${error?.message ?? 'unknown error'}` },
                ]);
            }
        });
    }

    let debounceTimer = null;
    function debouncedDetect() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(detectAndSync, DEBOUNCE_MS);
    }

    const observer = new MutationObserver(() => {
        debouncedDetect();
    });

    observer.observe(document, { subtree: true, childList: true });

    let lastUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            lastDetectionKey = '';
            inFlightDetectionKey = '';
            lastRenderedState = null;
            lastToastKey = '';
            clearPanel();
            clearChapterIndicators();
            clearToast();
            debouncedDetect();
        }
    }, 1000);

    window.addEventListener('load', () => {
        setTimeout(detectAndSync, 800);
    });
})();
