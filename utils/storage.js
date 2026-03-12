const StorageKeys = {
    SESSION: 'comick_session',
    USER_INFO: 'comick_user_info',
    COMIC_CACHE: 'comick_comic_cache',
    FOLLOWS_CACHE: 'comick_follows_cache',
    SYNC_QUEUE: 'comick_sync_queue',
    SYNC_HISTORY: 'comick_sync_history',
    SETTINGS: 'comick_settings',
    NOTIFICATION_LOG: 'comick_notification_log',
    UPDATE_CHECK: 'comick_update_check',
};

const DEFAULT_SETTINGS = {
    notifications: true,
    notifyOnSync: true,
    notifyOnError: true,
    floatButton: true,
    floatButtonPosition: 'right',
    confirmBeforeSync: true,
    autoRetryFailed: true,
    retryIntervalMinutes: 30,
    toastDuration: 2600,
    syncLanguages: ['en', 'gb'],
    theme: 'dark',
};

const SETTINGS_MIGRATION_VERSION = 1;
const COMIC_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function get(key) {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
}

async function set(key, value) {
    await chrome.storage.local.set({ [key]: value });
}

async function remove(key) {
    await chrome.storage.local.remove(key);
}

async function getCachedComic(slug) {
    const cache = (await get(StorageKeys.COMIC_CACHE)) ?? {};
    const entry = cache[slug];
    if (!entry) return null;

    if (Date.now() - entry.timestamp > COMIC_CACHE_TTL_MS) {
        delete cache[slug];
        await set(StorageKeys.COMIC_CACHE, cache);
        return null;
    }

    return entry.data;
}

async function setCachedComic(slug, data) {
    const cache = (await get(StorageKeys.COMIC_CACHE)) ?? {};
    cache[slug] = { data, timestamp: Date.now() };
    await set(StorageKeys.COMIC_CACHE, cache);
}

async function getSettings() {
    const stored = (await get(StorageKeys.SETTINGS)) ?? {};
    return { ...DEFAULT_SETTINGS, ...stored };
}

async function migrateSettings() {
    const stored = (await get(StorageKeys.SETTINGS)) ?? {};
    if ((stored.settingsMigrationVersion ?? 0) >= SETTINGS_MIGRATION_VERSION) {
        return { ...DEFAULT_SETTINGS, ...stored };
    }

    const migrated = {
        ...DEFAULT_SETTINGS,
        ...stored,
        confirmBeforeSync: true,
        settingsMigrationVersion: SETTINGS_MIGRATION_VERSION,
    };
    await set(StorageKeys.SETTINGS, migrated);
    return migrated;
}

async function setSetting(key, value) {
    const settings = await getSettings();
    settings[key] = value;
    await set(StorageKeys.SETTINGS, settings);
    return settings;
}

export { StorageKeys, DEFAULT_SETTINGS, get, set, remove, getCachedComic, setCachedComic, getSettings, migrateSettings, setSetting };
