import * as logger from "../utils/logger.js";
import { getCachedComic, setCachedComic } from "../utils/storage.js";

const API_BASE = "https://api.comick.dev";
const DEFAULT_LANGS = ["en", "gb", null];
const EXACT_CHAPTER_LIMIT = 300;
const FALLBACK_CHAPTER_LIMIT = 100;
const FALLBACK_PAGE_SCAN_LIMIT = 3;

function buildUniqueLanguageList(languages) {
  return [...new Set([...(languages ?? []), ...DEFAULT_LANGS])];
}

function normalizeComic(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const comic =
    payload.comic && typeof payload.comic === "object"
      ? payload.comic
      : payload;

  return comic?.hid && comic?.id ? comic : null;
}

async function apiFetch(path, options = {}) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Referer: "https://comick.dev/",
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(
      `API ${options.method ?? "GET"} ${path} failed: ${response.status}`,
    );
  }

  return response.json();
}

async function searchComic(title) {
  const cached = await getCachedComic(title.toLowerCase());
  const normalizedCached = normalizeComic(cached);
  if (normalizedCached) {
    return normalizedCached;
  }

  const params = new URLSearchParams({
    q: title,
    type: "comic",
    page: "1",
    limit: "5",
    t: "true",
    tachiyomi: "true",
  });

  const results = await apiFetch(`/v1.0/search/?${params}`);
  const comic = normalizeComic(results[0]);

  if (comic) {
    await setCachedComic(title.toLowerCase(), comic);
    return comic;
  }

  return null;
}

async function getComicBySlug(slug) {
  const cached = await getCachedComic(slug);
  const normalizedCached = normalizeComic(cached);
  if (normalizedCached) {
    return normalizedCached;
  }

  const params = new URLSearchParams({
    tachiyomi: "true",
  });
  const response = await apiFetch(`/comic/${slug}/?${params}`);
  const comic = normalizeComic(response);
  if (comic) {
    await setCachedComic(slug, comic);
  }
  return comic;
}

async function getChapters(hid, options = {}) {
  const params = new URLSearchParams({
    limit: String(options.limit ?? EXACT_CHAPTER_LIMIT),
    tachiyomi: "true",
  });
  if (options.lang) params.set("lang", options.lang);
  if (options.chap) params.set("chap", String(options.chap));
  if (options.page != null) params.set("page", String(options.page));

  return apiFetch(`/comic/${hid}/chapters?${params}`);
}

async function getUserFollows(userId) {
  if (!userId) {
    return [];
  }

  return apiFetch(`/user/${userId}/follows`);
}

async function getUserFollowComic(comicId) {
  if (!comicId) {
    return null;
  }

  return apiFetch(`/user/follow/comic/${comicId}`);
}

function chapterMatches(chapter, chapterNumber) {
  if (!chapter) return false;

  if (String(chapter.chap) === String(chapterNumber)) {
    return true;
  }

  const numericTarget = Number(chapterNumber);
  const numericValue = Number(chapter.chap);
  if (!Number.isNaN(numericTarget) && !Number.isNaN(numericValue)) {
    return Math.abs(numericValue - numericTarget) < 0.0001;
  }

  return false;
}

function normalizeChapterNumber(value) {
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
}

function rankChapterCandidates(chapters = []) {
  return [...chapters].sort((a, b) => {
    const dateA = new Date(a.publish_at ?? a.created_at ?? 0).getTime();
    const dateB = new Date(b.publish_at ?? b.created_at ?? 0).getTime();
    if (dateA !== dateB) {
      return dateB - dateA;
    }

    const viewsA = Number(a.view_count ?? 0);
    const viewsB = Number(b.view_count ?? 0);
    if (viewsA !== viewsB) {
      return viewsB - viewsA;
    }

    return Number(b.id ?? 0) - Number(a.id ?? 0);
  });
}

async function findChapter(hid, chapterNumber, languages = DEFAULT_LANGS) {
  const tried = new Set();
  const languageCandidates = buildUniqueLanguageList(languages);
  const normalizedChapterNumber = normalizeChapterNumber(chapterNumber);

  for (const lang of languageCandidates) {
    const requestKey = `${lang ?? "any"}:${chapterNumber}`;
    if (tried.has(requestKey)) continue;
    tried.add(requestKey);

    const data = await getChapters(hid, {
      lang: lang ?? undefined,
      chap: chapterNumber,
      limit: EXACT_CHAPTER_LIMIT,
    });

    const chapters = Array.isArray(data?.chapters) ? data.chapters : [];
    const matches = rankChapterCandidates(
      chapters.filter((chapter) => chapterMatches(chapter, chapterNumber)),
    );
    if (matches.length > 0) {
      return matches[0];
    }
  }

  // Some chapters are not returned by the exact `chap` filter even though they
  // exist in the paginated chapter list, so scan the first few pages as a fallback.
  for (const lang of languageCandidates) {
    for (let page = 1; page <= FALLBACK_PAGE_SCAN_LIMIT; page++) {
      const requestKey = `${lang ?? "any"}:page:${page}`;
      if (tried.has(requestKey)) continue;
      tried.add(requestKey);

      const data = await getChapters(hid, {
        lang: lang ?? undefined,
        limit: FALLBACK_CHAPTER_LIMIT,
        page,
      });

      const chapters = Array.isArray(data?.chapters) ? data.chapters : [];
      const matches = rankChapterCandidates(
        chapters.filter((chapter) => chapterMatches(chapter, chapterNumber)),
      );
      if (matches.length > 0) {
        return matches[0];
      }

      if (normalizedChapterNumber != null && chapters.length > 0) {
        const chapterNumbers = chapters
          .map((chapter) => normalizeChapterNumber(chapter?.chap))
          .filter((value) => value != null);
        const smallestChapter =
          chapterNumbers.length > 0 ? Math.min(...chapterNumbers) : null;
        if (
          smallestChapter != null &&
          smallestChapter < normalizedChapterNumber
        ) {
          break;
        }
      }

      if (chapters.length < FALLBACK_CHAPTER_LIMIT) {
        break;
      }
    }
  }

  return null;
}

async function markChapterRead(comicId, chapterId, nextChapterId = null) {
  const body = {
    comicId,
    chapterId,
    create: true,
  };

  if (nextChapterId) {
    body.nextId = nextChapterId;
  }

  logger.info("Marking chapter read:", body);
  return apiFetch("/last_read", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export {
  searchComic,
  getComicBySlug,
  getChapters,
  getUserFollows,
  getUserFollowComic,
  findChapter,
  markChapterRead,
};
