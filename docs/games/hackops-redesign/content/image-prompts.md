# Image Generation Prompt Library

Mission thumbnail prompts already live in `mission-briefings.md` (19
prompts) — not repeated here. This file covers every other art asset the
redesign needs. All prompts are written to be generator-agnostic (work with
Midjourney, SDXL, DALL·E, etc.) — a consistent style suffix is given once at
the top; append it to every prompt below unless noted otherwise.

**Global style suffix** (append to all prompts for visual consistency):
`, dark tactical-cyberpunk aesthetic, cinematic lighting, high detail, moody color grade, no text, no watermark, no logos`

---

## 1. Contact / crate seller portraits (7 — see `crate-lore.md`)

Each is a mood/scene shot, not a clean studio portrait — these are shady
characters glimpsed, not modeled. Keep faces obscured/cropped/backlit per
the "concealment" brief note, consistent with agents also being concealed.

1. **`>_ghostwire` (Script Pull)** — Silhouette of a person typing on a
   laptop in a dim room lit only by the screen, face fully obscured by
   shadow and monitor glare, generic hoodie, cluttered desk with energy
   drink cans, low-effort hacker-den aesthetic (this contact is cheap and
   it should look it).
2. **The Registry (Dark Web Hire)** — Abstract/non-human: a wall of
   monitors in a clean dark room showing scrolling encrypted verification
   text and profile silhouettes, no visible person at all, suggesting an
   organization rather than an individual, cold blue light.
3. **The old man (Ghost Recruit)** — An old rotary/analog phone handset on
   a bare table under a single hanging bulb, otherwise empty dark room,
   extreme minimalism, tension through absence rather than a visible
   person.
4. **Marsh (Junk Cache)** — A cluttered self-storage unit interior, single
   bare bulb, cardboard boxes and a mismatched crate half-open, a figure's
   back only (never facing camera) rummaging through it, gritty and dim.
5. **Denny's Surplus (Standard Crate)** — Storefront pawn-shop interior,
   fluorescent light, shelves of ambiguous surplus electronics behind a
   glass counter, no person needed — the shop itself is the "character."
6. **Cutter (Premium Stash)** — Weathered hands (only hands, no face)
   closing the latch on a hard-shell equipment case on a workbench,
   tattooed forearm, single desk lamp, quiet and deliberate framing.
7. **Ghost Cache seller (unknown)** — An empty chair at a table with a
   single sealed crate on it, harsh single overhead light, otherwise total
   darkness, absolutely no person present — the point is that nobody is
   there.

## 2. Agent portrait system (4 class templates × rarity treatment)

Per `agent-bios.md` §4: 4 base portraits, one per class, then a rarity
color-grade/glow layer applied programmatically (not 4×5 separate
generations). Base prompts:

- **Infiltrator base** — Close crop of a masked operative's head and
  shoulders, tactical balaclava/concealment mask, backlit in a doorway or
  vent shaft, sky-blue rim light, tense readiness, three-quarter angle.
- **Cryptographer base** — Close crop of a hooded figure lit from below by
  a laptop screen's glow, glasses reflecting scrolling code, amber accent
  light, contemplative focused expression implied through posture only
  (face still substantially concealed by hood shadow).
- **Social Engineer base** — Close crop of a figure in a smart-casual
  blazer with an ID lanyard, face partially turned away from camera,
  confident posture, fuchsia/magenta accent light, blending into a corporate
  environment (implies "hiding in plain sight" concealment rather than a
  mask).
- **Bruteforce base** — Close crop of a tactical-vest-clad figure with a
  full face covering (tactical gaiter/mask), rose-red accent light,
  aggressive low-angle framing, more physically imposing than the others.

**Rarity treatment layer** (applied as a color-grade/glow overlay per
agent, not a new generation): Ghost = desaturated, flat, minimal glow.
Operative = slight saturation boost, thin green rim light. Specialist =
sky-blue rim light intensified, subtle particle/scanline overlay. Elite =
amber rim light, stronger glow, subtle lens flare. Phantom = rose/crimson
rim light, strong glow, chromatic-aberration edge fringe, an almost
"glitching out of reality" treatment appropriate for the rarest tier.

## 3. Item icons (3 slot categories, generate one representative icon style
then reskin per name — 24 base item names exist across the 3 pools, plus a
rarity-prefix system, so treat these as an *icon language* not 24 unique
illustrations)

Style note: unlike agents/crates (photographic/cinematic), items should be
**clean isolated icon renders** on a transparent/dark background, since
they're displayed small in inventory grids — a photographic style would be
illegible at icon size.

- **Tool icon style** (e.g. USB Infiltrator, Ghost Tap, Cipher Key) —
  Isolated 3/4-view render of a small physical hacking device (modified USB
  stick, signal-probe wand, hardware dongle), emerald-green accent glow
  on edges/ports, dark neutral background, clean product-render lighting,
  icon-scale composition (single centered object, generous padding).
- **Software icon style** (e.g. Zero Day Exploit, Ghost Suite, AI Decryptor)
  — Abstract glyph/sigil representing code — a stylized geometric emblem
  built from circuit-trace lines and a few brackets/slashes, indigo accent
  glow, flat-ish presentation more like an app icon than a 3D render, dark
  background, icon-scale.
- **Hardware icon style** (e.g. Black Ice Rig, Quantum Node, Void Terminal)
  — Isolated 3/4-view render of a small rack-mount or standalone hardware
  unit (mini server blade, scrambler box, cooling-finned module), orange
  accent glow on vents/edges, dark neutral background, clean product-render
  lighting, icon-scale.

**Rarity prefix visual treatment** (reuses the same rim-light/glow ladder
as agents — zinc/green/sky/amber/rose): apply increasing glow intensity and
a small particle/energy effect at Elite and Phantom tiers so a "Mythic
Ghost Tap" reads as visually distinct from a base "Ghost Tap" at a glance
in the inventory grid, without needing a fully separate render.

## 4. UI texture / background assets

- **HUD panel noise texture** (tileable) — Subtle fine-grain noise/static
  texture, near-black, extremely low contrast, for layering under panel
  backgrounds at ~5% opacity, tileable seamlessly, no directional pattern.
- **Scanline overlay** (tileable, horizontal) — Thin horizontal scanline
  pattern, 1-2px lines at ~4px spacing, near-transparent, tileable
  vertically, for a subtle CRT-adjacent overlay across the whole app shell.
- **Redacted-document texture** (for History/dossier cards) — Aged paper
  texture with black redaction bars pre-baked in at varying widths, subtle
  coffee-ring stain, desaturated, usable as a card background at low
  opacity behind text.
- **App loading / splash background** — Wide establishing shot of a dim
  operations room: multiple monitors showing abstract data streams, a world
  map with pinpoint markers, empty chair in foreground silhouette (the
  player's seat), cinematic wide shot, this is the single most "hero" image
  in the whole app so it can bear more visual complexity than the
  in-app textures above.

## 5. Rarity stamp graphics (for the reveal-cinematic stamp moment, §6.5)

Five flat vector-style rank-stamp graphics (not photographic), one per
rarity, styled like a redacted-document ink stamp or a military
clearance-level seal: angular badge shape, the rarity name in bold
condensed caps, color per the existing rarity ladder (zinc/green/sky/
amber/rose). These are simple enough to build directly in CSS/SVG rather
than generating as images — flagging that as the recommended approach
instead of image-gen for this one asset category, since a crisp vector
stamp will animate (scale/flash) far better than a raster image and is
trivial to recolor per rarity from one shared shape.
