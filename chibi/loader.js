import * as logger from '../utils/logger.js';
import { get, set } from '../utils/storage.js';

const CHIBI_REPOSITORIES = [
    'https://chibi.malsync.moe/config',
    'https://chibi.malsync.moe/adult',
];
const PAGE_LIST_CACHE_KEY = 'malsync_page_list';
const PAGES_CACHE_KEY = 'malsync_pages_cache';
const CACHE_DURATION = 24 * 60 * 60 * 1000;

async function fetchJson(url) {
    try {
        const response = await fetch(url);
        if (response.ok) {
            return response.json();
        }
    } catch {
        // Ignore and return null below.
    }

    return null;
}

function mergePageLists(pageLists) {
    const merged = { pages: {} };

    for (const { root, data } of pageLists) {
        const pages = data?.pages ?? {};
        for (const [key, meta] of Object.entries(pages)) {
            merged.pages[key] = {
                ...meta,
                root,
            };
        }
    }

    return merged;
}

async function loadPageList() {
    const cached = await get(PAGE_LIST_CACHE_KEY);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }

    const pageLists = await Promise.all(
        CHIBI_REPOSITORIES.map(async (root) => {
            const data = await fetchJson(`${root}/list.json`);
            return data ? { root, data } : null;
        })
    );

    const availableLists = pageLists.filter(Boolean);
    if (availableLists.length > 0) {
        const data = mergePageLists(availableLists);
        await set(PAGE_LIST_CACHE_KEY, { data, timestamp: Date.now() });
        return data;
    }

    return cached?.data ?? null;
}

async function loadPageDefinition(pageKey, meta = null) {
    const cache = (await get(PAGES_CACHE_KEY)) ?? {};
    const cachedEntry = cache[pageKey];

    if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_DURATION) {
        return cachedEntry.data;
    }

    const root = meta?.root ?? CHIBI_REPOSITORIES[0];
    const versionHash = meta?.version?.hash;
    const urls = versionHash
        ? [`${root}/pages/${pageKey}.json?version=${versionHash}`, `${root}/pages/${pageKey}.json`]
        : [`${root}/pages/${pageKey}.json`];

    let data = null;
    for (const url of urls) {
        data = await fetchJson(url);
        if (data) {
            break;
        }
    }

    if (data) {
        cache[pageKey] = { data, timestamp: Date.now() };
        await set(PAGES_CACHE_KEY, cache);
    }

    return data ?? cachedEntry?.data ?? null;
}

async function loadAllMangaPages() {
    const pageList = await loadPageList();
    if (!pageList) {
        logger.warn('Could not load MalSync page list');
        return [];
    }

    const pages = pageList.pages ?? {};
    const mangaPages = [];

    for (const [key, meta] of Object.entries(pages)) {
        if (meta?.type !== 'manga') {
            continue;
        }
        mangaPages.push({ key, meta });
    }

    logger.info(`Found ${mangaPages.length} manga pages in MalSync index`);

    const definitions = [];
    for (const { key, meta } of mangaPages) {
        const definition = await loadPageDefinition(key, meta);
        if (definition) {
            definitions.push({ key, meta, definition });
        }
    }

    logger.info(`Loaded ${definitions.length} manga page definitions`);
    return definitions;
}

async function clearCache() {
    await set(PAGE_LIST_CACHE_KEY, null);
    await set(PAGES_CACHE_KEY, null);
}

export { loadPageList, loadPageDefinition, loadAllMangaPages, clearCache };
