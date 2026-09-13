if (typeof window === 'undefined' || typeof document === 'undefined') {
    console.warn('[webstir-hmr] Browser runtime not detected; hot updates disabled.');
} else if (typeof EventSource === 'undefined') {
    console.warn('[webstir-hmr] EventSource API unavailable; falling back to full reloads.');
} else {
    const eventSource = getOrCreateEventSource();
    const updateQueue = [];
    let applyingUpdate = false;
    let reloadScheduled = false;

    eventSource.addEventListener('hmr', (event) => {
        if (!event || !event.data) {
            return;
        }

        try {
            const payload = JSON.parse(event.data);
            enqueueHotUpdate(payload);
        } catch (error) {
            console.error('[webstir-hmr] Failed to parse hot update payload.', error);
            requestReload('payload.parse');
        }
    });

    function enqueueHotUpdate(payload) {
        updateQueue.push(payload);
        void processQueue();
    }

    async function processQueue() {
        if (applyingUpdate || reloadScheduled || updateQueue.length === 0) {
            return;
        }

        const payload = updateQueue.shift();
        if (!payload) {
            return;
        }

        applyingUpdate = true;
        const result = await applyHotUpdate(payload).catch((error) => ({
            success: false,
            reason: 'runtime.error',
            error
        }));
        applyingUpdate = false;

        if (!result.success) {
            requestReload(result.reason, result.error, payload, result.details);
            return;
        }

        if (updateQueue.length > 0) {
            await processQueue();
        }
    }

    async function applyHotUpdate(payload) {
        if (!payload || typeof payload !== 'object') {
            return { success: false, reason: 'payload.invalid' };
        }

        if (payload.requiresReload) {
            return { success: false, reason: 'payload.requiresReload' };
        }

        const modules = Array.isArray(payload.modules) ? payload.modules : [];
        const styles = Array.isArray(payload.styles) ? payload.styles : [];
        const cacheBuster = Date.now().toString(36);
        const baseContext = {
            changedFile: payload.changedFile ?? null,
            modules,
            styles,
            cacheBuster,
            timestamp: Date.now()
        };

        if (modules.length === 0 && styles.length === 0) {
            console.info('[webstir-hmr] Received hot update with no changes.');
            return { success: true };
        }

        const moduleResult = await applyModuleChanges(modules, baseContext);
        if (!moduleResult.success) {
            return moduleResult;
        }

        const styleResult = await applyStyleChanges(styles, baseContext);
        if (!styleResult.success) {
            return styleResult;
        }

        const changedFile = baseContext.changedFile ?? 'unknown';
        console.info(`[webstir-hmr] Applied hot update for ${changedFile}.`);

        return { success: true };
    }

    async function applyModuleChanges(modules, baseContext) {
        if (modules.length === 0) {
            return { success: true };
        }

        for (const asset of modules) {
            if (!isValidAsset(asset)) {
                return { success: false, reason: 'module.invalid', details: asset };
            }

            const context = createModuleContext(baseContext, asset);

            if (!(await invokeDispose(asset, context))) {
                return { success: false, reason: 'module.dispose', details: asset };
            }

            const specifier = withCacheBuster(asset.url, baseContext.cacheBuster);
            let moduleExports;
            try {
                moduleExports = await import(specifier);
            } catch (error) {
                console.error(`[webstir-hmr] Failed to import module '${asset.url}'.`, error);
                return { success: false, reason: 'module.import', error, details: asset };
            }

            if (!(await invokeAccept(moduleExports, context))) {
                console.warn(`[webstir-hmr] Accept handler declined update for '${asset.relativePath}'.`);
                return { success: false, reason: 'module.declined', details: asset };
            }
        }

        return { success: true };
    }

    async function applyStyleChanges(styles, baseContext) {
        if (styles.length === 0) {
            return { success: true };
        }

        for (const asset of styles) {
            if (!isValidAsset(asset)) {
                return { success: false, reason: 'style.invalid', details: asset };
            }

            const success = await swapStylesheet(asset, baseContext.cacheBuster);
            if (!success) {
                return { success: false, reason: 'style.swap', details: asset };
            }
        }

        return { success: true };
    }

    function createModuleContext(baseContext, asset) {
        return {
            changedFile: baseContext.changedFile,
            modules: baseContext.modules,
            styles: baseContext.styles,
            cacheBuster: baseContext.cacheBuster,
            timestamp: baseContext.timestamp,
            asset
        };
    }

    // Pages register hot-update handlers through app.ts, which queues them in
    // window.__webstirHotModules. This client drains that queue into a map keyed
    // by normalized module id, so a module that re-registers after each update
    // replaces its earlier handlers instead of piling up behind them. The app
    // bundle carries no HMR machinery into production. Older app entries that
    // still install window.__webstirDispose / __webstirAccept keep working.
    const hotModuleHandlers = new Map();
    const hotModuleExports = new Map();

    async function invokeDispose(asset, context) {
        const legacy = window.__webstirDispose;
        if (typeof legacy === 'function') {
            try {
                const result = legacy(asset, context);
                if (isPromise(result)) {
                    await result;
                }
            } catch (error) {
                console.error(`[webstir-hmr] Dispose handler threw for '${asset.relativePath}'.`, error);
                return false;
            }
        }

        const registration = findHotModule(asset.url ?? asset.relativePath);
        if (!registration || typeof registration.handlers?.dispose !== 'function') {
            return true;
        }

        try {
            const result = registration.handlers.dispose(withPreviousExports(context, asset));
            if (isPromise(result)) {
                await result;
            }
            return true;
        } catch (error) {
            console.error(`[webstir-hmr] Dispose handler threw for '${asset.relativePath}'.`, error);
            return false;
        }
    }

    async function invokeAccept(moduleExports, context) {
        const legacy = window.__webstirAccept;
        if (typeof legacy === 'function') {
            try {
                const result = legacy(moduleExports, context);
                const resolved = isPromise(result) ? await result : result;
                if (resolved === false) {
                    return false;
                }
            } catch (error) {
                console.error('[webstir-hmr] Accept handler threw.', error);
                return false;
            }
        }

        const asset = context.asset;
        const registration = findHotModule(asset?.url ?? asset?.relativePath);
        if (!registration) {
            return true;
        }

        if (typeof registration.handlers?.accept === 'function') {
            try {
                const result = registration.handlers.accept(moduleExports, withPreviousExports(context, asset));
                const resolved = isPromise(result) ? await result : result;
                if (resolved === false) {
                    return false;
                }
            } catch (error) {
                console.error('[webstir-hmr] Accept handler threw.', error);
                return false;
            }
        }

        hotModuleExports.set(normalizePath(asset?.url ?? asset?.relativePath), moduleExports);
        return true;
    }

    function findHotModule(candidate) {
        takeRegistrations();
        const moduleId = normalizePath(candidate);
        return moduleId ? hotModuleHandlers.get(moduleId) ?? null : null;
    }

    function takeRegistrations() {
        const queue = window.__webstirHotModules;
        if (!Array.isArray(queue) || queue.length === 0) {
            return;
        }

        for (const registration of queue.splice(0, queue.length)) {
            const moduleId = normalizePath(registration?.moduleId);
            if (!moduleId) {
                continue;
            }

            if (registration.handlers) {
                hotModuleHandlers.set(moduleId, registration);
            } else {
                hotModuleHandlers.delete(moduleId);
            }
        }
    }

    function withPreviousExports(context, asset) {
        const previousExports = hotModuleExports.get(normalizePath(asset?.url ?? asset?.relativePath));
        return previousExports === undefined ? context : { ...context, previousExports };
    }

    function swapStylesheet(asset, cacheBuster) {
        return new Promise((resolve) => {
            const specifier = withCacheBuster(asset.url, cacheBuster);
            const existingLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
            const target = existingLinks.find((link) => normalizePath(link.href) === normalizePath(asset.url));
            const replacement = document.createElement('link');
            replacement.rel = 'stylesheet';
            replacement.href = specifier;

            replacement.addEventListener('load', () => {
                if (target && target.parentNode) {
                    requestAnimationFrame(() => target.remove());
                }
                resolve(true);
            });

            replacement.addEventListener('error', () => {
                replacement.remove();
                resolve(false);
            });

            if (target && target.parentNode) {
                target.after(replacement);
            } else {
                document.head.appendChild(replacement);
            }
        });
    }

    function requestReload(reason, error, payload, details) {
        if (reloadScheduled) {
            return;
        }

        reloadScheduled = true;

        if (error) {
            console.error('[webstir-hmr] Hot update failed.', error);
        }

        const changedFile = payload?.changedFile ?? 'unknown';
        const fallbackReasons = Array.isArray(payload?.fallbackReasons) && payload.fallbackReasons.length > 0
            ? ` Fallback reasons: ${payload.fallbackReasons.join(', ')}.`
            : '';
        console.warn(
            `[webstir-hmr] Falling back to full reload for ${changedFile}. ` +
            `Reason: ${reason ?? 'unknown'}.${fallbackReasons}`
        );

        setStatus('hmr-fallback', 'Hot update fallback – reloading…');
        notifyFallback(reason, payload, details);
        updateQueue.length = 0;
        setTimeout(() => window.location.reload(), 0);
    }

    function setStatus(status, message) {
        const setter = window.__webstirSetDevStatus;
        if (typeof setter === 'function') {
            try {
                setter(status, message);
            } catch (error) {
                console.debug('[webstir-hmr] Status handler failed.', error);
            }
        }
    }

    function notifyFallback(reason, payload, details) {
        const handler = window.__webstirOnHmrFallback;
        if (typeof handler === 'function') {
            try {
                handler({ reason, payload, details });
            } catch (error) {
                console.debug('[webstir-hmr] Fallback hook threw.', error);
            }
        }
    }

    function readStats(candidate) {
        if (!candidate || typeof candidate !== 'object') {
            return null;
        }

        const hotUpdates = coerceInteger(candidate.hotUpdates);
        const reloadFallbacks = coerceInteger(candidate.reloadFallbacks);

        if (hotUpdates === null || reloadFallbacks === null) {
            return null;
        }

        return {
            hotUpdates,
            reloadFallbacks
        };
    }

    function coerceInteger(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Math.trunc(value);
        }

        if (typeof value === 'string') {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }

        return null;
    }

    function getOrCreateEventSource() {
        if (window.__webstirEventSource instanceof EventSource) {
            return window.__webstirEventSource;
        }

        const source = new EventSource('/sse');
        window.__webstirEventSource = source;
        return source;
    }

    function withCacheBuster(url, cacheBuster) {
        if (typeof url !== 'string' || url.length === 0) {
            return url;
        }

        try {
            const parsed = new URL(url, window.location.origin);
            parsed.searchParams.set('hmr', cacheBuster);
            return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        } catch {
            const separator = url.includes('?') ? '&' : '?';
            return `${url}${separator}hmr=${cacheBuster}`;
        }
    }

    function normalizePath(url) {
        if (typeof url !== 'string') {
            return '';
        }

        try {
            return new URL(url, window.location.origin).pathname;
        } catch {
            const index = url.indexOf('?');
            return index === -1 ? url : url.slice(0, index);
        }
    }

    function isValidAsset(asset) {
        return Boolean(asset && typeof asset.url === 'string' && asset.url.length > 0);
    }

    function isPromise(value) {
        return !!value && typeof value.then === 'function';
    }
 }
