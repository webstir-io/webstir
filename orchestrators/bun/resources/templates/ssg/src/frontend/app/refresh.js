const existingEventSource = window.__webstirEventSource;
const eventSource = existingEventSource instanceof EventSource
    ? existingEventSource
    : new EventSource('/sse');
window.__webstirEventSource = eventSource;
let isShuttingDown = false;
let resetTimer;
let currentStatus;
const STATUS_STORAGE_KEY = '__webstirDevStatus';
const STATUS_MAX_AGE_MS = 5000;
const POSITION_STORAGE_KEY = '__webstirDevIndicatorPosition';
const EDGE_OFFSET = 8;

const indicator = document.createElement('button');
indicator.type = 'button';
indicator.id = 'dev-server-indicator';
indicator.setAttribute('aria-live', 'polite');
indicator.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 512 512" width="40" height="40" fill="none">
        <path fill="var(--webstir-dev-indicator-color)" stroke="currentColor" stroke-width="21.1286" d="m 249.65652,23.205994 h 12.98856 c 111.69719,0 201.61948,84.744156 201.61948,190.009326 v 85.56936 c 0,105.26517 -89.92229,190.00933 -201.61948,190.00933 h -12.98856 c -111.69719,0 -201.619472,-84.74416 -201.619472,-190.00933 v -85.56936 c 0,-105.26517 89.922282,-190.009326 201.619472,-190.009326 z"></path>
        <path stroke="currentColor" stroke-width="18.2145" d="m 44.058391,191.97153 c -14.470037,0 -26.119524,9.07711 -26.119524,20.35258 v 75.32063 c 0,11.2755 11.649487,20.35261 26.119524,20.35261 0.93247,0 1.852137,-0.0404 2.7588,-0.1141 V 192.08544 c -0.906663,-0.0736 -1.826333,-0.11396 -2.7588,-0.11396 z"></path>
        <path stroke="currentColor" stroke-width="18.2145" d="m 467.94159,307.9973 c 14.47005,0 26.11954,-9.07712 26.11954,-20.35259 v -75.32062 c 0,-11.27551 -11.64949,-20.35261 -26.11954,-20.35261 -0.93248,0 -1.85214,0.0404 -2.75881,0.11409 v 115.79781 c 0.90667,0.0736 1.82635,0.11397 2.75881,0.11397 z"></path>
        <path stroke="currentColor" stroke-width="21.1286" d="m 160.69324,296.77823 a 65.878456,81.300491 0 0 1 -67.611696,-79.07673 65.878456,81.300491 0 0 1 64.054706,-83.46498 65.878456,81.300491 0 0 1 67.65302,79.02287 65.878456,81.300491 0 0 1 -64.01105,83.51598"></path>
        <path stroke="currentColor" stroke-width="21.1286" d="M 114.77974,274.25154 200.01157,154.27256"></path>
        <path stroke="currentColor" stroke-width="21.1286" d="m 354.84541,296.77823 a 65.878456,81.300491 0 0 1 -67.61169,-79.07673 65.878456,81.300491 0 0 1 64.05471,-83.46498 65.878456,81.300491 0 0 1 67.65302,79.02287 65.878456,81.300491 0 0 1 -64.01105,83.51598"></path>
        <path stroke="currentColor" stroke-width="21.1286" d="M 308.93213,274.25154 394.16395,154.27256"></path>
        <path stroke="currentColor" stroke-width="21.1286" stroke-linecap="round" stroke-linejoin="round" d="m 152.65356,346.81827 52.6043,61.04578 49.70484,-57.83284 50.94746,58.23445 52.1901,-60.64414"></path>
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
    --webstir-dev-indicator-color: #64748b;
    border: 0;
    border-radius: 50%;
    background: transparent;
    z-index: 10000;
    filter: drop-shadow(0 3px 8px rgba(0,0,0,0.38));
    cursor: grab;
    opacity: 0;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    transition: opacity 0.3s ease, filter 0.2s ease;
`;

document.body.appendChild(indicator);
restoreIndicatorPosition();

function updateIndicator(background, text, shouldReset = false) {
    indicator.style.opacity = '1';
    indicator.style.setProperty('--webstir-dev-indicator-color', background);
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
    currentStatus = status;
    const handler = statusHandlers[status];
    if (typeof handler === 'function') {
        handler(message);
    }

    if (status === 'connected' || status === 'disconnected') {
        return;
    }

    try {
        sessionStorage.setItem(
            STATUS_STORAGE_KEY,
            JSON.stringify({ status, message, timestamp: Date.now() })
        );
    } catch {
        // ignore
    }
}

window.__webstirSetDevStatus = applyStatus;

try {
    const raw = sessionStorage.getItem(STATUS_STORAGE_KEY);
    if (raw) {
        sessionStorage.removeItem(STATUS_STORAGE_KEY);
        const saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') {
            const age = Date.now() - (saved.timestamp ?? 0);
            if (age >= 0 && age <= STATUS_MAX_AGE_MS && typeof saved.status === 'string') {
                applyStatus(saved.status.trim(), typeof saved.message === 'string' ? saved.message : undefined);
            }
        }
    }
} catch {
    // ignore
}

let loggedConnected = false;
function markConnected() {
    if (!loggedConnected) {
        loggedConnected = true;
        console.log('SSE connection established.');
    }

    if (indicator.style.opacity === '0' || currentStatus === 'disconnected') {
        applyStatus('connected');
    }
}

eventSource.onopen = () => {
    markConnected();
};

if (eventSource.readyState === EventSource.OPEN) {
    markConnected();
}

eventSource.onmessage = (event) => {
    if (event.data === 'reload') {
        applyStatus('success');
        location.reload();
    } else if (event.data === 'shutdown') {
        isShuttingDown = true;
        setDisconnected();
        eventSource.close();
    }
};

eventSource.addEventListener('status', (event) => {
    applyStatus(String(event.data ?? '').trim());
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
