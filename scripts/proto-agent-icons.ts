// THROWAWAY PROTOTYPE — text-free agent sigil icons on a transparent background.
// Companion to proto-agent-art.ts. Generates PNGs with a transparent background
// (so the per-rarity duotone only tints the emblem, leaving the card to show
// through). Delete once the icon set is settled.
//
// Run from the repo root so .env + node_modules resolve:
//   bun run scripts/proto-agent-icons.ts            generate what's missing
//   bun run scripts/proto-agent-icons.ts --dry-run  list prompts, no API calls
//   bun run scripts/proto-agent-icons.ts --force     regenerate everything

import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

// gpt-image-2 has no transparent-background support, so we render each sigil as
// white-on-black line art, then use ImageMagick to copy luminance into the alpha
// channel — black falls away, the white emblem stays. The per-rarity duotone then
// tints only the emblem, leaving the card background to show through.
const MODEL = 'gpt-image-2'
const SIZE = '1024x1024'
const SCRATCH = '/tmp/claude-1000/-home-ramon-Documents-projects-nuxtpolymarket/9c7640a4-9e88-4d96-8968-6534f8c5ac08/scratchpad'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
// Two tiers: the common pool (ghost/operative/specialist share it) and a fancier
// elite pool (elite/phantom only), so higher rarities feel more special.
const elite = args.includes('--elite')
const OUT_DIR = elite ? `${SCRATCH}/agent-icons-elite` : `${SCRATCH}/agent-icons`

const SUFFIX = elite
  ? ', single centered heraldic emblem crest, ornate and intricate, bold high-contrast pure white silhouette with elegant filigree and fine internal linework, symmetrical, premium flat vector sticker style, crisp sharp edges, solid pure black background, no frame, no border, no text, no letters, no words, no numbers, no watermark'
  : ', single centered emblem icon, bold high-contrast pure white silhouette with clean minimal internal linework, flat vector sticker style, crisp sharp edges, solid pure black background, no frame, no border, no text, no letters, no words, no numbers, no watermark'

const ICONS: Record<string, string> = {
  // Batch 1
  'wraith': 'A hooded wraith / reaper head facing forward with hollow glowing eyes and a shadowy cowl',
  'dagger': 'A vertical dagger crossed with a curling wisp of smoke and small angular wings',
  'cipher': 'A skeleton key overlaid on a compact 3x3 grid of abstract cipher glyphs',
  'sigil': 'A hexagonal circuit rune with interlocking geometric lines radiating from a central node',
  'mask': 'A single sly theater drama mask, smooth and angular',
  'fox': 'A stylized cunning fox head built from sharp geometric facets',
  'hammer': 'A heavy warhammer striking down through a cracked shield, shards flying',
  'skull': 'A skull fused with cybernetic plating and circuitry seams',
  // Batch 2
  'viper': 'A coiled cobra viper rearing to strike, sleek and menacing',
  'raven': 'A sharp raven head in profile, angular feathers, single eye',
  'neural': 'A stylized brain rendered as a neural network of nodes and connecting lines',
  'padlock': 'A heavy padlock split open with a jagged crack down the middle',
  'knight': 'A geometric chess knight piece, faceted and bold',
  'crown': 'A jagged angular crown with sharp spikes',
  'bolt': 'A lightning bolt enclosed in a diamond frame, radiating energy',
  'hydra': 'A three-headed serpent hydra, heads fanned out symmetrically'
}

// Fancier crests reserved for elite / phantom agents (--elite).
const ELITE_ICONS: Record<string, string> = {
  'phoenix': 'A rising phoenix with spread wings and trailing flames, ornate',
  'dragon': 'A coiled dragon with detailed scales and spread wings, heraldic',
  'seraph': 'A winged angelic crest with a radiant halo and layered feathered wings',
  'warcrown': 'An ornate spiked crown flanked by outstretched wings, laurel details',
  'kraken': 'A kraken with curling tentacles rising around a central eye, intricate',
  'demon': 'A horned demon skull with ornate filigree and flame accents, symmetrical'
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

// Copy the render's luminance into its alpha channel: white → opaque, black →
// transparent, edges feathered. Writes <id>.png (transparent) next to the source.
async function knockoutBlack(srcPath: string, outPath: string) {
  const proc = Bun.spawn([
    'convert', srcPath,
    '(', '+clone', '-colorspace', 'Gray', ')',
    '-alpha', 'off', '-compose', 'CopyOpacity', '-composite',
    outPath
  ], { stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) throw new Error(`convert failed: ${await new Response(proc.stderr).text()}`)
}

async function main() {
  const entries = Object.entries(elite ? ELITE_ICONS : ICONS)
  const missing = entries.filter(([id]) => force || !existsSync(`${OUT_DIR}/${id}.png`))
  console.log(`${entries.length} icons (${entries.length - missing.length} cached, ${missing.length} to generate)`)

  if (dryRun) {
    for (const [id, p] of missing) console.log(`  [would generate] ${id}.png — ${p.slice(0, 64)}…`)
    return
  }
  if (missing.length === 0) return

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) { console.error('OPENAI_API_KEY not set (run from repo root so .env loads).'); process.exit(1) }

  await mkdir(OUT_DIR, { recursive: true })
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey })

  for (const [id, prompt] of missing) {
    try {
      const res = await openai.images.generate({
        model: MODEL,
        prompt: prompt + SUFFIX,
        size: SIZE,
        quality: 'high',
        output_format: 'png',
        n: 1
      })
      const b64 = res.data?.[0]?.b64_json
      if (!b64) throw new Error('no image data')
      const srcPath = `${OUT_DIR}/${id}-src.png`
      await Bun.write(srcPath, Buffer.from(b64, 'base64'))
      await knockoutBlack(srcPath, `${OUT_DIR}/${id}.png`)
      console.log(`  [generated] ${id}.png`)
    } catch (err) {
      console.error(`  [FAILED] ${id}.png —`, err instanceof Error ? err.message : err)
    }
    await sleep(500)
  }
  console.log(`\nIcons in: ${OUT_DIR}`)
}

void main()
