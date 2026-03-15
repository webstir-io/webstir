import { createInMemorySessionStore } from '../runtime/session.js';

export const sessionStore = createInMemorySessionStore<Record<string, unknown>>();
