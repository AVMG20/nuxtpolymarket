// ElevenLabs sound-effects pipeline: generate a clip, decode it to PCM, and
// cut a tight normalized one-shot out of it.
//
// scripts/generate-shapezz-sounds.ts still carries its own copy of this;
// migrating it here is a safe follow-up, not something to do while its audio
// is untouched.

import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const ENDPOINT = 'https://api.elevenlabs.io/v1/sound-generation'
/** How strictly the model follows the prompt (0-1); higher = more literal. */
const PROMPT_INFLUENCE = 0.7
/** Seconds kept before the detected transient so the attack isn't clipped. */
const ONSET_BACKOFF_S = 0.015
/** Portion of the kept window used for the fade-out. */
const FADE_OUT_RATIO = 0.3

// 401/402/403/429 = bad key, missing scope, out of credits or rate-limited —
// none of these get better by retrying the next clip.
export const FATAL_STATUS_CODES = new Set([401, 402, 403, 429])

export interface WavData {
    sampleRate: number
    channels: number
    /** Interleaved samples normalized to [-1, 1]. */
    samples: Float32Array
}

export async function generateClip(apiKey: string, prompt: string, durationSeconds: number): Promise<Uint8Array> {
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

/** The API returns MP3; decode through ffmpeg (or afconvert on macOS) to PCM WAV. */
export async function decodeToWav(bytes: Uint8Array, workPath: string): Promise<Uint8Array> {
    if (isRiffWav(bytes)) return bytes
    const encodedPath = `${workPath}.encoded`
    const decodedPath = `${workPath}.decoded.wav`
    await writeFile(encodedPath, bytes)
    try {
        execFileSync('ffmpeg', ['-y', '-i', encodedPath, decodedPath], { stdio: 'pipe' })
    } catch {
        execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', encodedPath, decodedPath], { stdio: 'pipe' })
    }
    return await readFile(decodedPath)
}

export function parseWav(bytes: Uint8Array): WavData {
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

export function writeWav({ sampleRate, channels, samples }: WavData): Uint8Array {
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

export type CutMode = 'peak' | 'onset' | 'energy'

/** Cut a short one-shot out of a longer clip. */
export function trimToOneShot(wav: WavData, keepSeconds: number, cut: CutMode): WavData {
    const { sampleRate, channels, samples } = wav
    const frameCount = Math.floor(samples.length / channels)
    const wanted = Math.floor(keepSeconds * sampleRate)

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

    // 'peak' anchors on the loudest transient (percussive one-shots); 'onset'
    // anchors on the first audible sample (shuffles and jingles whose loudest
    // moment lands mid-phrase) and just strips leading silence.
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

    // A sustained sound — a riffle shuffle, a chip cascade — has neither a
    // single defining transient nor a clean start; anchoring on either lands
    // the window on a stray tick or the decaying tail. Slide the window over
    // the clip instead and keep the busiest placement.
    if (cut === 'energy') {
        const step = Math.max(1, Math.floor(sampleRate / 100))
        let bestStart = 0
        let bestEnergy = -1
        for (let start = 0; start + wanted <= frameCount; start += step) {
            let energy = 0
            for (let frame = start; frame < start + wanted; frame += step) {
                for (let ch = 0; ch < channels; ch++) {
                    const value = samples[frame * channels + ch]!
                    energy += value * value
                }
            }
            if (energy > bestEnergy) {
                bestEnergy = energy
                bestStart = start
            }
        }
        anchorFrame = bestStart + Math.floor(ONSET_BACKOFF_S * sampleRate)
    }

    let startFrame = Math.max(0, anchorFrame - Math.floor(ONSET_BACKOFF_S * sampleRate))
    // A transient close to the end of the generated clip would otherwise leave
    // only the few frames after it — a one-shot trimmed to near silence. Slide
    // the window back so the full length still fits.
    if (frameCount - startFrame < wanted) startFrame = Math.max(0, frameCount - wanted)
    const keepFrames = Math.min(frameCount - startFrame, wanted)
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

    // Normalize against the peak of what was *kept*, not of the source clip:
    // an onset or energy window need not contain the source's loudest moment,
    // and scaling by that would leave the one-shot quietly mixed for reasons
    // invisible in the output file.
    let keptPeak = 0
    for (const sample of out) keptPeak = Math.max(keptPeak, Math.abs(sample))
    if (keptPeak > 0) {
        const gain = 0.89 / keptPeak
        for (let i = 0; i < out.length; i++) out[i]! *= gain
    }

    return { sampleRate, channels, samples: out }
}
