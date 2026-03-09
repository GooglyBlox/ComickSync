class ReturnSignal {
    constructor(value) {
        this.value = value;
    }
}

function isElementLike(value) {
    return value && typeof value === 'object' && value.nodeType === 1;
}

function isDocumentLike(value) {
    return value && typeof value === 'object' && value.nodeType === 9;
}

class CompiledPageRunner {
    constructor(definition, url, doc) {
        this.definition = definition;
        this.url = url;
        this.doc = doc;
        this.memo = new Map();
    }

    evaluateField(section, field) {
        return this.evaluateFieldWithInput(section, field, null, true);
    }

    evaluateFieldWithInput(section, field, input = null, useMemo = false) {
        const cacheKey = `${section}.${field}`;
        if (useMemo && this.memo.has(cacheKey)) {
            return this.memo.get(cacheKey);
        }

        const script = this.definition?.[section]?.[field];
        if (!script) {
            if (useMemo) {
                this.memo.set(cacheKey, null);
            }
            return null;
        }

        const result = this.evaluate(script, input);
        const resolved = result instanceof ReturnSignal ? result.value : result;

        if (useMemo) {
            this.memo.set(cacheKey, resolved);
        }

        return resolved;
    }

    evaluate(script, startState = null) {
        if (!script || !Array.isArray(script)) {
            return null;
        }

        let value = startState;

        for (const instruction of script) {
            if (!Array.isArray(instruction)) {
                value = instruction;
                continue;
            }

            const [fn, ...rawArgs] = instruction;
            const args = rawArgs.map((arg) => this.resolveArg(arg, value));
            value = this.exec(fn, value, args);

            if (value instanceof ReturnSignal) {
                return value;
            }
        }

        return value;
    }

    resolveArg(arg, current) {
        if (Array.isArray(arg) && Array.isArray(arg[0])) {
            const result = this.evaluate(arg, current);
            return result instanceof ReturnSignal ? result.value : result;
        }
        return arg;
    }

    resolveReference(reference, input) {
        const path = String(reference).split('.');

        if (path.length === 2) {
            return this.evaluateFieldWithInput(path[0], path[1], input, false);
        }

        for (const section of ['sync', 'overview', 'list', 'lifecycle']) {
            if (this.definition?.[section]?.[reference] !== undefined) {
                return this.evaluateFieldWithInput(section, reference, input, false);
            }
        }

        let value = this.definition;
        for (const part of path) {
            if (value == null || value[part] === undefined) {
                return null;
            }
            value = value[part];
        }

        if (Array.isArray(value)) {
            const result = this.evaluate(value, input);
            return result instanceof ReturnSignal ? result.value : result;
        }

        return value;
    }

    exec(fn, current, args) {
        switch (fn) {
            case 'url':
                return current == null ? this.url : String(current);
            case 'title':
                return this.doc?.title ?? '';
            case 'string':
            case 'stringFunction':
                return args[0] !== undefined ? String(args[0]) : String(current);
            case 'boolean':
                return args[0] !== undefined ? Boolean(args[0]) : Boolean(current);
            case 'number':
            case 'numberFunction':
                return this.parseNumber(args[0] !== undefined ? args[0] : current);
            case 'array':
            case 'object':
                return args[0];
            case 'type':
                return current;
            case 'urlPart':
                return this.urlPart(current, args[0]);
            case 'urlStrip':
                return String(current ?? '').replace(/[#?].*/, '');
            case 'urlParam':
                return this.urlParam(current, args[0]);
            case 'urlAbsolute':
                return this.urlAbsolute(current, args[0]);
            case 'querySelector':
                try {
                    return this.doc?.querySelector(String(args[0])) ?? null;
                } catch {
                    return null;
                }
            case 'querySelectorAll':
                try {
                    return Array.from(this.doc?.querySelectorAll(String(args[0])) ?? []);
                } catch {
                    return [];
                }
            case 'find':
                return isElementLike(current) ? current.querySelector(String(args[0])) ?? null : null;
            case 'findAll':
                return isElementLike(current) ? Array.from(current.querySelectorAll(String(args[0])) ?? []) : [];
            case 'text':
                if (isElementLike(current) || isDocumentLike(current)) {
                    return current.textContent ?? '';
                }
                return String(current ?? '');
            case 'html':
                return isElementLike(current) ? current.innerHTML ?? '' : '';
            case 'getBaseText':
                return this.getBaseText(current);
            case 'elementValue':
                return isElementLike(current) ? current.value ?? null : null;
            case 'selectedText': {
                if (!isElementLike(current)) {
                    return null;
                }
                const selected = current.selectedOptions?.[0];
                return selected?.text ?? null;
            }
            case 'getAttribute':
                return isElementLike(current) ? current.getAttribute(String(args[0])) : null;
            case 'closest':
                return isElementLike(current) ? current.closest(String(args[0])) ?? null : null;
            case 'parent':
                return isElementLike(current) ? current.parentElement ?? null : null;
            case 'next':
                return isElementLike(current) ? current.nextElementSibling ?? null : null;
            case 'prev':
                return isElementLike(current) ? current.previousElementSibling ?? null : null;
            case 'elementMatches':
                return isElementLike(current) ? current.matches(String(args[0])) : false;
            case 'property':
            case 'get':
                return current && typeof current === 'object' ? current[args[0]] : undefined;
            case 'keys':
                return current && typeof current === 'object' ? Object.keys(current) : [];
            case 'values':
                return current && typeof current === 'object' ? Object.values(current) : [];
            case 'search':
                return this.objectSearch(current, args[0], args[1] ?? 'dfs');
            case 'trim':
                return String(current ?? '').trim();
            case 'split':
                return String(current ?? '').split(String(args[0]));
            case 'join':
                return Array.isArray(current) ? current.join(String(args[0] ?? '')) : String(current ?? '');
            case 'replace':
                return String(current ?? '').replace(args[0], String(args[1] ?? ''));
            case 'replaceAll':
                return String(current ?? '').replaceAll(String(args[0]), String(args[1] ?? ''));
            case 'replaceRegex':
                return String(current ?? '').replace(
                    new RegExp(String(args[0]), String(args[2] ?? 'gi')),
                    String(args[1] ?? '')
                );
            case 'substring':
                return String(current ?? '').substring(Number(args[0]), args[1] != null ? Number(args[1]) : undefined);
            case 'regex': {
                const match = String(current ?? '').match(new RegExp(String(args[0]), String(args[2] ?? 'i')));
                if (!match) {
                    return null;
                }
                const group = args[1] !== undefined ? Number(args[1]) : 0;
                return match[group] ?? null;
            }
            case 'matches':
                return new RegExp(String(args[0]), String(args[1] ?? 'i')).test(String(current ?? ''));
            case 'contains':
            case 'includes':
                return String(current ?? '').includes(String(args[0]), args[1] != null ? Number(args[1]) : undefined);
            case 'concat':
                return String(current ?? '').concat(String(args[0] ?? ''));
            case 'prepend':
                return String(args[0] ?? '') + String(current ?? '');
            case 'toLowerCase':
                return String(current ?? '').toLowerCase();
            case 'toUpperCase':
                return String(current ?? '').toUpperCase();
            case 'normalize':
                return String(current ?? '').normalize(String(args[0] ?? 'NFKC'));
            case 'jsonParse':
                return JSON.parse(String(current ?? ''));
            case 'first':
                return Array.isArray(current) ? current[0] : undefined;
            case 'last':
                return Array.isArray(current) ? current[current.length - 1] : undefined;
            case 'at':
                return Array.isArray(current) || typeof current === 'string' ? current.at(Number(args[0])) : undefined;
            case 'length':
                return current != null && typeof current.length === 'number' ? current.length : 0;
            case 'slice':
                return Array.isArray(current) || typeof current === 'string'
                    ? current.slice(Number(args[0]), args[1] != null ? Number(args[1]) : undefined)
                    : current;
            case 'reverse':
                return Array.isArray(current) ? [...current].reverse() : current;
            case 'arrayIncludes':
                return Array.isArray(current) ? current.includes(args[0]) : false;
            case 'map':
                return Array.isArray(current) ? current.map((item) => this.resolveArg(args[0], item)) : [];
            case 'arrayFind':
                return Array.isArray(current)
                    ? current.find((item) => Boolean(this.resolveArg(args[0], item)))
                    : undefined;
            case 'filter':
                return Array.isArray(current)
                    ? current.filter((item) => Boolean(this.resolveArg(args[0], item)))
                    : [];
            case 'isNil':
                return current === null || current === undefined;
            case 'isEmpty':
                return this.isEmpty(current);
            case 'equals':
                return current === args[0];
            case 'greaterThan':
                return current > args[0];
            case 'greaterThanOrEqual':
                return current >= args[0];
            case 'lessThan':
                return current < args[0];
            case 'lessThanOrEqual':
                return current <= args[0];
            case 'and':
                return args.every((arg) => Boolean(arg));
            case 'or':
                return args.some((arg) => Boolean(arg));
            case 'not':
                return !current;
            case 'coalesce':
                return args.find((arg) => arg !== null && arg !== undefined);
            case 'if':
                return args[0] ? args[1] : args[2];
            case 'ifThen':
                return current ? args[0] : current;
            case 'ifNotReturn':
                return current ? current : new ReturnSignal(args[0] ?? null);
            case 'condition':
                return args[0] ? args[1] : (args[2] ?? null);
            case 'calculate': {
                const number = Number(current);
                const value = Number(args[1]);
                if (Number.isNaN(number) || Number.isNaN(value)) {
                    return null;
                }
                switch (args[0]) {
                    case '+':
                        return number + value;
                    case '-':
                        return number - value;
                    case '*':
                        return number * value;
                    case '/':
                        return value !== 0 ? number / value : null;
                    default:
                        return current;
                }
            }
            case 'this':
                return this.resolveReference(args[0], current);
            case 'return':
                return new ReturnSignal(current);
            case 'addStyle':
            case 'uiBefore':
            case 'uiAfter':
            case 'domReady':
            case 'trigger':
            case 'detectURLChanges':
            case 'detectChanges':
            case 'waitUntilTrue':
            case 'log':
            case 'setVariable':
            case 'getVariable':
            case 'setGlobalVariable':
            case 'getGlobalVariable':
                return current;
            default:
                return current;
        }
    }

    parseNumber(value) {
        const numeric = Number(value);
        return Number.isNaN(numeric) ? null : numeric;
    }

    urlPart(value, index) {
        const parts = String(value ?? '').split('/');
        const part = parts[Number(index)] ?? '';
        return String(part).replace(/[#?].*/, '');
    }

    urlParam(value, name) {
        const results = new RegExp(`[?&]${String(name)}=([^&#]*)`).exec(String(value ?? ''));
        if (results === null) {
            return null;
        }
        return decodeURI(results[1]) || 0;
    }

    urlAbsolute(value, domain) {
        let url = String(value ?? '');
        if (!url.startsWith('http')) {
            const base = domain ?? new URL(this.url).origin;
            if (url.charAt(0) !== '/') {
                url = `/${url}`;
            }
            url = `${base}${url}`;
        }
        return url;
    }

    getBaseText(current) {
        if (!isElementLike(current)) {
            return '';
        }
        return Array.from(current.childNodes)
            .filter((node) => node.nodeType === 3)
            .map((node) => node.textContent ?? '')
            .join('');
    }

    objectSearch(input, key, type = 'dfs') {
        const execute = (data, queue = []) => {
            if (type === 'dfs') {
                if (!data || typeof data !== 'object') return undefined;
                if (Object.prototype.hasOwnProperty.call(data, key)) return data[key];
                return Object.values(data).reduce(
                    (found, value) => (found !== undefined ? found : execute(value)),
                    undefined
                );
            }

            const currentLevel = queue.length === 0 ? [data] : queue;
            const match = currentLevel.find(
                (node) => node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, key)
            );
            if (match) {
                return match[key];
            }

            const nextLevel = currentLevel
                .flatMap((node) => (node && typeof node === 'object' ? Object.values(node) : []))
                .filter((value) => value && typeof value === 'object');

            return nextLevel.length > 0 ? execute(null, nextLevel) : undefined;
        };

        return execute(input);
    }

    isEmpty(value) {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string') return value === '';
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'object') return Object.keys(value).length === 0;
        return false;
    }
}

export { CompiledPageRunner };
