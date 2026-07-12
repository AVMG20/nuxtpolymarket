// Generates whatever HackOps image assets are missing from public/hack/img/,
// via the OpenAI Images API.
//
// The manifest (every image that should exist, its prompt, and its target
// size) lives in app/utils/hack-image-prompts.ts — that file is the single
// source of truth. Add or edit a prompt there; this script just diffs it
// against what's already on disk and fills the gap.
//
// Run:  bun run scripts/generate-hack-images.ts [flags]
//   --dry-run       list what would be generated, make no API calls, need no API key
//   --force         regenerate every image, including ones that already exist on disk
//   --only=<text>   only images whose path includes <text> (e.g. --only=mission)
//   --quality=<q>   low | medium | high (default: high)
//
// Requires OPENAI_API_KEY in the environment (bun loads .env automatically).

import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildImageManifest } from '../app/utils/hack-image-prompts'

const MODEL = 'gpt-image-2'
const OUTPUT_DIR = new URL('../public/hack/img/', import.meta.url)
const DELAY_BETWEEN_CALLS_MS = 500

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const only = args.find(a => a.startsWith('--only='))?.slice('--only='.length)
const quality = (args.find(a => a.startsWith('--quality='))?.slice('--quality='.length) ?? 'high') as 'low' | 'medium' | 'high'

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 401/403 = bad or unverified key, 402/429 = out of credits or quota exhausted —
// none of these get better by retrying the next prompt, so stop the whole run
// instead of burning through the rest of the manifest against the same wall.
const FATAL_STATUS_CODES = new Set([401, 402, 403, 429])
function fatalStatus(err: unknown): number | null {
  const status = (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode
  return typeof status === 'number' && FATAL_STATUS_CODES.has(status) ? status : null
}

async function main() {
  let manifest = buildImageManifest()
  if (only) manifest = manifest.filter(spec => spec.file.includes(only))

  const missing = manifest.filter(spec => force || !existsSync(new URL(`${spec.file}.jpg`, OUTPUT_DIR)))
  const skipped = manifest.length - missing.length

  console.log(`Manifest: ${manifest.length} images (${skipped} already on disk, ${missing.length} to generate)`)

  if (missing.length === 0) {
    console.log('Nothing to do.')
    return
  }

  if (dryRun) {
    for (const spec of missing) console.log(`  [would generate] ${spec.file}.jpg (${spec.size})`)
    return
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('OPENAI_API_KEY is not set. Add it to .env, or pass --dry-run to preview without one.')
    process.exit(1)
  }

  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey })

  let generated = 0
  let failed = 0

  for (const spec of missing) {
    const dest = new URL(`${spec.file}.jpg`, OUTPUT_DIR)
    try {
      const result = await openai.images.generate({
        model: MODEL,
        prompt: spec.prompt,
        size: spec.size,
        quality,
        output_format: 'jpeg',
        n: 1
      })
      const b64 = result.data?.[0]?.b64_json
      if (!b64) throw new Error('No image data in response')
      await mkdir(dirname(dest.pathname), { recursive: true })
      await Bun.write(dest, Buffer.from(b64, 'base64'))
      generated++
      console.log(`  [generated] ${spec.file}.jpg`)
    } catch (err) {
      const status = fatalStatus(err)
      if (status) {
        console.error(`  [STOPPING] ${spec.file}.jpg — status ${status}, looks like an auth/credits problem: `, err instanceof Error ? err.message : err)
        console.error(`\n${generated} generated before stopping. Fix the API key/billing and re-run — already-generated images will be skipped.`)
        process.exit(1)
      }
      failed++
      console.error(`  [FAILED] ${spec.file}.jpg —`, err instanceof Error ? err.message : err)
    }
    await sleep(DELAY_BETWEEN_CALLS_MS)
  }

  console.log(`\nDone. ${generated} generated, ${failed} failed, ${skipped} already on disk.`)
  if (failed > 0) process.exit(1)
}

void main()
