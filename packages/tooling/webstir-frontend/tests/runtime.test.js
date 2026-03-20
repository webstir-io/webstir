import test from 'node:test';
import assert from 'node:assert/strict';

import { createCleanupScope, defineBoundary } from '../dist/runtime/index.js';

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

function createFakeRoot() {
    return {
        children: [],
        append(...nodes) {
            this.children.push(...nodes);
        }
    };
}

function createFakeButton() {
    const listeners = new Map();

    return {
        textContent: '',
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
            this.removed = true;
        }
    };
}
