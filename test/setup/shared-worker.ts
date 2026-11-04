// Test files share workers (isolate: false), so anything one file leaves behind is
// there for the next one.
import { beforeAll } from 'vitest'
import pg from 'pg'

// The database pool outlives any one file: a file closing it in afterAll would break
// the next file's queries. Each worker's pool stays open until the worker exits.
pg.Pool.prototype.end = async function () {}

// What files stub by hand or spy on and don't always put back: a fake DOM for canvas
// engines, $fetch, and the entropy under randomFloat (a pinned getRandomValues hands the
// next file a "random" that returns the same thing every time). Recorded once per worker,
// before any file ran, and restored at the start of every file.
const GLOBALS = ['window', 'document', 'Image', 'requestAnimationFrame', 'cancelAnimationFrame', '$fetch', 'fetch', 'createError'] as const
const worker = globalThis as typeof globalThis & { __pristine?: { globals: [string, PropertyDescriptor | undefined][], getRandomValues: Crypto['getRandomValues'], random: () => number } }
worker.__pristine ??= {
    globals: GLOBALS.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
    getRandomValues: globalThis.crypto.getRandomValues,
    random: Math.random
}
const pristine = worker.__pristine

beforeAll(() => {
    for (const [key, descriptor] of pristine.globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
    }
    globalThis.crypto.getRandomValues = pristine.getRandomValues
    Math.random = pristine.random
})
