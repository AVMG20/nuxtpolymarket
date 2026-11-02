/**
 * Runs the Rail Tycoon browser stories (e2e/rail-tycoon/*.e2e.ts) one after another against the
 * server under test (RT_E2E_URL, http://p{n}.localhost:3010 by default; never the main dev server).
 *
 *   bun e2e/rail-tycoon/run.ts [name filter ...]
 *
 * Each story is a module whose default export is an async function taking nothing; it throws to fail.
 */
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const filters = process.argv.slice(2)
const stories = readdirSync(here)
    .filter(name => name.endsWith('.e2e.ts'))
    .filter(name => !filters.length || filters.some(filter => name.includes(filter)))
    .sort()

if (!stories.length) {
    console.error('no e2e/rail-tycoon/*.e2e.ts story matched')
    process.exit(1)
}

let failed = 0
for (const name of stories) {
    const started = Date.now()
    try {
        const story = await import(pathToFileURL(join(here, name)).href) as { default: () => Promise<void> }
        await story.default()
        console.log(`pass  ${name}  ${((Date.now() - started) / 1000).toFixed(1)} s`)
    } catch (error) {
        failed++
        console.error(`FAIL  ${name}  ${((Date.now() - started) / 1000).toFixed(1)} s`)
        console.error(error)
    }
}
process.exit(failed ? 1 : 0)
