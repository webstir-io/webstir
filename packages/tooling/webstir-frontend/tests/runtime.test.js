import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createAbortController,
    createCleanupScope,
    defineBoundary,
    listen,
    scheduleInterval,
    scheduleTimeout,
    trackObserver
} from '../dist/runtime/index.js';

test('cleanup scope disposes handlers in reverse registration order', async () => {
    const events = [];
    const scope = createCleanupScope();

    scope.add(() => {
        events.push('first');
    });
    scope.add(async () => {
        events.push('second');
    });

    await scope.dispose();

    assert.deepEqual(events, ['second', 'first']);
});

test('cleanup scope disposal is idempotent', async () => {
    let calls = 0;
    const scope = createCleanupScope();

    scope.add(() => {
        calls += 1;
    });

    await scope.dispose();
    await scope.dispose();

    assert.equal(calls, 1);
});

test('boundary mount and unmount reuse the same instance safely', async () => {
    const events = [];
    const boundary = defineBoundary({
        mount(root, scope) {
            events.push('mount');
            const button = createFakeButton();
            const onClick = () => {
                events.push('click');
            };

            button.addEventListener('click', onClick);
            scope.add(() => {
                events.push('cleanup');
                button.removeEventListener('click', onClick);
            });
            root.append(button);
            return { button };
        },
        unmount(state, scope) {
            events.push('unmount');
            scope.add(() => {
                events.push('unmount-cleanup');
            });
            state.button.remove();
        }
    });

    const root = createFakeRoot();

    const first = await boundary.mount(root);
    first.button.dispatchEvent({ type: 'click' });
    assert.deepEqual(events, ['mount', 'click']);

    await boundary.unmount();
    first.button.dispatchEvent({ type: 'click' });
    assert.deepEqual(events, ['mount', 'click', 'unmount', 'unmount-cleanup', 'cleanup']);

    const second = await boundary.mount(root);
    assert.notEqual(second, first);

    await boundary.unmount();
    assert.deepEqual(events, [
        'mount',
        'click',
        'unmount',
        'unmount-cleanup',
        'cleanup',
        'mount',
        'unmount',
        'unmount-cleanup',
        'cleanup'
    ]);
});

test('boundary restores hot state when snapshotState and restoreState are provided', async () => {
    const events = [];
    const boundary = defineBoundary({
        mount() {
            events.push('mount');
            return { label: 'initial' };
        },
        snapshotState(state) {
            events.push(`snapshot:${state.label}`);
            return { label: state.label };
        },
        restoreState(root, scope, hotState) {
            events.push(`restore:${hotState.label}`);
            return { label: hotState.label };
        },
        unmount(state) {
            events.push(`unmount:${state.label}`);
        }
    });

    const root = createFakeRoot();
    const first = await boundary.mount(root);
    first.label = 'persisted';

    await boundary.unmount();

    const second = await boundary.mount(root);

    assert.equal(second.label, 'persisted');
    assert.deepEqual(events, [
        'mount',
        'snapshot:persisted',
        'unmount:persisted',
        'restore:persisted'
    ]);
});

test('boundary remounts with fresh state when no hot state hooks are provided', async () => {
    const boundary = defineBoundary({
        mount() {
            return { label: 'initial' };
        },
        unmount(state) {
            state.label = 'unmounted';
        }
    });

    const root = createFakeRoot();
    const first = await boundary.mount(root);
    first.label = 'persisted';

    await boundary.unmount();

    const second = await boundary.mount(root);

    assert.equal(second.label, 'initial');
    assert.notEqual(second, first);
});

test('managed side-effect helpers dispose listeners, timers, observers, and abort controllers', async () => {
    const events = [];
    const target = createFakeEventTarget();
    const scheduledTimeouts = [];
    const scheduledIntervals = [];
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;

    try {
        globalThis.setTimeout = ((callback, delay, ...args) => {
            const handle = { cleared: false, callback, delay, args };
            scheduledTimeouts.push(handle);
            return handle;
        });
        globalThis.clearTimeout = ((handle) => {
            handle.cleared = true;
        });
        globalThis.setInterval = ((callback, delay, ...args) => {
            const handle = { cleared: false, callback, delay, args };
            scheduledIntervals.push(handle);
            return handle;
        });
        globalThis.clearInterval = ((handle) => {
            handle.cleared = true;
        });

        const boundary = defineBoundary({
            mount(root, scope) {
                const onPing = () => {
                    events.push('ping');
                };

                listen(scope, target, 'ping', onPing);
                scheduleTimeout(scope, () => {
                    events.push('timeout-fired');
                }, 25);
                scheduleInterval(scope, () => {
                    events.push('interval-fired');
                }, 50);
                trackObserver(scope, {
                    disconnect() {
                        events.push('observer-disconnect');
                    }
                });
                scope.add(() => {
                    events.push('scope-cleanup');
                });

                const abortController = createAbortController(scope);
                events.push(`aborted:${abortController.signal.aborted}`);

                root.append(createFakeButton());
                return { abortController };
            }
        });

        const root = createFakeRoot();
        const state = await boundary.mount(root);
        target.dispatchEvent({ type: 'ping' });
        assert.deepEqual(events, ['aborted:false', 'ping']);

        await boundary.unmount();

        target.dispatchEvent({ type: 'ping' });
        assert.equal(target.listenerCount('ping'), 0);
        assert.equal(scheduledTimeouts[0].cleared, true);
        assert.equal(scheduledIntervals[0].cleared, true);
        assert.equal(state.abortController.signal.aborted, true);
        assert.deepEqual(events, ['aborted:false', 'ping', 'scope-cleanup', 'observer-disconnect']);
    } finally {
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    }
});

test('nested boundaries unmount children before parent cleanup', async () => {
    const events = [];

    const childBoundary = defineBoundary({
        mount(root, scope) {
            events.push('child-mount');
            const button = createFakeButton();
            const onClick = () => {
                events.push('child-click');
            };

            button.addEventListener('click', onClick);
            scope.add(() => {
                events.push('child-cleanup');
                button.removeEventListener('click', onClick);
            });
            root.append(button);
            return { button };
        },
        unmount(state, scope) {
            events.push('child-unmount');
            scope.add(() => {
                events.push('child-unmount-cleanup');
            });
            state.button.remove();
        }
    });

    const parentBoundary = defineBoundary({
        async mount(root, scope) {
            events.push('parent-mount');
            const childRoot = createFakeRoot();
            const child = await scope.mountChild(childBoundary, childRoot);

            scope.add(() => {
                events.push('parent-cleanup');
            });

            root.append(childRoot);
            return { child, childRoot };
        },
        unmount(state, scope) {
            events.push('parent-unmount');
            scope.add(() => {
                events.push('parent-unmount-cleanup');
            });
            state.childRoot.remove();
        }
    });

    const root = createFakeRoot();
    const state = await parentBoundary.mount(root);
    assert.equal(state.childRoot.children[0].listenerCount('click'), 1);

    await state.child.unmount();
    await state.child.mount(state.childRoot);

    assert.equal(state.childRoot.children[0].listenerCount('click'), 1);
    await parentBoundary.unmount();

    assert.deepEqual(events, [
        'parent-mount',
        'child-mount',
        'child-unmount',
        'child-unmount-cleanup',
        'child-cleanup',
        'child-mount',
        'child-unmount',
        'child-unmount-cleanup',
        'child-cleanup',
        'parent-unmount',
        'parent-unmount-cleanup',
        'parent-cleanup'
    ]);
});

function createFakeRoot() {
    return {
        parentNode: null,
        children: [],
        append(...nodes) {
            for (const node of nodes) {
                node.parentNode = this;
                this.children.push(node);
            }
        },
        remove() {
            if (!this.parentNode) {
                return;
            }

            this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
            this.parentNode = null;
        }
    };
}

function createFakeButton() {
    const listeners = new Map();

    return {
        listenerCount(type) {
            return listeners.get(type)?.length ?? 0;
        },
        textContent: '',
        parentNode: null,
        addEventListener(type, listener) {
            const list = listeners.get(type) ?? [];
            list.push(listener);
            listeners.set(type, list);
        },
        removeEventListener(type, listener) {
            const list = listeners.get(type);
            if (!list) {
                return;
            }

            listeners.set(type, list.filter((candidate) => candidate !== listener));
        },
        dispatchEvent(event) {
            const list = listeners.get(event.type) ?? [];
            for (const listener of list) {
                listener.call(this, event);
            }
            return true;
        },
        remove() {
            if (this.parentNode) {
                this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
                this.parentNode = null;
            }
            this.removed = true;
        }
    };
}

function createFakeEventTarget() {
    const listeners = new Map();

    return {
        addEventListener(type, listener) {
            const list = listeners.get(type) ?? [];
            list.push(listener);
            listeners.set(type, list);
        },
        removeEventListener(type, listener) {
            const list = listeners.get(type);
            if (!list) {
                return;
            }

            listeners.set(type, list.filter((candidate) => candidate !== listener));
        },
        dispatchEvent(event) {
            const list = listeners.get(event.type) ?? [];
            for (const listener of list) {
                if (typeof listener === 'function') {
                    listener.call(this, event);
                } else {
                    listener.handleEvent?.call(listener, event);
                }
            }
            return true;
        },
        listenerCount(type) {
            return listeners.get(type)?.length ?? 0;
        }
    };
}
