import { CompiledPageRunner } from './evaluator.js';
import * as logger from '../utils/logger.js';

function patternToRegex(pattern) {
    const escaped = String(pattern)
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');

    return new RegExp(`^${escaped}$`);
}

class AdapterRegistry {
    constructor() {
        this.adapters = [];
    }

    registerFromMalSync(definitions) {
        this.adapters = [];

        for (const { key, meta, definition } of definitions) {
            try {
                const adapter = this.buildAdapter(key, meta, definition);
                if (adapter) {
                    this.adapters.push(adapter);
                }
            } catch (error) {
                logger.warn(`Failed to build adapter for ${key}:`, error.message);
            }
        }

        logger.info(`Registry has ${this.adapters.length} active adapters`);
    }

    buildAdapter(key, meta, definition) {
        const matchPatterns = meta?.urls?.match ?? definition?.urls?.match ?? [];
        if (matchPatterns.length === 0) {
            return null;
        }

        return {
            id: key,
            name: definition.name ?? meta?.name ?? key,
            type: definition.type ?? meta?.type ?? 'manga',
            domain: definition.domain ?? meta?.domain ?? '',
            matchPatterns,
            urls: definition.urls ?? meta?.urls ?? null,
            search: definition.search ?? meta?.search ?? null,
            database: definition.database ?? meta?.database ?? null,
            features: definition.features ?? meta?.features ?? null,
            computedType: definition.computedType ?? null,
            sync: definition.sync ?? null,
            overview: definition.overview ?? null,
            list: definition.list ?? null,
            lifecycle: definition.lifecycle ?? null,
            version: definition.version ?? meta?.version ?? null,
        };
    }

    findAdapter(url) {
        for (const adapter of this.adapters) {
            if (this.matchesUrl(adapter, url)) {
                return adapter;
            }
        }
        return null;
    }

    matchesUrl(adapter, url) {
        return adapter.matchPatterns.some((pattern) => {
            try {
                return patternToRegex(pattern).test(url);
            } catch {
                return false;
            }
        });
    }

    getAllMatchPatterns() {
        const patterns = new Set();

        for (const adapter of this.adapters) {
            for (const pattern of adapter.matchPatterns) {
                patterns.add(pattern);
            }
        }

        return Array.from(patterns);
    }

    detect(url, doc) {
        const adapter = this.findAdapter(url);
        if (!adapter || !adapter.sync) {
            return null;
        }

        const runner = new CompiledPageRunner(adapter, url, doc);
        const isSyncPage = runner.evaluateField('sync', 'isSyncPage');
        if (!isSyncPage) {
            return null;
        }

        let title = runner.evaluateField('sync', 'getTitle');
        const episode = runner.evaluateField('sync', 'getEpisode');
        const identifier = runner.evaluateField('sync', 'getIdentifier');
        const overviewUrl = runner.evaluateField('sync', 'getOverviewUrl');
        const nextEpUrl = runner.evaluateField('sync', 'nextEpUrl');
        const image = runner.evaluateField('sync', 'getImage');
        const volume = runner.evaluateField('sync', 'getVolume');

        if (typeof title === 'string') {
            title = title.trim();
        }

        if (!title || episode === null || episode === undefined) {
            return null;
        }

        const episodeNumber = typeof episode === 'number' ? episode : parseFloat(String(episode));
        if (Number.isNaN(episodeNumber)) {
            return null;
        }

        return {
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
    }
}

export { AdapterRegistry };
