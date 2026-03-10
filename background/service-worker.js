import { login, isAuthenticated, openLoginTab, watchCookieChanges } from './auth.js';
import { searchComic, getComicBySlug, getUserFollows, findChapter, markChapterRead } from './comick-api.js';
import { StorageKeys, get, set, setCachedComic, getSettings, migrateSettings, setSetting } from '../utils/storage.js';
import * as logger from '../utils/logger.js';
import { AdapterRegistry } from '../chibi/registry.js';
import { loadAllMangaPages, clearCache } from '../chibi/loader.js';

const registry = new AdapterRegistry();
const FOLLOWS_CACHE_DURATION = 30 * 1000;

async function initAdapters() {
    const definitions = await loadAllMangaPages();
    registry.registerFromMalSync(definitions);
}

chrome.runtime.onInstalled.addListener(async () => {
    logger.info('Extension installed');
    await Promise.all([login(), initAdapters(), migrateSettings()]);
});

chrome.runtime.onStartup.addListener(async () => {
    await Promise.all([login(), initAdapters(), migrateSettings()]);
});

chrome.alarms.create('refresh-adapters', { periodInMinutes: 1440 });
chrome.alarms.create('retry-sync-queue', { periodInMinutes: 30 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'refresh-adapters') {
        logger.info('Refreshing adapter definitions');
        await clearCache();
        await initAdapters();
    }

    if (alarm.name === 'retry-sync-queue') {
        const settings = await getSettings();
        if (!settings.autoRetryFailed) return;
        logger.info('Auto-retrying failed syncs');
        await retrySyncQueue();
    }
});

watchCookieChanges();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_MATCHING_ADAPTER') {
        getMatchingAdapter(message.url)
            .then((adapter) => sendResponse({ adapter }))
            .catch((err) => {
                logger.error('Get matching adapter error:', err);
                sendResponse({ adapter: null, error: err.message });
            });
        return true;
    }

    if (message.type === 'SYNC_DETECTION') {
        handleDetection(message.detection)
            .then(sendResponse)
            .catch((err) => {
                logger.error('Sync detection error:', err);
                sendResponse({ synced: false, error: err.message });
            });
        return true;
    }

    if (message.type === 'RESOLVE_SERIES') {
        resolveSeries(message.detection)
            .then(sendResponse)
            .catch((err) => {
                logger.error('Resolve series error:', err);
                sendResponse({ matched: false, error: err.message });
            });
        return true;
    }

    if (message.type === 'GET_STATUS') {
        getStatus().then(sendResponse);
        return true;
    }

    if (message.type === 'LOGIN') {
        openLoginTab().then(() => sendResponse({ ok: true }));
        return true;
    }

    if (message.type === 'REFRESH_AUTH') {
        login().then((userInfo) => sendResponse({ ok: !!userInfo, userInfo }));
        return true;
    }

    if (message.type === 'REFRESH_ADAPTERS') {
        clearCache()
            .then(() => initAdapters())
            .then(() => {
                sendResponse({ ok: true, count: registry.adapters.length });
            });
        return true;
    }

    if (message.type === 'GET_ADAPTERS') {
        sendResponse({
            count: registry.adapters.length,
            adapters: registry.adapters.map((adapter) => ({
                id: adapter.id,
                name: adapter.name,
                domain: adapter.domain,
            })),
        });
        return true;
    }

    if (message.type === 'GET_LIBRARY') {
        getLibrary().then(sendResponse);
        return true;
    }

    if (message.type === 'GET_SYNC_HISTORY') {
        getSyncHistory().then((history) => sendResponse({ history }));
        return true;
    }

    if (message.type === 'GET_SETTINGS') {
        getSettings().then((settings) => sendResponse({ settings }));
        return true;
    }

    if (message.type === 'SET_SETTING') {
        setSetting(message.key, message.value)
            .then((settings) => {
                onSettingChanged(message.key, message.value);
                sendResponse({ ok: true, settings });
            });
        return true;
    }

    if (message.type === 'IMPORT_SETTINGS') {
        set(StorageKeys.SETTINGS, message.settings)
            .then(() => sendResponse({ ok: true }));
        return true;
    }

    if (message.type === 'RETRY_SYNC_QUEUE') {
        retrySyncQueue().then(sendResponse);
        return true;
    }

    if (message.type === 'CLEAR_SYNC_QUEUE') {
        set(StorageKeys.SYNC_QUEUE, []).then(() => sendResponse({ ok: true }));
        return true;
    }

    if (message.type === 'CLEAR_CACHES') {
        Promise.all([
            set(StorageKeys.COMIC_CACHE, {}),
            set(StorageKeys.FOLLOWS_CACHE, {}),
            set(StorageKeys.SYNC_HISTORY, {}),
            set(StorageKeys.SYNC_QUEUE, []),
        ]).then(() => sendResponse({ ok: true }));
        return true;
    }

    if (message.type === 'GET_FLOAT_SETTINGS') {
        getSettings().then((settings) => sendResponse({
            enabled: settings.floatButton,
            position: settings.floatButtonPosition,
        }));
        return true;
    }

    return false;
});

async function getMatchingAdapter(url) {
    if (registry.adapters.length === 0) {
        await initAdapters();
    }

    const adapter = registry.findAdapter(url);
    return adapter ?? null;
}

async function handleDetection(detection) {
    const authenticated = await isAuthenticated();
    if (!authenticated) {
        return { synced: false, reason: 'not_authenticated' };
    }

    if (!detection) {
        return { synced: false, reason: 'no_match' };
    }

    logger.info(`Detected: "${detection.title}" Ch.${detection.episode} via ${detection.adapterName}`);

    try {
        const comic = await resolveComic(detection);
        if (!comic) {
            logger.warn('Comic not found on Comick:', detection.title, detection.identifier);
            return { synced: false, reason: 'comic_not_found', ...detection };
        }

        const settings = await getSettings();
        const chapterData = await findChapter(comic.hid, detection.episode, settings.syncLanguages);
        if (!chapterData) {
            logger.warn(`Chapter ${detection.episode} not found for ${comic.title ?? comic.slug}`);
            return {
                synced: false,
                reason: 'chapter_not_found',
                ...detection,
                ...(await buildSeriesStatus(comic)),
            };
        }

        if (await isDuplicateSync(comic, chapterData, detection)) {
            logger.info(`Skipping duplicate sync for "${comic.title ?? comic.slug}" Ch.${detection.episode}`);
            return {
                synced: true,
                skipped: true,
                ...detection,
                ...(await buildSeriesStatus(comic)),
            };
        }

        const seriesStatus = await buildSeriesStatus(comic);
        if (shouldConfirmBeforeSync(settings, detection, seriesStatus)) {
            logger.info(`Confirmation required before syncing "${comic.title ?? comic.slug}" Ch.${detection.episode}`);
            return {
                synced: false,
                reason: 'confirmation_required',
                ...detection,
                ...seriesStatus,
            };
        }

        await markChapterRead(comic.id, chapterData.id);
        await rememberSync(comic, chapterData, detection);
        const userInfo = await get(StorageKeys.USER_INFO);
        // Always invalidate follows cache after sync so the next overview
        // page request fetches fresh data from the Comick API.
        await invalidateFollowsCache(userInfo?.userId ?? null);
        logger.info(`Synced: "${comic.title ?? comic.slug}" Ch.${detection.episode}`);

        if (settings.notifyOnSync) {
            showBrowserNotification(
                comic.title ?? comic.slug,
                `Chapter ${detection.episode} marked as read`,
                `sync-${comic.id}-${chapterData.id}`
            );
        }

        return {
            synced: true,
            ...detection,
            ...(await buildSeriesStatus(comic)),
        };
    } catch (err) {
        logger.error('Sync failed:', err);

        const queue = (await get(StorageKeys.SYNC_QUEUE)) ?? [];
        queue.push({ ...detection, timestamp: Date.now(), error: err.message });
        await chrome.storage.local.set({ [StorageKeys.SYNC_QUEUE]: queue });

        const settings = await getSettings();
        if (settings.notifyOnError) {
            showBrowserNotification(
                'Sync Failed',
                `${detection.title} Ch.${detection.episode}: ${err.message}`,
                `error-${Date.now()}`
            );
        }

        return { synced: false, reason: 'sync_error', ...detection };
    }
}

function shouldConfirmBeforeSync(settings, detection, seriesStatus) {
    if (!settings?.confirmBeforeSync || detection?.skipConfirmation) {
        return false;
    }

    return isStartingNewSeries(seriesStatus);
}

function isStartingNewSeries(seriesStatus) {
    if (!seriesStatus) {
        return false;
    }

    return !seriesStatus.inLibrary
        && seriesStatus.libraryEpisode == null
        && seriesStatus.latestReadEpisode == null
        && (seriesStatus.chaptersRead ?? 0) === 0;
}

async function getStatus() {
    const authenticated = await isAuthenticated();
    const userInfo = await get(StorageKeys.USER_INFO);
    const queue = (await get(StorageKeys.SYNC_QUEUE)) ?? [];
    return {
        authenticated,
        userInfo,
        pendingSyncs: queue.length,
        syncQueue: queue,
        adapterCount: registry.adapters.length,
    };
}

async function resolveSeries(detection) {
    if (!detection) {
        return { matched: false, reason: 'no_match' };
    }

    const comic = await resolveComic(detection);
    if (!comic) {
        return { matched: false, reason: 'comic_not_found', ...detection };
    }

    return {
        matched: true,
        ...detection,
        ...(await buildSeriesStatus(comic)),
    };
}

function normalizeSlug(value) {
    return String(value ?? '')
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .replace(/^comic\//i, '')
        .replace(/^title\//i, '')
        .replace(/^series\//i, '')
        .split('?')[0]
        .split('#')[0]
        .toLowerCase();
}

function normalizeTitleSlug(value) {
    return normalizeSlug(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function slugFromUrl(url) {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const seriesIndex = parts.findIndex((part) => part === 'series' || part === 'comic' || part === 'title');
        if (seriesIndex >= 0 && parts[seriesIndex + 1]) {
            return normalizeSlug(parts[seriesIndex + 1]);
        }
        if (parts[0]) {
            return normalizeSlug(parts[parts.length - 1]);
        }
    } catch {
        return normalizeSlug(url);
    }
    return null;
}

function buildSlugCandidates(detection) {
    const candidates = new Set();
    const add = (value) => {
        const slug = normalizeSlug(value);
        if (slug) candidates.add(slug);
    };

    add(detection.identifier);
    add(slugFromUrl(detection.overviewUrl));
    add(slugFromUrl(detection.url));

    const titleSlug = normalizeTitleSlug(detection.title);
    add(titleSlug);

    return Array.from(candidates);
}

function comicMatchesSlugCandidate(comic, slug) {
    if (!comic || !slug) {
        return false;
    }

    const normalizedCandidate = normalizeSlug(slug);
    const possibleMatches = [
        comic.slug,
        comic.title,
        ...(Array.isArray(comic.md_titles) ? comic.md_titles.map((entry) => entry?.title) : []),
    ]
        .map(normalizeTitleSlug)
        .filter(Boolean);

    return possibleMatches.includes(normalizedCandidate);
}

async function resolveComicBySlug(slug) {
    if (!slug) return null;

    try {
        const comic = await getComicBySlug(slug);
        return comicMatchesSlugCandidate(comic, slug) ? comic : null;
    } catch {
        return null;
    }
}

async function resolveComic(detection) {
    for (const slug of buildSlugCandidates(detection)) {
        const comic = await resolveComicBySlug(slug);
        if (comic) {
            logger.info(`Resolved "${detection.title}" by slug candidate "${slug}"`);
            return comic;
        }
    }

    const comic = await searchComic(detection.title);
    if (comic) {
        for (const slug of buildSlugCandidates(detection).filter((candidate) => comicMatchesSlugCandidate(comic, candidate))) {
            await setCachedComic(slug, comic);
        }
    }
    return comic;
}

async function getSyncHistory() {
    return (await get(StorageKeys.SYNC_HISTORY)) ?? {};
}

async function getCachedFollows(userId) {
    if (!userId) {
        return [];
    }

    const cache = (await get(StorageKeys.FOLLOWS_CACHE)) ?? {};
    const entry = cache[userId];
    if (entry && Date.now() - entry.timestamp < FOLLOWS_CACHE_DURATION) {
        return Array.isArray(entry.data) ? entry.data : [];
    }

    const follows = await getUserFollows(userId);
    cache[userId] = {
        timestamp: Date.now(),
        data: Array.isArray(follows) ? follows : [],
    };
    await set(StorageKeys.FOLLOWS_CACHE, cache);
    return cache[userId].data;
}

async function invalidateFollowsCache(userId) {
    if (!userId) {
        return;
    }

    const cache = (await get(StorageKeys.FOLLOWS_CACHE)) ?? {};
    delete cache[userId];
    await set(StorageKeys.FOLLOWS_CACHE, cache);
}

function toNumericChapter(value) {
    const numeric = Number(value);
    return Number.isNaN(numeric) ? null : numeric;
}

function findFollowEntry(comic, follows) {
    return follows.find((entry) => {
        const followComic = entry?.md_comics;
        if (!followComic) {
            return false;
        }

        return followComic.id === comic.id
            || followComic.hid === comic.hid
            || followComic.slug === comic.slug;
    }) ?? null;
}

async function buildSeriesStatus(comic) {
    const history = await getSyncHistory();
    const readEpisodes = Array.from(
        new Set(
            Object.entries(history)
                .filter(([key]) => key.startsWith(`${comic.id}:`))
                .map(([, value]) => value?.episode)
                .filter((episode) => episode !== null && episode !== undefined)
                .map((episode) => Number(episode))
                .filter((episode) => !Number.isNaN(episode))
        )
    ).sort((a, b) => a - b);

    const userInfo = await get(StorageKeys.USER_INFO);
    const follows = await getCachedFollows(userInfo?.userId ?? null);
    const followEntry = findFollowEntry(comic, follows);
    const libraryEpisode = toNumericChapter(followEntry?.md_chapters?.chap);
    const libraryLastChapter = toNumericChapter(followEntry?.md_comics?.last_chapter);

    const latestReadEpisode = readEpisodes.length > 0 ? readEpisodes[readEpisodes.length - 1] : null;

    // Use whichever is higher: the Comick API's last-read or our local sync history.
    // This prevents showing stale data when the API cache hasn't refreshed yet.
    const effectiveReadEpisode = libraryEpisode != null && latestReadEpisode != null
        ? Math.max(libraryEpisode, latestReadEpisode)
        : latestReadEpisode ?? libraryEpisode;

    return {
        comicTitle: comic.title ?? comic.slug,
        comicSlug: comic.slug ?? null,
        comicId: comic.id ?? null,
        inLibrary: Boolean(followEntry),
        libraryEpisode: effectiveReadEpisode,
        libraryLastChapter,
        chaptersRead: readEpisodes.length,
        latestReadEpisode,
        readEpisodes,
    };
}

async function isDuplicateSync(comic, chapterData, detection) {
    const history = await getSyncHistory();
    const key = `${comic.id}:${chapterData.id}`;
    const previous = history[key];
    if (!previous) {
        return false;
    }

    const oneDay = 24 * 60 * 60 * 1000;
    return Date.now() - previous.timestamp < oneDay
        && previous.episode === detection.episode
        && previous.adapterId === detection.adapterId;
}

async function rememberSync(comic, chapterData, detection) {
    const history = await getSyncHistory();
    const key = `${comic.id}:${chapterData.id}`;
    history[key] = {
        timestamp: Date.now(),
        adapterId: detection.adapterId,
        episode: detection.episode,
        identifier: detection.identifier ?? null,
        comicTitle: comic.title ?? comic.slug ?? null,
    };

    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    for (const [entryKey, value] of Object.entries(history)) {
        if ((value?.timestamp ?? 0) < cutoff) {
            delete history[entryKey];
        }
    }

    await set(StorageKeys.SYNC_HISTORY, history);
}

// ─── Library ───

async function getLibrary() {
    const userInfo = await get(StorageKeys.USER_INFO);
    const userId = userInfo?.userId ?? null;
    if (!userId) return { library: [] };

    try {
        const follows = await getCachedFollows(userId);
        return { library: Array.isArray(follows) ? follows : [] };
    } catch (err) {
        logger.error('Failed to load library:', err);
        return { library: [] };
    }
}

// ─── Sync Queue Retry ───

async function retrySyncQueue() {
    const queue = (await get(StorageKeys.SYNC_QUEUE)) ?? [];
    if (queue.length === 0) return { retried: 0, succeeded: 0, failed: 0 };

    // Clear queue first to prevent handleDetection from re-adding during retry
    await set(StorageKeys.SYNC_QUEUE, []);

    let succeeded = 0;
    let failed = 0;
    const remaining = [];

    for (const item of queue) {
        try {
            const result = await handleDetection(item);
            if (result?.synced) {
                succeeded++;
            } else {
                remaining.push({ ...item, error: result?.reason ?? 'retry_failed', timestamp: Date.now() });
                failed++;
            }
        } catch (err) {
            remaining.push({ ...item, error: err.message, timestamp: Date.now() });
            failed++;
        }
    }

    // Merge any new failures that handleDetection added back with our remaining
    const currentQueue = (await get(StorageKeys.SYNC_QUEUE)) ?? [];
    await set(StorageKeys.SYNC_QUEUE, [...currentQueue, ...remaining]);
    logger.info(`Retry complete: ${succeeded} succeeded, ${failed} failed`);
    return { retried: queue.length, succeeded, failed };
}

// ─── Browser Notifications ───

async function showBrowserNotification(title, message, id) {
    const settings = await getSettings();
    if (!settings.notifications) return;

    try {
        chrome.notifications.create(id ?? `comicksync-${Date.now()}`, {
            type: 'basic',
            title: title ?? 'ComickSync',
            message: message ?? '',
        });
    } catch {
        logger.warn('Failed to show notification');
    }
}

// ─── Settings Change Handler ───

function onSettingChanged(key, value) {
    if (key === 'autoRetryFailed' || key === 'retryIntervalMinutes') {
        getSettings().then((settings) => {
            if (settings.autoRetryFailed) {
                chrome.alarms.create('retry-sync-queue', {
                    periodInMinutes: settings.retryIntervalMinutes ?? 30,
                });
            } else {
                chrome.alarms.clear('retry-sync-queue');
            }
        });
    }
}
