// Generates whatever SHAPEZZ sound effects are missing from
// public/shapezz/sound/, via the ElevenLabs text-to-sound-effects API.
//
// The manifest (every event, its prompt, and its trim length) lives in
// app/utils/shapezz-sounds.ts — the single source of truth for both this
// script and in-game playback. Each event gets its own folder with
// SHAPEZZ_SOUND_VARIANTS numbered takes (<event>/1.wav ..); the script diffs
// the manifest against what's on disk and fills the gaps, so deleting a bad
// take and re-running regenerates just that slot.
//
// Each generated clip is auto-trimmed into a tight one-shot: anchor on the
// loudest transient ('peak') or the first audible sample ('onset'), cut the
// configured length, fade the tail, normalize. The untrimmed clip is kept in
// a temp folder (printed at the end) so you can listen and hand-pick a
// different take if the auto-cut grabbed a bad one.
//
// Run:  bun run scripts/generate-shapezz-sounds.ts [flags]
//   --dry-run       list what would be generated, make no API calls, need no API key
//   --force         regenerate every clip, including ones that already exist on disk
//   --only=<text>   only events whose name includes <text> (e.g. --only=blaster)
//
// Requires ELEVENLABS_API_KEY in the environment (bun loads .env automatically).

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SHAPEZZ_SOUND_MANIFEST, SHAPEZZ_SOUND_VARIANTS, type ShapezzSoundSpec } from '../app/utils/shapezz-sounds'

const ENDPOINT = 'https://api.elevenlabs.io/v1/sound-generation'
/** How strictly the model follows the prompt (0–1); higher = more literal. */
const PROMPT_INFLUENCE = 0.7
/** The API accepts 0.5–30s; ask for a little more than we keep. */
const MIN_DURATION_S = 0.5
const DELAY_BETWEEN_CALLS_MS = 500
/** Seconds kept before the detected transient so the attack isn't clipped. */
const ONSET_BACKOFF_S = 0.015
/** Portion of the kept window used for the fade-out. */
const FADE_OUT_RATIO = 0.3

const OUTPUT_DIR = new URL('../public/shapezz/sound/', import.meta.url)
const RAW_DIR = join(tmpdir(), 'shapezz-sfx-raw')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const only = args.find(a => a.startsWith('--only='))?.slice('--only='.length)

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// 401/403 = bad key, 402/429 = out of credits or rate-limited — none of these
// get better by retrying the next clip, so stop the whole run.
const FATAL_STATUS_CODES = new Set([401, 402, 403, 429])

async function generateClip(apiKey: string, prompt: string, durationSeconds: number): Promise<Uint8Array> {
    const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text: prompt,
            duration_seconds: durationSeconds,
            prompt_influence: PROMPT_INFLUENCE
        })
    })
    if (!response.ok) {
        const detail = await response.text().catch(() => '')
        const error = new Error(`ElevenLabs ${response.status}: ${detail.slice(0, 300)}`)
        ;(error as Error & { status: number }).status = response.status
        throw error
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length === 0) throw new Error('Response contained no audio data')
    return bytes
}

function isRiffWav(bytes: Uint8Array): boolean {
    return bytes.length > 12
        && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 // 'RIFF'
        && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45 // 'WAVE'
}

// The API returns MP3; decode through afconvert (macOS built-in) or ffmpeg
// to PCM WAV for the trim pipeline.
async function decodeToWav(bytes: Uint8Array, workPath: string): Promise<Uint8Array> {
    if (isRiffWav(bytes)) return bytes
    const encodedPath = `${workPath}.encoded`
    const decodedPath = `${workPath}.decoded.wav`
    await writeFile(encodedPath, bytes)
    try {
        execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', encodedPath, decodedPath], { stdio: 'pipe' })
    } catch {
        execFileSync('ffmpeg', ['-y', '-i', encodedPath, decodedPath], { stdio: 'pipe' })
    }
    return await readFile(decodedPath)
}

interface WavData {
    sampleRate: number
    channels: number
    /** Interleaved samples normalized to [-1, 1]. */
    samples: Float32Array
}

function parseWav(bytes: Uint8Array): WavData {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) {
        throw new Error('Not a RIFF/WAVE file')
    }
    let offset = 12
    let format = 0
    let channels = 0
    let sampleRate = 0
    let bitsPerSample = 0
    let samples: Float32Array | null = null
    while (offset + 8 <= view.byteLength) {
        const chunkId = view.getUint32(offset, false)
        const chunkSize = view.getUint32(offset + 4, true)
        const body = offset + 8
        if (chunkId === 0x666d7420) { // 'fmt '
            format = view.getUint16(body, true)
            channels = view.getUint16(body + 2, true)
            sampleRate = view.getUint32(body + 4, true)
            bitsPerSample = view.getUint16(body + 14, true)
        } else if (chunkId === 0x64617461) { // 'data'
            const count = Math.floor(Math.min(chunkSize, view.byteLength - body) / (bitsPerSample / 8))
            samples = new Float32Array(count)
            if (format === 1 && bitsPerSample === 16) {
                for (let i = 0; i < count; i++) samples[i] = view.getInt16(body + i * 2, true) / 32768
            } else if (format === 3 && bitsPerSample === 32) {
                for (let i = 0; i < count; i++) samples[i] = view.getFloat32(body + i * 4, true)
            } else {
                throw new Error(`Unsupported WAV encoding (format ${format}, ${bitsPerSample}-bit)`)
            }
        }
        offset = body + chunkSize + (chunkSize % 2)
    }
    if (!samples || !sampleRate || !channels) throw new Error('WAV missing fmt/data chunks')
    return { sampleRate, channels, samples }
}

function writeWav({ sampleRate, channels, samples }: WavData): Uint8Array {
    const dataSize = samples.length * 2
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)
    const writeAscii = (at: number, text: string) => {
        for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
    }
    writeAscii(0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)
    writeAscii(8, 'WAVE')
    writeAscii(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, channels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * channels * 2, true)
    view.setUint16(32, channels * 2, true)
    view.setUint16(34, 16, true)
    writeAscii(36, 'data')
    view.setUint32(40, dataSize, true)
    for (let i = 0; i < samples.length; i++) {
        const clamped = Math.max(-1, Math.min(1, samples[i]!))
        view.setInt16(44 + i * 2, Math.round(clamped * 32767), true)
    }
    return new Uint8Array(buffer)
}

/** Cut a short one-shot out of a longer clip. */
function trimToOneShot(wav: WavData, keepSeconds: number, cut: 'peak' | 'onset'): WavData {
    const { sampleRate, channels, samples } = wav
    const frameCount = Math.floor(samples.length / channels)

    let peakFrame = 0
    let peakValue = 0
    for (let frame = 0; frame < frameCount; frame++) {
        for (let ch = 0; ch < channels; ch++) {
            const value = Math.abs(samples[frame * channels + ch]!)
            if (value > peakValue) {
                peakValue = value
                peakFrame = frame
            }
        }
    }

    // 'peak' anchors on the loudest transient (percussive one-shots);
    // 'onset' anchors on the first audible sample (chimes and swells whose
    // loudest moment lands mid-phrase) and just strips leading silence.
    let anchorFrame = peakFrame
    if (cut === 'onset') {
        const threshold = Math.max(0.02, peakValue * 0.1)
        anchorFrame = 0
        for (let frame = 0; frame < frameCount; frame++) {
            let loud = false
            for (let ch = 0; ch < channels; ch++) {
                if (Math.abs(samples[frame * channels + ch]!) >= threshold) {
                    loud = true
                    break
                }
            }
            if (loud) {
                anchorFrame = frame
                break
            }
        }
    }

    const startFrame = Math.max(0, anchorFrame - Math.floor(ONSET_BACKOFF_S * sampleRate))
    const keepFrames = Math.min(frameCount - startFrame, Math.floor(keepSeconds * sampleRate))
    const out = new Float32Array(keepFrames * channels)
    out.set(samples.subarray(startFrame * channels, (startFrame + keepFrames) * channels))

    // Short fade-in kills the click at the cut point; the fade-out stops the
    // one-shot from ending in an audible chop mid-tail.
    const fadeInFrames = Math.min(keepFrames, Math.floor(0.003 * sampleRate))
    const fadeOutFrames = Math.min(keepFrames, Math.floor(keepFrames * FADE_OUT_RATIO))
    for (let frame = 0; frame < fadeInFrames; frame++) {
        const gain = frame / fadeInFrames
        for (let ch = 0; ch < channels; ch++) out[frame * channels + ch]! *= gain
    }
    for (let frame = 0; frame < fadeOutFrames; frame++) {
        const gain = frame / fadeOutFrames
        const target = keepFrames - 1 - frame
        for (let ch = 0; ch < channels; ch++) out[target * channels + ch]! *= gain
    }

    // Normalize to a consistent -1 dBFS-ish peak so mix levels in
    // shapezz-sounds.ts mean the same thing across clips.
    if (peakValue > 0) {
        const gain = 0.89 / peakValue
        for (let i = 0; i < out.length; i++) out[i]! *= gain
    }

    return { sampleRate, channels, samples: out }
}

interface ClipJob {
    event: string
    spec: ShapezzSoundSpec
    variant: number
    /** Path relative to OUTPUT_DIR, e.g. "shoot-blaster/2.wav". */
    relPath: string
}

async function main() {
    let events = Object.entries(SHAPEZZ_SOUND_MANIFEST)
    if (only) events = events.filter(([event]) => event.includes(only))

    const jobs: ClipJob[] = events.flatMap(([event, spec]) =>
        Array.from({ length: SHAPEZZ_SOUND_VARIANTS }, (_, i) => ({
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
            // Ask for a bit more audio than we keep so the tail isn't cut off.
            const duration = Math.max(MIN_DURATION_S, spec.trim + 0.4)
            const raw = await generateClip(apiKey, spec.prompt, duration)
            const decoded = await decodeToWav(raw, join(RAW_DIR, `${event}-${variant}`))
            await writeFile(join(RAW_DIR, `${event}-${variant}.full.wav`), decoded)
            const trimmed = trimToOneShot(parseWav(decoded), spec.trim, spec.cut ?? 'peak')
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
