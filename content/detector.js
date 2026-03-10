(() => {
    const DEBOUNCE_MS = 1200;
    const PANEL_ID = 'comicksync-inline-panel';
    const STYLE_ID = 'comicksync-inline-style';
    const TOAST_ID = 'comicksync-toast';
    const FLOAT_ID = 'comicksync-float-btn';
    const DEBUG = false;
    const LOG_PREFIX = '[ComickSync][content]';
    const DEFAULT_TOAST_DURATION_MS = 2600;
    let runnerPromise = null;
    let activeRequestId = 0;
    let lastDetectionKey = '';
    let inFlightDetectionKey = '';
    let lastRenderedState = null;
    let lastToastKey = '';
    let toastTimer = null;
    let floatSettings = null;
    let floatLastDetection = null;
    let floatLastResponse = null;
    let cancelledDetectionKey = '';
    let toastDurationMs = DEFAULT_TOAST_DURATION_MS;

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

            #${PANEL_ID} .comicksync-panel__actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 8px;
            }

            #${PANEL_ID} .comicksync-panel__action,
            #${PANEL_ID} .comicksync-panel__input-btn {
                appearance: none;
                border: 1px solid currentColor;
                background: transparent;
                color: inherit;
                font: inherit;
                font-size: 12px;
                line-height: 1.2;
                padding: 6px 9px;
                cursor: pointer;
            }

            #${PANEL_ID} .comicksync-panel__action:hover,
            #${PANEL_ID} .comicksync-panel__input-btn:hover {
                opacity: 0.86;
            }

            #${PANEL_ID} .comicksync-panel__input {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-wrap: wrap;
                margin-top: 8px;
            }

            #${PANEL_ID} .comicksync-panel__input-field {
                width: 84px;
                border: 1px solid currentColor;
                background: transparent;
                color: inherit;
                font: inherit;
                font-size: 12px;
                line-height: 1.2;
                padding: 6px 8px;
            }

            #${PANEL_ID} .comicksync-panel__hint {
                font-size: 11px;
                opacity: 0.68;
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
                max-width: 280px;
                padding: 7px 10px;
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 4px;
                background: #1b1b1f;
                color: #d5d5d5;
                font: 12px/1.4 "Segoe UI", system-ui, sans-serif;
                opacity: 0;
                transform: translateY(4px);
                transition: opacity 100ms, transform 100ms;
                pointer-events: none;
            }

            #${TOAST_ID}.is-visible {
                opacity: 1;
                transform: translateY(0);
            }

            #${FLOAT_ID} {
                position: fixed;
                bottom: 80px;
                z-index: 2147483646;
                width: 32px;
                height: 32px;
                border-radius: 4px;
                background: #1b1b1f;
                border: 1px solid #333;
                color: #999;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 1px 6px rgba(0,0,0,0.4);
                transition: border-color 0.1s, color 0.1s;
                user-select: none;
            }

            #${FLOAT_ID}.is-right { right: 16px; }
            #${FLOAT_ID}.is-left { left: 16px; }

            #${FLOAT_ID}:hover {
                border-color: #555;
                color: #d5d5d5;
            }

            #${FLOAT_ID}.is-synced {
                border-color: #5a5;
                color: #5a5;
            }

            #${FLOAT_ID}.is-error {
                border-color: #a55;
                color: #a55;
            }

            #${FLOAT_ID} .float-popup {
                display: none;
                position: absolute;
                bottom: 40px;
                background: #1b1b1f;
                border: 1px solid #333;
                border-radius: 4px;
                padding: 8px 10px;
                min-width: 160px;
                max-width: 240px;
                color: #d5d5d5;
                font: 12px/1.4 "Segoe UI", system-ui, sans-serif;
                box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            }

            #${FLOAT_ID}.is-right .float-popup { right: 0; }
            #${FLOAT_ID}.is-left .float-popup { left: 0; }

            #${FLOAT_ID}.is-expanded .float-popup {
                display: block;
            }

            #${FLOAT_ID} .float-popup-title {
                font-weight: 600;
                font-size: 12px;
                color: #fff;
                margin-bottom: 2px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            #${FLOAT_ID} .float-popup-meta {
                color: #888;
                font-size: 11px;
            }

            #${FLOAT_ID} .float-popup-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                margin-top: 8px;
            }

            #${FLOAT_ID} .float-popup-btn,
            #${FLOAT_ID} .float-popup-link {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-height: 26px;
                padding: 0 8px;
                border: 1px solid #555;
                background: transparent;
                color: #d5d5d5;
                text-decoration: none;
                font: 11px/1.2 "Segoe UI", system-ui, sans-serif;
                cursor: pointer;
            }

            #${FLOAT_ID} .float-popup-link {
                text-decoration: none;
            }

            #${FLOAT_ID} .float-popup-link:hover,
            #${FLOAT_ID} .float-popup-btn:hover {
                border-color: #d5d5d5;
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
            <div class="comicksync-panel__actions" hidden></div>
            <div class="comicksync-panel__input" hidden></div>
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

    function dismissDetection(detection) {
        cancelledDetectionKey = makeDetectionKey(detection);
        lastDetectionKey = '';
        lastRenderedState = null;
        clearPanel();
        removeFloatButton();
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
        }, toastDurationMs);
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

    function openUrl(url) {
        if (!url) {
            return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    function getComickUrl(slug) {
        return slug ? `https://comick.dev/comic/${slug}` : '';
    }

    function sendBackgroundMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(response);
            });
        });
    }

    async function performSync(adapter, runner, detection, overrides = {}) {
        const syncDetection = {
            ...detection,
            ...overrides,
            skipConfirmation: true,
        };
        const response = await sendBackgroundMessage({ type: 'SYNC_DETECTION', detection: syncDetection });
        const responseDetection = {
            ...detection,
            ...overrides,
        };
        if (response?.synced) {
            cancelledDetectionKey = '';
        }
        lastDetectionKey = makeDetectionKey(detection);
        lastRenderedState = { key: makeDetectionKey(detection), response };
        renderResponseState(adapter, runner, responseDetection, response);
        return response;
    }

    function getActionDescriptors(detection, response, options = {}) {
        const actions = [];
        const comickUrl = getComickUrl(response?.comicSlug);

        if (response?.reason === 'confirmation_required') {
            actions.push({
                label: 'Sync now',
                onClick: () => performSync(options.adapter, options.runner, detection),
            });
            actions.push({
                label: 'Skip',
                onClick: () => {
                    dismissDetection(detection);
                    showToast(
                        response.comicTitle ?? detection.title,
                        `Skipped syncing Chapter ${detection.episode}`,
                        `${makeDetectionKey(detection)}:sync_cancelled`
                    );
                },
            });
        }

        if (detection?.pageType === 'sync' && !response?.synced && response?.reason !== 'not_authenticated') {
            actions.push({
                label: response?.reason === 'chapter_not_found' ? 'Retry sync' : 'Mark current chapter',
                onClick: () => performSync(options.adapter, options.runner, detection),
            });
        }

        if (response?.reason === 'not_authenticated') {
            actions.push({
                label: 'Sign in to Comick',
                onClick: () => openUrl('https://comick.dev/user/login'),
            });
        }

        if (comickUrl) {
            actions.push({
                label: 'Open on Comick',
                onClick: () => openUrl(comickUrl),
            });
        }

        if (detection?.nextEpUrl) {
            actions.push({
                label: 'Next chapter',
                onClick: () => {
                    window.location.href = detection.nextEpUrl;
                },
            });
        }

        return actions.filter((action, index, array) => {
            return array.findIndex((item) => item.label === action.label) === index;
        });
    }

    function createManualSyncConfig(detection, response, options = {}) {
        if (detection?.pageType !== 'sync' || response?.reason === 'not_authenticated') {
            return null;
        }

        const defaultEpisode = detection?.episode != null ? String(detection.episode) : '';
        return {
            buttonLabel: 'Sync chapter',
            defaultValue: defaultEpisode,
            hint: 'Need to correct the chapter number? Enter it here and sync manually.',
            onSubmit: async (value) => {
                const normalized = String(value ?? '').trim();
                if (!normalized) {
                    return;
                }
                await performSync(options.adapter, options.runner, detection, { episode: normalized });
            },
        };
    }

    function bindPanelInteractions(panel, actions = [], manualSync = null) {
        const actionsElement = panel.querySelector('.comicksync-panel__actions');
        const inputElement = panel.querySelector('.comicksync-panel__input');

        if (actionsElement) {
            if (actions.length === 0) {
                actionsElement.hidden = true;
                actionsElement.innerHTML = '';
            } else {
                actionsElement.hidden = false;
                actionsElement.innerHTML = '';
                actions.forEach((action) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'comicksync-panel__action';
                    button.textContent = action.label;
                    button.addEventListener('click', () => action.onClick());
                    actionsElement.appendChild(button);
                });
            }
        }

        if (inputElement) {
            if (!manualSync) {
                inputElement.hidden = true;
                inputElement.innerHTML = '';
            } else {
                inputElement.hidden = false;
                inputElement.innerHTML = '';

                const field = document.createElement('input');
                field.type = 'text';
                field.inputMode = 'decimal';
                field.value = manualSync.defaultValue ?? '';
                field.className = 'comicksync-panel__input-field';
                field.placeholder = 'Chapter';

                const submit = document.createElement('button');
                submit.type = 'button';
                submit.className = 'comicksync-panel__input-btn';
                submit.textContent = manualSync.buttonLabel;

                const hint = document.createElement('div');
                hint.className = 'comicksync-panel__hint';
                hint.textContent = manualSync.hint;

                const submitHandler = async () => {
                    submit.disabled = true;
                    try {
                        await manualSync.onSubmit(field.value);
                    } finally {
                        submit.disabled = false;
                    }
                };

                submit.addEventListener('click', submitHandler);
                field.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        submitHandler();
                    }
                });

                inputElement.appendChild(field);
                inputElement.appendChild(submit);
                inputElement.appendChild(hint);
            }
        }
    }

    function setPanelState(adapter, runner, pageType, state, title, metaLines, options = {}) {
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

        bindPanelInteractions(panel, options.actions ?? [], options.manualSync ?? null);

        placePanel(panel, adapter, runner, pageType);
    }

    function renderResponseState(adapter, runner, detection, response, options = {}) {
        const pageType = detection.pageType;
        const shouldNotify = options.notify !== false;

        floatLastDetection = detection;
        floatLastResponse = response;
        updateFloatButton(detection, response);

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
            ], {
                actions: getActionDescriptors(detection, response, { adapter, runner }),
            });
            return true;
        }

        if (response?.reason === 'comic_not_found') {
            clearChapterIndicators();
            setPanelState(adapter, runner, pageType, 'warning', detection.title, [
                { label: 'Status', value: 'No matching series found on Comick' },
            ], {
                actions: getActionDescriptors(detection, response, { adapter, runner }),
                manualSync: createManualSyncConfig(detection, response, { adapter, runner }),
            });
            return true;
        }

        if (response?.reason === 'chapter_not_found') {
            if (pageType === 'sync' && shouldNotify) {
                showToast(
                    response.comicTitle ?? detection.title,
                    `Series found, but Chapter ${detection.episode} was not found on Comick`,
                    `${makeDetectionKey(detection)}:chapter_not_found`
                );
            }
            setPanelState(adapter, runner, pageType, 'warning', response.comicTitle ?? detection.title, [
                { label: 'Status', value: `Series found, but Chapter ${detection.episode} was not found on Comick` },
            ], {
                actions: getActionDescriptors(detection, response, { adapter, runner }),
                manualSync: createManualSyncConfig(detection, response, { adapter, runner }),
            });
            return true;
        }

        if (response?.reason === 'not_authenticated') {
            if (pageType === 'sync' && shouldNotify) {
                showToast('ComickSync', 'Log in to Comick to sync progress', `${makeDetectionKey(detection)}:not_authenticated`);
            }
            setPanelState(adapter, runner, pageType, 'warning', detection.title, [
                { label: 'Status', value: 'Log in to Comick to sync progress' },
            ], {
                actions: getActionDescriptors(detection, response, { adapter, runner }),
            });
            return true;
        }

        if (response?.reason === 'sync_cancelled') {
            if (pageType === 'sync' && shouldNotify) {
                showToast(
                    response.comicTitle ?? detection.title,
                    `Skipped syncing Chapter ${detection.episode}`,
                    `${makeDetectionKey(detection)}:sync_cancelled`
                );
            }
            setPanelState(adapter, runner, pageType, 'warning', detection.title, [
                { label: 'Status', value: 'Sync cancelled' },
            ], {
                actions: getActionDescriptors(detection, response, { adapter, runner }),
                manualSync: createManualSyncConfig(detection, response, { adapter, runner }),
            });
            return true;
        }

        if (response?.reason === 'sync_error' || response?.error) {
            if (pageType === 'sync' && shouldNotify) {
                showToast(detection.title, 'Sync failed', `${makeDetectionKey(detection)}:sync_error`);
            }
            setPanelState(adapter, runner, pageType, 'error', detection.title, [
                { label: 'Status', value: 'Sync failed' },
            ], {
                actions: getActionDescriptors(detection, response, { adapter, runner }),
                manualSync: createManualSyncConfig(detection, response, { adapter, runner }),
            });
            return true;
        }

        if (response?.reason === 'confirmation_required') {
            setPanelState(adapter, runner, pageType, 'warning', response.comicTitle ?? detection.title, [
                { label: 'Status', value: 'This looks like a new series. Sync only if you want to start it on Comick.' },
                {
                    label: 'Chapter',
                    value: detection?.episode != null ? `Chapter ${detection.episode}` : 'Unknown',
                },
            ], {
                actions: getActionDescriptors(detection, response, { adapter, runner }),
                manualSync: createManualSyncConfig(detection, response, { adapter, runner }),
            });
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

    // ─── Float Button ───

    function getFloatButton() {
        let btn = document.getElementById(FLOAT_ID);
        if (!btn) {
            btn = document.createElement('div');
            btn.id = FLOAT_ID;
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                </svg>
                <div class="float-popup">
                    <div class="float-popup-title"></div>
                    <div class="float-popup-meta"></div>
                    <div class="float-popup-actions"></div>
                </div>
            `;
            btn.addEventListener('click', (e) => {
                if (e.target.closest('.float-popup-link')) return;
                if (e.target.closest('.float-popup-btn')) return;
                btn.classList.toggle('is-expanded');
            });
            document.documentElement.appendChild(btn);
        }
        return btn;
    }

    function removeFloatButton() {
        document.getElementById(FLOAT_ID)?.remove();
    }

    function updateFloatButton(detection, response) {
        if (!floatSettings?.enabled) {
            removeFloatButton();
            return;
        }

        ensureStyle();
        const btn = getFloatButton();
        const position = floatSettings.position ?? 'right';
        btn.classList.remove('is-right', 'is-left', 'is-synced', 'is-error');
        btn.classList.add(position === 'left' ? 'is-left' : 'is-right');

        const title = response?.comicTitle ?? detection?.title ?? '';
        const popupTitle = btn.querySelector('.float-popup-title');
        const popupMeta = btn.querySelector('.float-popup-meta');
        const popupActions = btn.querySelector('.float-popup-actions');

        if (!detection) {
            removeFloatButton();
            return;
        }

        if (response?.synced) {
            btn.classList.add('is-synced');
            if (popupTitle) popupTitle.textContent = title;
            if (popupMeta) {
                const slug = response.comicSlug;
                const chInfo = response.libraryEpisode != null
                    ? `Ch. ${response.libraryEpisode}${response.libraryLastChapter ? ` / ${response.libraryLastChapter}` : ''}`
                    : `Ch. ${detection.episode} synced`;
                popupMeta.textContent = chInfo;
            }
        } else if (response?.matched) {
            const slug = response.comicSlug;
            const chInfo = response.libraryEpisode != null
                ? `Reading: Ch. ${response.libraryEpisode}${response.libraryLastChapter ? ` / ${response.libraryLastChapter}` : ''}`
                : response.inLibrary ? 'In your library' : 'Not in library';
            if (popupTitle) popupTitle.textContent = title;
            if (popupMeta) popupMeta.textContent = chInfo;
        } else if (response?.reason) {
            btn.classList.add('is-error');
            if (popupTitle) popupTitle.textContent = title || 'Unknown';
            if (popupMeta) popupMeta.textContent = response.reason === 'comic_not_found' ? 'Not found on Comick' :
                response.reason === 'chapter_not_found' ? `Series found, Ch. ${detection.episode} not matched` :
                response.reason === 'not_authenticated' ? 'Not signed in' :
                response.reason === 'sync_cancelled' ? 'Sync cancelled' : 'Sync error';
        } else {
            removeFloatButton();
            return;
        }

        if (popupActions) {
            popupActions.innerHTML = '';
            getActionDescriptors(detection, response, { adapter: null, runner: null }).slice(0, 3).forEach((action) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'float-popup-btn';
                button.textContent = action.label;
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    action.onClick();
                });
                popupActions.appendChild(button);
            });
        }
    }

    function loadFloatSettings() {
        chrome.runtime.sendMessage({ type: 'GET_FLOAT_SETTINGS' }, (response) => {
            if (chrome.runtime.lastError) return;
            floatSettings = response ?? { enabled: true, position: 'right' };
        });
    }

    function loadOverlaySettings() {
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
            if (chrome.runtime.lastError) return;
            const settings = response?.settings ?? {};
            const configuredDuration = Number(settings.toastDuration);
            toastDurationMs = Number.isFinite(configuredDuration) && configuredDuration > 0
                ? configuredDuration
                : DEFAULT_TOAST_DURATION_MS;
        });
    }

    loadFloatSettings();
    loadOverlaySettings();

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
                removeFloatButton();
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
                if (detectionKey === cancelledDetectionKey) {
                    clearPanel();
                    removeFloatButton();
                    return;
                }
                if (detectionKey === lastDetectionKey && lastRenderedState?.key === detectionKey) {
                    renderResponseState(adapter, runner, detection, lastRenderedState.response, { notify: false });
                    return;
                }

                if (detectionKey === inFlightDetectionKey) {
                    return;
                }

                const sendDetection = (detectionPayload = detection) => {
                    inFlightDetectionKey = detectionKey;
                    const messageType = isSyncPage ? 'SYNC_DETECTION' : 'RESOLVE_SERIES';
                    chrome.runtime.sendMessage({ type: messageType, detection: detectionPayload }, (response) => {
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
                            || response?.reason === 'confirmation_required'
                            || response?.reason === 'sync_cancelled'
                            || response?.reason === 'sync_error'
                            || response?.error
                        ) {
                            if (response?.reason === 'confirmation_required' && detectionKey === cancelledDetectionKey) {
                                clearInFlightIfCurrent(detectionKey);
                                clearPanel();
                                removeFloatButton();
                                return;
                            }
                            if (response?.synced) {
                                cancelledDetectionKey = '';
                            }
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
            cancelledDetectionKey = '';
            floatLastDetection = null;
            floatLastResponse = null;
            clearPanel();
            clearChapterIndicators();
            clearToast();
            removeFloatButton();
            debouncedDetect();
        }
    }, 1000);

    window.addEventListener('load', () => {
        setTimeout(detectAndSync, 800);
    });
})();
