// Generates whatever HackOps RELAY voice lines are missing from
// public/hack/sound/voice/, via ElevenLabs text-to-speech.
//
// The manifest (every line that should exist, its text, and any per-line
// generation params) lives in app/utils/hack-voice-lines.ts — that file is
// the single source of truth for both this script and in-app playback. Add
// or edit a line there; this script just diffs it against what's already on
// disk and fills the gap.
//
// Run:  bun run scripts/generate-hack-voice-lines.ts [flags]
//   --dry-run       list what would be generated, make no API calls, need no API key
//   --force         regenerate every line, including ones that already exist on disk
//   --only=<text>   only lines whose filename includes <text> (e.g. --only=bark-rarity)
//   --voice=<id>    override the ElevenLabs voice id (defaults to RELAY's "relay handler" voice)
//
// Requires ELEVENLABS_API_KEY in the environment (bun loads .env automatically).

import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { buildVoiceManifest } from '../app/utils/hack-voice-lines'

const RELAY_VOICE_ID = 'gewhlNjjqMJxGTbN75pC'
const MODEL_ID = 'eleven_v3'
const OUTPUT_FORMAT = 'mp3_44100_128'
// ElevenLabs v3's three stability presets (Creative/Natural/Robust) map to
// these floats — voice-lines.md calls for Natural by default across the board.
const STABILITY_NATURAL = 0.5
const DELAY_BETWEEN_CALLS_MS = 350

const OUTPUT_DIR = new URL('../public/hack/sound/voice/', import.meta.url)

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const only = args.find(a => a.startsWith('--only='))?.slice('--only='.length)
const voiceId = args.find(a => a.startsWith('--voice='))?.slice('--voice='.length) ?? RELAY_VOICE_ID

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 401/403 = bad or unverified key, 402/429 = out of credits or quota exhausted —
// none of these get better by retrying the next line, so stop the whole run
// instead of burning through the rest of the manifest against the same wall.
const FATAL_STATUS_CODES = new Set([401, 402, 403, 429])
function fatalStatus(err: unknown): number | null {
  const status = (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode
  return typeof status === 'number' && FATAL_STATUS_CODES.has(status) ? status : null
}

async function main() {
  let manifest = buildVoiceManifest()
  if (only) manifest = manifest.filter(spec => spec.file.includes(only))

  const missing = manifest.filter(spec => force || !existsSync(new URL(`${spec.file}.mp3`, OUTPUT_DIR)))
  const skipped = manifest.length - missing.length

  console.log(`Manifest: ${manifest.length} lines (${skipped} already on disk, ${missing.length} to generate)`)

  if (missing.length === 0) {
    console.log('Nothing to do.')
    return
  }

  if (dryRun) {
    for (const spec of missing) console.log(`  [would generate] ${spec.file}.mp3${spec.speed ? ` (speed ${spec.speed})` : ''}`)
    return
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY is not set. Add it to .env, or pass --dry-run to preview without one.')
    process.exit(1)
  }

  const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js')
  const elevenlabs = new ElevenLabsClient({ apiKey })

  await mkdir(OUTPUT_DIR, { recursive: true })

  let generated = 0
  let failed = 0

  for (const spec of missing) {
    const dest = new URL(`${spec.file}.mp3`, OUTPUT_DIR)
    try {
      const audio = await elevenlabs.textToSpeech.convert(voiceId, {
        text: spec.text,
        modelId: MODEL_ID,
        outputFormat: OUTPUT_FORMAT,
        voiceSettings: {
          stability: STABILITY_NATURAL,
          speed: spec.speed
        }
      })
      const buffer = await new Response(audio).arrayBuffer()
      await Bun.write(dest, buffer)
      generated++
      console.log(`  [generated] ${spec.file}.mp3`)
    } catch (err) {
      const status = fatalStatus(err)
      if (status) {
        console.error(`  [STOPPING] ${spec.file}.mp3 — status ${status}, looks like an auth/credits problem: `, err instanceof Error ? err.message : err)
        console.error(`\n${generated} generated before stopping. Fix the API key/billing and re-run — already-generated lines will be skipped.`)
        process.exit(1)
      }
      failed++
      console.error(`  [FAILED] ${spec.file}.mp3 —`, err instanceof Error ? err.message : err)
    }
    await sleep(DELAY_BETWEEN_CALLS_MS)
  }

  console.log(`\nDone. ${generated} generated, ${failed} failed, ${skipped} already on disk.`)
  if (failed > 0) process.exit(1)
}

void main()
