// Nitro auto-imports these at runtime; vitest doesn't, so server/ modules under
// test would hit a ReferenceError without them.
import fs from 'node:fs'
import { resolve } from 'node:path'
import { createError } from 'h3'

Object.assign(globalThis, { createError })

const envPath = resolve(import.meta.dirname, '../../.env')
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (match && !process.env[match[1]!]) {
            process.env[match[1]!] = match[2]!.trim().replace(/^["']|["']$/g, '')
        }
    }
}
