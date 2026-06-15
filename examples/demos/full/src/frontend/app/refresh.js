const existingEventSource = window.__webstirEventSource;
const eventSource = existingEventSource instanceof EventSource
    ? existingEventSource
    : new EventSource('/sse');
window.__webstirEventSource = eventSource;
let isShuttingDown = false;
let resetTimer;
const POSITION_STORAGE_KEY = '__webstirDevIndicatorPosition';
const EDGE_OFFSET = 8;

const indicator = document.createElement('button');
indicator.type = 'button';
indicator.id = 'dev-server-indicator';
indicator.setAttribute('aria-live', 'polite');
indicator.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 512 512" width="28" height="28" fill="none" stroke="currentColor" stroke-width="30" stroke-linecap="round" stroke-linejoin="round">
        <path d="M152 92h208c55 0 100 45 100 100v128c0 55-45 100-100 100H152c-55 0-100-45-100-100V192c0-55 45-100 100-100Z"></path>
        <path d="M70 215H58c-20 0-36 16-36 36v10c0 20 16 36 36 36h12"></path>
        <path d="M442 215h12c20 0 36 16 36 36v10c0 20-16 36-36 36h-12"></path>
        <path d="M150 178c37 0 66 31 66 70s-29 70-66 70-66-31-66-70 29-70 66-70Z"></path>
        <path d="M114 291 187 205"></path>
        <path d="M362 178c37 0 66 31 66 70s-29 70-66 70-66-31-66-70 29-70 66-70Z"></path>
        <path d="M326 291 399 205"></path>
        <path d="m154 355 52 56 50-53 50 53 52-56"></path>
    </svg>
`;
indicator.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    color: white;
    padding: 0;
    border: 1px solid rgba(255,255,255,0.35);
    border-radius: 50%;
    background: #64748b;
    z-index: 10000;
    box-shadow: 0 4px 14px rgba(0,0,0,0.22);
    cursor: grab;
    opacity: 0;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    transition: opacity 0.3s ease, background 0.2s ease, box-shadow 0.2s ease;
`;

document.body.appendChild(indicator);
restoreIndicatorPosition();

function updateIndicator(background, text, shouldReset = false) {
    indicator.style.opacity = '1';
    indicator.style.background = background;
    indicator.title = text;
    indicator.setAttribute('aria-label', `Webstir dev server: ${text}`);

    if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = undefined;
    }

    if (shouldReset) {
        resetTimer = setTimeout(setConnected, 1500);
    }
}

function setConnected(message) {
    updateIndicator('#2fb344', message ?? 'Connected');
}

function setDisconnected(message) {
    updateIndicator('#e03131', message ?? 'Disconnected');
}

function setBuilding(message) {
    updateIndicator('#f08c00', message ?? 'Rebuilding...');
}

function setBuildSuccess(message) {
    updateIndicator('#2fb344', message ?? 'Rebuild complete', true);
}

function setBuildFailure(message) {
    updateIndicator('#e03131', message ?? 'Build failed');
}

function setHmrFallback(message) {
    updateIndicator('#f76707', message ?? 'Reloading after HMR fallback...');
}

let dragState;

indicator.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
        return;
    }

    const rect = indicator.getBoundingClientRect();
    dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
    };
    indicator.setPointerCapture(event.pointerId);
    indicator.style.cursor = 'grabbing';
    event.preventDefault();
});

indicator.addEventListener('pointermove', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
    }

    setIndicatorPosition(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
    event.preventDefault();
});

indicator.addEventListener('pointerup', finishDrag);
indicator.addEventListener('pointercancel', finishDrag);
window.addEventListener('resize', clampCurrentIndicatorPosition);

function finishDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
    }

    indicator.releasePointerCapture(event.pointerId);
    indicator.style.cursor = 'grab';
    dragState = undefined;
    persistIndicatorPosition();
    event.preventDefault();
}

function setIndicatorPosition(left, top) {
    const rect = indicator.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const maxLeft = Math.max(EDGE_OFFSET, viewportWidth - rect.width - EDGE_OFFSET);
    const maxTop = Math.max(EDGE_OFFSET, viewportHeight - rect.height - EDGE_OFFSET);
    const clampedLeft = Math.min(Math.max(left, EDGE_OFFSET), maxLeft);
    const clampedTop = Math.min(Math.max(top, EDGE_OFFSET), maxTop);

    indicator.style.left = `${clampedLeft}px`;
    indicator.style.top = `${clampedTop}px`;
    indicator.style.right = 'auto';
    indicator.style.bottom = 'auto';
    indicator.dataset.positioned = 'true';
}

function persistIndicatorPosition() {
    if (indicator.dataset.positioned !== 'true') {
        return;
    }

    try {
        const rect = indicator.getBoundingClientRect();
        localStorage.setItem(
            POSITION_STORAGE_KEY,
            JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) })
        );
    } catch {
        // ignore
    }
}

function restoreIndicatorPosition() {
    try {
        const raw = localStorage.getItem(POSITION_STORAGE_KEY);
        if (!raw) {
            return;
        }

        const saved = JSON.parse(raw);
        if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
            setIndicatorPosition(saved.left, saved.top);
        }
    } catch {
        // ignore
    }
}

function clampCurrentIndicatorPosition() {
    if (indicator.dataset.positioned !== 'true') {
        return;
    }

    const rect = indicator.getBoundingClientRect();
    setIndicatorPosition(rect.left, rect.top);
    persistIndicatorPosition();
}

const statusHandlers = {
    connected: setConnected,
    disconnected: setDisconnected,
    building: setBuilding,
    success: setBuildSuccess,
    error: setBuildFailure,
    'hmr-fallback': setHmrFallback
};

function applyStatus(status, message) {
    const handler = statusHandlers[status];
    if (typeof handler === 'function') {
        handler(message);
    }
}

window.__webstirSetDevStatus = applyStatus;

eventSource.onopen = () => {
    console.log('SSE connection established.');
    applyStatus('connected');
};

eventSource.onmessage = (event) => {
    if (event.data === 'reload') {
        location.reload();
    } else if (event.data === 'shutdown') {
        isShuttingDown = true;
        setDisconnected();
        eventSource.close();
    }
};

eventSource.addEventListener('status', (event) => {
    applyStatus(event.data);
});

eventSource.onerror = (error) => {
    if (!isShuttingDown) {
        console.error('SSE error:', error);
        applyStatus('disconnected');
    }
};

window.addEventListener('beforeunload', function () {
    eventSource.close();
});
