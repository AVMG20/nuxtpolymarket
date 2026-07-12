// Single canonical source for every AI-generated HackOps image prompt —
// mission thumbnails, contact/seller portraits, agent class portraits.
// Sourced verbatim from docs/games/hackops-redesign/content/image-prompts.md
// and the "Thumbnail prompt" lines in mission-briefings.md.
//
// scripts/generate-hack-images.ts reads buildImageManifest() below, diffs it
// against public/hack/img/, and generates whatever's missing through the
// OpenAI Images API (gpt-image-2). To add a new image: add a prompt entry
// here, run the script — nothing else to wire up.
//
// Deliberately self-contained (no imports from hack-config/hack-content) so
// it stays a plain standalone module a bun script can import directly.

export interface ImageSpec {
  /** Path under public/hack/img/, without extension. */
  file: string
  prompt: string
  /** WIDTHxHEIGHT — gpt-image-2 accepts arbitrary sizes divisible by 16 (aspect ratio 1:3–3:1). */
  size: string
}

// Appended to every prompt below for a consistent look across the whole set.
export const IMAGE_STYLE_SUFFIX = ', dark tactical-cyberpunk aesthetic, cinematic lighting, high detail, moody color grade, no text, no watermark, no logos'

const LANDSCAPE_16_9 = '1536x864'
const PORTRAIT_SQUARE = '1024x1024'

// ─── Mission thumbnails (mission-briefings.md, one per OpTemplate) ───────────
export const MISSION_THUMBNAILS: Record<string, string> = {
  port_scan: 'Dim office server closet at night, a single blinking router LED, cables in a tangle, cool blue-teal monitor glow reflected on a wall, no people, moody low-key lighting, cyberpunk-adjacent but grounded/mundane, 16:9, cinematic.',
  wifi_crack: 'Interior of a chain coffee shop shot from a corner booth, laptop screen glow on a face kept out of focus/cropped, router visible on a shelf behind the counter blinking, warm shop lighting against cool laptop light, candid photojournalistic style, 16:9.',
  phishing_run: 'Split-composition graphic: a generic corporate email inbox UI with one highlighted urgent-looking message, rendered as a stylized HUD overlay, red flag/alert iconography, dark UI theme, minimal, high-contrast, 16:9.',
  corp_breach: 'Glass-tower corporate lobby at night shot from outside looking in, security desk unattended, badge reader glowing amber near an elevator bank, reflections of city lights on glass, moody thriller lighting, 16:9.',
  bank_skim: 'Abstract visualization of financial wire data as glowing amber/gold particle streams flowing between two dark server-rack silhouettes, data-flow diagram aesthetic, dark background, cinematic depth of field, 16:9.',
  ransomware_drop: 'Hospital IT/server room corridor, fluorescent lights flickering, a wall-mounted monitor showing a red lock icon and scrolling encrypted-file list, sterile clinical color palette broken by red alert glow, tense, 16:9.',
  dark_web: 'Onion-routing network visualization, layered glowing concentric nodes in purple/violet on black, a single highlighted "dead drop" node pulsing, abstract data-art style, 16:9.',
  crypto_heist: 'Stylized glowing wallet/vault icon cracking open with digital coin particles spilling out, countdown-timer HUD overlay, orange/gold crypto-branding-adjacent glow on black, high energy, 16:9.',
  telecom_tap: 'Underground fiber-optic cable duct, technician gloved hands (cropped, faceless) splicing a glowing cable junction, sparks of light traveling down fiber strands, industrial-thriller lighting, teal accent glow, 16:9.',
  supply_chain: 'Abstract dependency-graph network diagram, one node glowing red/infected spreading outward through connected nodes, dark terminal-green background, code-rain texture in the negative space, 16:9.',
  mil_intel: 'Redacted document close-up with black bar censoring, a classified stamp in red, document resting on a dark tactical table beside a laptop\'s glow, shallow depth of field, dossier photography style, 16:9.',
  gov_heist: 'Massive government data-center hall at night, endless rows of server racks with status LEDs, a single security camera glowing red in the foreground, cold institutional lighting, wide symmetrical composition, 16:9.',
  ai_theft: 'Abstract neural network visualization, glowing interconnected nodes forming a brain-like structure, a "download" progress stream siphoning data out of it into darkness, violet/electric-blue palette, high-tech, 16:9.',
  central_bank: 'Grand neoclassical central-bank building exterior at night, illuminated columns, a single lit high-floor window, ominous scale, desaturated cold palette with one warm window glow, 16:9.',
  black_site: 'Unmarked concrete bunker facility entrance in a desert at night, floodlights, chain-link fence, a single unmarked black vehicle parked outside, ominous wide shot, desaturated with cold spotlight highlights, 16:9.',
  nsa_breach: 'Imposing black-glass government intelligence campus at dawn, satellite dishes and antenna arrays on the roofline, fog rolling across a manicured lawn, epic wide establishing shot, cold blue dawn light, 16:9.',
  ghost_protocol: 'Vast underground data fortress interior, cathedral-scale server architecture bathed in cold cyan light, tiny human silhouette for scale far below, awe-inspiring and intimidating, symmetrical, 16:9.',
  quantum_heist: 'A glowing cryogenic quantum-computing chandelier rig lit from within with electric blue/violet light, clean-room environment, condensation mist, otherworldly and beautiful, macro-lens cinematic shot, 16:9.',
  project_zero: 'A colossal glowing red "0-day" digital eye/sigil forming out of converging data-streams above a dark city skyline silhouette, apocalyptic-epic scale, dominant red/black palette breaking from the game\'s usual cyan, signaling "this one is different," 16:9.'
}

// ─── Contact / seller portraits (image-prompts.md §1) — filenames match the
// `.portrait` paths in AGENT_PULL_CONTACT / ITEM_PULL_SELLER (app/utils/hack-content.ts). ─
export const CONTACT_PORTRAITS: Record<string, string> = {
  'contact/ghostwire': 'Silhouette of a person typing on a laptop in a dim room lit only by the screen, face fully obscured by shadow and monitor glare, generic hoodie, cluttered desk with energy drink cans, low-effort hacker-den aesthetic (this contact is cheap and it should look it).',
  'contact/registry': 'Abstract/non-human: a wall of monitors in a clean dark room showing scrolling encrypted verification text and profile silhouettes, no visible person at all, suggesting an organization rather than an individual, cold blue light.',
  'contact/old-man': 'An old rotary/analog phone handset on a bare table under a single hanging bulb, otherwise empty dark room, extreme minimalism, tension through absence rather than a visible person.',
  'contact/marsh': 'A cluttered self-storage unit interior, single bare bulb, cardboard boxes and a mismatched crate half-open, a figure\'s back only (never facing camera) rummaging through it, gritty and dim.',
  'contact/dennys': 'Storefront pawn-shop interior, fluorescent light, shelves of ambiguous surplus electronics behind a glass counter, no person needed — the shop itself is the "character."',
  'contact/cutter': 'Weathered hands (only hands, no face) closing the latch on a hard-shell equipment case on a workbench, tattooed forearm, single desk lamp, quiet and deliberate framing.',
  'contact/unknown-seller': 'An empty chair at a table with a single sealed crate on it, harsh single overhead light, otherwise total darkness, absolutely no person present — the point is that nobody is there.'
}

// ─── Agent class portraits (image-prompts.md §2 / agent-bios.md §4) — one
// base render per class, filenames match CLASS_PORTRAIT in hack-content.ts. ─
export const CLASS_PORTRAITS: Record<string, string> = {
  'agent/infiltrator': 'Close crop of a masked operative\'s head and shoulders, tactical balaclava/concealment mask, backlit in a doorway or vent shaft, sky-blue rim light, tense readiness, three-quarter angle.',
  'agent/cryptographer': 'Close crop of a hooded figure lit from below by a laptop screen\'s glow, glasses reflecting scrolling code, amber accent light, contemplative focused expression implied through posture only (face still substantially concealed by hood shadow).',
  'agent/social-engineer': 'Close crop of a figure in a smart-casual blazer with an ID lanyard, face partially turned away from camera, confident posture, fuchsia/magenta accent light, blending into a corporate environment (implies "hiding in plain sight" concealment rather than a mask).',
  'agent/bruteforce': 'Close crop of a tactical-vest-clad figure with a full face covering (tactical gaiter/mask), rose-red accent light, aggressive low-angle framing, more physically imposing than the others.'
}

export function buildImageManifest(): ImageSpec[] {
  const specs: ImageSpec[] = []

  for (const [id, prompt] of Object.entries(MISSION_THUMBNAILS)) {
    specs.push({ file: `mission/${id.replace(/_/g, '-')}`, prompt: prompt + IMAGE_STYLE_SUFFIX, size: LANDSCAPE_16_9 })
  }
  for (const [file, prompt] of Object.entries(CONTACT_PORTRAITS)) {
    specs.push({ file, prompt: prompt + IMAGE_STYLE_SUFFIX, size: PORTRAIT_SQUARE })
  }
  for (const [file, prompt] of Object.entries(CLASS_PORTRAITS)) {
    specs.push({ file, prompt: prompt + IMAGE_STYLE_SUFFIX, size: PORTRAIT_SQUARE })
  }

  return specs
}
