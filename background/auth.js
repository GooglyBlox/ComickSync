import { StorageKeys, get, set, remove } from '../utils/storage.js';
import * as logger from '../utils/logger.js';

const COMICK_COOKIE_URL = 'https://comick.dev';
const SESSION_COOKIE_NAME = 'ory_kratos_session';
const WHOAMI_URL = 'https://api.comick.dev/v2.0/sessions/whoami';

async function getSessionCookie() {
    const cookie = await chrome.cookies.get({
        url: COMICK_COOKIE_URL,
        name: SESSION_COOKIE_NAME,
    });
    return cookie?.value ?? null;
}

async function fetchWhoAmI() {
    const response = await fetch(WHOAMI_URL, {
        credentials: 'include',
        headers: {
            'Referer': 'https://comick.dev/',
        },
    });

    if (!response.ok) {
        throw new Error(`whoami failed: ${response.status}`);
    }

    return response.json();
}

async function login() {
    const sessionValue = await getSessionCookie();
    if (!sessionValue) {
        logger.warn('No session cookie found, user needs to log in');
        return null;
    }

    try {
        const whoami = await fetchWhoAmI();
        const userInfo = {
            username: whoami.identity?.traits?.username ?? 'Unknown',
            email: whoami.identity?.traits?.email ?? null,
            userId: whoami.identity?.id ?? null,
            sessionExpiresAt: whoami.expires_at ?? null,
            followedComics: whoami.user_info?.list ?? [],
            chapterCount: whoami.user_info?.chapter_count ?? 0,
            chapterTotal: whoami.user_info?.chapter_total ?? 0,
            followCount: whoami.user_info?.user_comic_follow_count ?? 0,
        };

        await set(StorageKeys.SESSION, sessionValue);
        await set(StorageKeys.USER_INFO, userInfo);
        logger.info('Logged in as', userInfo.username);
        return userInfo;
    } catch (err) {
        logger.error('Login failed:', err);
        return null;
    }
}

async function logout() {
    await remove(StorageKeys.SESSION);
    await remove(StorageKeys.USER_INFO);
    logger.info('Logged out');
}

async function isAuthenticated() {
    const session = await get(StorageKeys.SESSION);
    if (!session) return false;

    const userInfo = await get(StorageKeys.USER_INFO);
    if (!userInfo?.sessionExpiresAt) return false;

    return new Date(userInfo.sessionExpiresAt) > new Date();
}

async function openLoginTab() {
    await chrome.tabs.create({ url: 'https://comick.dev/user/login' });
}

function watchCookieChanges() {
    chrome.cookies.onChanged.addListener(async (changeInfo) => {
        if (changeInfo.cookie.name !== SESSION_COOKIE_NAME) return;
        if (!changeInfo.cookie.domain.includes('comick.dev')) return;

        if (changeInfo.removed) {
            logger.info('Session cookie removed');
            await logout();
        } else {
            logger.info('Session cookie updated, refreshing auth');
            await login();
        }
    });
}

export { login, logout, isAuthenticated, openLoginTab, watchCookieChanges, getSessionCookie };