import { browserStorage, createBackend, createMemoryStorage } from './lib/backend.js';

const storage = browserStorage();

/** False when the browser blocks localStorage (progress then lasts only until the tab closes). */
export const storageIsPersistent = Boolean(storage);

export const api = createBackend({ storage: storage ?? createMemoryStorage() });
