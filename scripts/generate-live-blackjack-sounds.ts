// Generates whatever live blackjack sound effects are missing from
// public/live-blackjack/sound/, via the ElevenLabs text-to-sound-effects API.
//
// The manifest (every event, its prompt, and its trim length) lives in
// app/utils/live-blackjack-sounds.ts — the single source of truth for both this
// script and in-game playback. Each event gets its own folder with
// LB_SOUND_VARIANTS numbered takes (<event>/1.wav ..); the script diffs the
// manifest against what's on disk and fills the gaps, so deleting a bad take
// and re-running regenerates just that slot.
//
// The untrimmed clip is kept in a temp folder (printed at the end) so you can
// listen and hand-pick a different take if the auto-cut grabbed a bad one.
//
// Run:  bun run scripts/generate-live-blackjack-sounds.ts [flags]
//   --dry-run       list what would be generated, make no API calls, need no API key
//   --force         regenerate every clip, including ones that already exist on disk
//   --only=<text>   only events whose name includes <text> (e.g. --only=chip)
//
// Requires ELEVENLABS_API_KEY in the environment (bun loads .env automatically).
// The key needs the `sound_generation` permission — a voice-only key returns
// 401 "missing the permission sound_generation".

import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LB_SOUND_MANIFEST, LB_SOUND_VARIANTS, type LbSoundSpec } from '../app/utils/live-blackjack-sounds'
import {
    decodeToWav,
    FATAL_STATUS_CODES,
    generateClip,
    parseWav,
    trimToOneShot,
    type WavData,
    writeWav
} from './lib/sfx'

/** The API accepts 0.5-30s; ask for a little more than we keep. */
const MIN_DURATION_S = 0.5
const DELAY_BETWEEN_CALLS_MS = 500
/**
 * A take peaking below this is mostly noise floor, and normalizing it just
 * amplifies hiss. Ask again rather than shipping it.
 */
const MIN_SOURCE_PEAK = 0.6
const MAX_ATTEMPTS = 3

const OUTPUT_DIR = new URL('../public/live-blackjack/sound/', import.meta.url)
const RAW_DIR = join(tmpdir(), 'live-blackjack-sfx-raw')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const only = args.find(a => a.startsWith('--only='))?.slice('--only='.length)

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

interface ClipJob {
    event: string
    spec: LbSoundSpec
    variant: number
    /** Path relative to OUTPUT_DIR, e.g. "chip-place/2.wav". */
    relPath: string
}

async function main() {
    let events = Object.entries(LB_SOUND_MANIFEST)
    if (only) events = events.filter(([event]) => event.includes(only))

    const jobs: ClipJob[] = events.flatMap(([event, spec]) =>
        Array.from({ length: LB_SOUND_VARIANTS }, (_, i) => ({
            event,
            spec,
            variant: i + 1,
            relPath: `${event}/${i + 1}.wav`
        }))
    )
    const missing = jobs.filter(job => force || !existsSync(new URL(job.relPath, OUTPUT_DIR)))
    console.log(`Manifest: ${jobs.length} clips across ${events.length} events (${jobs.length - missing.length} already on disk, ${missing.length} to generate)`)
    if (missing.length === 0) {
        console.log('Nothing to do.')
        return
    }

    if (dryRun) {
        for (const job of missing) console.log(`  [would generate] ${job.relPath} (trim ${job.spec.trim}s, ${job.spec.cut ?? 'peak'} cut)`)
        return
    }

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
        console.error('ELEVENLABS_API_KEY is not set.')
        process.exit(1)
    }

    await mkdir(RAW_DIR, { recursive: true })

    for (const [index, job] of missing.entries()) {
        const { event, spec, variant, relPath } = job
        try {
            console.log(`Generating ${relPath} (${index + 1}/${missing.length}) ...`)
            // Ask for a little more audio than we keep so the tail isn't cut
            // off, and a little more again for an energy cut, which needs
            // slack to slide its window through. Not much more: asking for a
            // long clip is what makes the model pad it out with silence.
            const duration = Math.max(MIN_DURATION_S, spec.trim + (spec.cut === 'energy' ? 0.6 : 0.4))

            let source: WavData | null = null
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                const raw = await generateClip(apiKey, spec.prompt, duration)
                const decoded = await decodeToWav(raw, join(RAW_DIR, `${event}-${variant}`))
                await writeFile(join(RAW_DIR, `${event}-${variant}.full.wav`), decoded)
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

            const trimmed = trimToOneShot(source!, spec.trim, spec.cut ?? 'peak')
            await mkdir(new URL(`${event}/`, OUTPUT_DIR), { recursive: true })
            await writeFile(new URL(relPath, OUTPUT_DIR), writeWav(trimmed))
            const seconds = trimmed.samples.length / trimmed.channels / trimmed.sampleRate
            console.log(`  saved ${relPath} (${seconds.toFixed(2)}s)`)
        } catch (error) {
            const status = (error as { status?: number })?.status
            console.error(`  FAILED ${relPath}: ${(error as Error).message}`)
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
