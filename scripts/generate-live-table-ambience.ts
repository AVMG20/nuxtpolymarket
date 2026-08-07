// Generates the looping casino-floor murmur bed(s) live-table-sound.ts loops
// under the table — a real seamless loop, not a one-shot, so this is a
// sibling to generate-live-table-sounds.ts rather than a mode of it: it needs
// trimForLoop()'s crossfade instead of trimToOneShot(), and there is no
// per-event "cut" strategy to pick.
//
// The manifest (every variant's prompt and requested duration) lives in
// app/utils/live-table-sounds.ts — the single source of truth for both this
// script and in-game playback. Saves to public/live-table/sound/ambient-murmur/
// as LT_MURMUR_VARIANTS numbered loops (1.wav ..); the script diffs the
// manifest against what's on disk and fills the gaps, so deleting a bad take
// and re-running regenerates just that slot.
//
// Run:  bun run scripts/generate-live-table-ambience.ts [flags]
//   --dry-run   list what would be generated, make no API calls, need no API key
//   --force     regenerate every variant, including ones that already exist on disk
//
// Requires ELEVENLABS_API_KEY in the environment (bun loads .env automatically).

import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LT_MURMUR_MANIFEST, LT_MURMUR_VARIANTS } from '../app/utils/live-table-sounds'
import {
    decodeToWav,
    FATAL_STATUS_CODES,
    generateClip,
    parseWav,
    trimEdges,
    trimForLoop,
    type WavData,
    writeWav
} from './lib/sfx'

// ElevenLabs' sound-generation endpoint caps duration_seconds at 22 — the
// manifest requests 20, but clamp defensively rather than fail a request if a
// future edit pushes it past that.
const MAX_REQUEST_DURATION_S = 22
const DELAY_BETWEEN_CALLS_MS = 500
const MIN_SOURCE_PEAK = 0.5
const MAX_ATTEMPTS = 3
/** Dropped off both ends before the loop crossfade — see trimEdges()'s doc
 *  comment for why the raw clip's edges are the wrong material to loop on. */
const EDGE_GUARD_S = 1.5
/** Long enough to mask the seam in unrhythmic room tone, short enough not to
 *  eat a big chunk of an already-short loop. */
const CROSSFADE_S = 1.0

const OUTPUT_DIR = new URL('../public/live-table/sound/ambient-murmur/', import.meta.url)
const RAW_DIR = join(tmpdir(), 'live-table-ambience-raw')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
    const jobs = Array.from({ length: LT_MURMUR_VARIANTS }, (_, i) => ({
        variant: i + 1,
        spec: LT_MURMUR_MANIFEST[i % LT_MURMUR_MANIFEST.length]!,
        relPath: `${i + 1}.wav`
    }))
    const missing = jobs.filter(job => force || !existsSync(new URL(job.relPath, OUTPUT_DIR)))
    console.log(`Manifest: ${jobs.length} murmur loop(s) (${jobs.length - missing.length} already on disk, ${missing.length} to generate)`)
    if (missing.length === 0) {
        console.log('Nothing to do.')
        return
    }

    if (dryRun) {
        for (const job of missing) console.log(`  [would generate] ambient-murmur/${job.relPath} (${job.spec.duration}s requested, ${CROSSFADE_S}s crossfade)`)
        return
    }

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
        console.error('ELEVENLABS_API_KEY is not set.')
        process.exit(1)
    }

    await mkdir(RAW_DIR, { recursive: true })
    await mkdir(OUTPUT_DIR, { recursive: true })

    for (const [index, job] of missing.entries()) {
        const { variant, spec, relPath } = job
        try {
            console.log(`Generating ambient-murmur/${relPath} (${index + 1}/${missing.length}) ...`)
            const duration = Math.min(MAX_REQUEST_DURATION_S, spec.duration)

            let source: WavData | null = null
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                const raw = await generateClip(apiKey, spec.prompt, duration)
                const decoded = await decodeToWav(raw, join(RAW_DIR, `murmur-${variant}`))
                await writeFile(join(RAW_DIR, `murmur-${variant}.full.wav`), decoded)
                const parsed = parseWav(decoded)

                let peak = 0
                for (const sample of parsed.samples) peak = Math.max(peak, Math.abs(sample))
                if (peak >= MIN_SOURCE_PEAK || attempt === MAX_ATTEMPTS) {
                    if (peak < MIN_SOURCE_PEAK) console.warn(`  weak take kept after ${attempt} attempts (peak ${peak.toFixed(2)})`)
                    source = parsed
                    break
                }
                console.log(`  take ${attempt} peaked at ${peak.toFixed(2)}, asking again`)
                await sleep(DELAY_BETWEEN_CALLS_MS)
            }

            const looped = trimForLoop(trimEdges(source!, EDGE_GUARD_S), CROSSFADE_S)
            await writeFile(new URL(relPath, OUTPUT_DIR), writeWav(looped))
            const seconds = looped.samples.length / looped.channels / looped.sampleRate
            console.log(`  saved ambient-murmur/${relPath} (${seconds.toFixed(2)}s loop)`)
        } catch (error) {
            const status = (error as { status?: number })?.status
            console.error(`  FAILED ambient-murmur/${relPath}: ${(error as Error).message}`)
            if (typeof status === 'number' && FATAL_STATUS_CODES.has(status)) {
                console.error('Fatal API error — stopping the run.')
                process.exit(1)
            }
        }
        if (index < missing.length - 1) await sleep(DELAY_BETWEEN_CALLS_MS)
    }

    console.log(`\nDone. Untrimmed source clips kept in ${RAW_DIR} for hand-picking better takes.`)
}

await main()
