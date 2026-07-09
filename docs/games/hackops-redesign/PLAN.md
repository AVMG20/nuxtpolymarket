# HackOps Redesign — Master Plan

Status: **design phase — not yet implemented**. This document plus the files in
`content/` and `mockups/` are the full spec. Nothing in `app/`, `server/`, or
`shared/` has been touched yet. Mechanics, formulas, DB schema, rarity tiers,
and pricing all stay exactly as they are today (`shared/utils/hack-config.ts`)
— this is a presentation-layer and interaction-layer redesign only.

## 0. Reading guide

- **This file** — vision, information architecture, per-screen UX spec,
  the audio/animation system, art direction, and the phased build roadmap.
- `content/mission-briefings.md` — RELAY's briefing script for all 19 op
  templates, subtitle text, thumbnail art prompt, ambient audio cue.
- `content/agent-bios.md` — codename backstory blurbs per class, and the
  recruit-reveal voice line for every rarity.
- `content/crate-lore.md` — the seller/contact story for all 3 recruit tiers
  and 4 item crates, plus RELAY's intro line for each.
- `content/voice-lines.md` — the master VO/SFX cue sheet: every trigger in
  the game that plays a line or a sound, in one table, for recording/TTS.
- `content/image-prompts.md` — the image-generation prompt library for every
  art asset the redesign needs.
- `mockups/*.html` — 11 standalone, dependency-free HTML files (open
  directly in a browser, no build step, click through the links between
  them) demonstrating the new screens: `dashboard`, `ops-select`,
  `ops-briefing`, `black-market`, `crate-opening`, `recruit-opening`
  (added in round 2 — see §10.7), `agents-roster`, `loadout`, `items`,
  `history`, `leaderboard`. Shared visual language, the live theme
  switcher, and the real game-formula helpers all live in
  `mockups/shared.css` / `mockups/shared.js` — see §10 before touching
  either, it explains several non-obvious decisions baked into them.
- `assets/` — real generated art as it arrives, sliced into the exact
  filenames `content/image-prompts.md` etc. specify, referenced by the
  mockups via `../assets/...` once available. See §12.2 for the pipeline.
- `prototypes/pixi-crate-scan.html` — an isolated PixiJS comparison for
  the crate-opening reveal; does not touch or replace anything in
  `mockups/`. See §12.1 for the evaluation and current decision (not
  adopted yet).

---

## 1. Vision & pillars

HackOps today is a fully-functional idle/incremental game wearing a spreadsheet.
Every number the redesign needs already exists and is correct — the job is to
make selecting a mission feel like commissioning a black-ops job, make
opening a crate feel like a heist payoff, and make gearing up an agent feel
like assembling a loadout, without changing a single formula.

Three pillars, in priority order:

1. **Diegetic framing over dashboards.** Every screen is something *inside
   the fiction* — a mission dossier, a burner-phone call, a black-market
   listing, a field kit — not a table with a button. If a number needs to be
   shown, it's shown on something (a HUD, a spec sheet, a terminal readout),
   not floating in a card.
2. **One recurring voice.** A single handler character, **RELAY**, narrates
   briefings, black-market contacts, and reaction barks. One consistent
   character means the VO backlog is recordable/TTS-able as one voice, and
   it gives the player someone to feel a relationship with over hundreds of
   ops. See §3.
3. **Reuse the shared math, never re-skin around it.** Every preview number
   in the new UI (success %, cash range, speed, stat deltas) must still come
   from the existing pure functions in `hack-config.ts`
   (`collectBonuses`, `effectiveCashRange`, `effectiveDurationMs`,
   `opSuccessChance`, `agentPower`, `itemPower`). The redesign changes how
   those numbers are *presented*, never how they're computed. This is a hard
   constraint, not a suggestion — the wiki page's formulas are player-facing
   truth and must stay accurate.

Non-goals: no new resource types, no new rarity tiers, no rebalancing of
costs/odds/drop tables, no multiplayer/PvP elements. If a design idea implies
any of those, flag it as a separate proposal rather than folding it in here.

---

## 2. Information architecture

### 2.1 Tab bar — 7 tabs (was 6)

| Tab | Route | Change |
|---|---|---|
| **Ops** | `/hack` | Redesigned: mission-select grid → briefing player, replaces the current table+modal |
| **Black Market** | `/hack/market` | **New tab.** Absorbs Recruit (currently buried in Agents) and Crates (currently buried in Items). Single cinematic buy/open experience for both agents and gear. |
| **Agents** | `/hack/agents` | Narrowed scope: pure roster management (active/sleeper toggle, storage grid, fire, rename, roster-slot purchase). Recruit UI removed — moved to Black Market. Equip UI removed — moved to Loadout. |
| **Loadout** | `/hack/loadout` | **New page.** The equip/compare screen: roster left, inventory right, drag-or-click equip, side-by-side stat comparison. |
| **Items** | `/hack/items` | Narrowed scope: inventory grid + Crafting Bench (upgrade/re-roll) only. Crates removed — moved to Black Market. |
| **History** | `/hack/history` | Restyled as a field-report log/dossier list, same data. |
| **Leaderboard** | `/hack/leaderboard` | Restyled as a most-wanted / rankings board, same data. |
| Wiki | `/hack/wiki` | Unchanged — already good reference material, low redesign value. Gets a visual pass only if time allows. |

Rationale for the split: today "Agents" mixes *acquiring* agents with
*managing* them, and "Items" mixes *acquiring* gear with *using* it. Every
acquisition flow (recruit, crate) shares the same cinematic pattern (contact
story → reveal), so they belong together; every management flow (roster,
equip, craft) shares the same "spec sheet" pattern, so those belong together.
This mirrors the pillar-1 principle: group by *player intent* (buy vs. use),
not by *entity type* (agent vs. item).

### 2.2 Navigation between the new pieces

- Agents tab: each active-roster card gets an **Equip** button → navigates to
  `/hack/loadout?agent={id}` with that agent pre-selected.
- Loadout page: an inventory-empty state links back to `/hack/market`.
- Black Market: a successful agent pull's reveal modal offers a **Send to
  Loadout** shortcut for gear pulls, and **View Roster** for agent pulls.
- Ops mission-select: an "insufficient power" state on a mission links to
  `/hack/loadout` ("Your squad isn't ready — gear up") rather than just
  graying out the Deploy button.

---

## 3. RELAY — the narrator

A single recurring voice carries every VO line in the game:

> **RELAY** — your handler. Ex-operative, now runs logistics for your
> operation: lines up jobs, vets black-market contacts, keeps you alive.
> Talks like someone who has said "this is the easy part" right before the
> hard part more times than they'd like to admit. Dry, economical,
> occasionally grim humor. Never melodramatic — RELAY has seen too much to
> be impressed by any of it, which is what makes the rare moment they *are*
> impressed land.

RELAY speaks in three contexts, always in-character, never breaking to
narrate mechanics directly (i.e. never "your success chance is 42%" — always
"I don't love these odds, but I've seen worse"):

1. **Mission briefings** (Ops tab) — sets up the job, one line of color per
   template. See `content/mission-briefings.md`.
2. **Black market intros** (Black Market tab) — introduces the recruit
   contact or crate seller in third person before you buy. See
   `content/crate-lore.md`.
3. **Reaction barks** — short lines on reveal/outcome events (crate opened,
   agent recruited, mission succeeded/failed, level-up, rare-item drop). See
   `content/voice-lines.md`.

Voice direction for casting/TTS: 30s–50s, low-mid register, unhurried pacing,
slight world-weariness, no accent affectation. If using TTS, a
neutral-to-gravelly preset (e.g. a deeper, measured voice) reads best —
avoid bright/announcer-style presets, they clash with the tone.

---

## 4. Art direction

**Hybrid tactical-hacker.** Dark military HUD chrome (angular corner-cut
frames, radar-sweep motifs, redacted-dossier textures, thin cyan/amber
scan-lines) layered with cyberpunk neon accents (glow, chromatic-aberration
glitch transitions on reveals, monospace terminal type for data/readouts).
Sleek sans-serif for narrative/UI chrome, monospace for anything that reads
as "system output" (stats, timers, logs).

- **Base surface**: near-black (`#0a0d12`-ish), layered panels with 1px
  hairline borders, subtle noise/scan-line texture — not flat black.
  Corner brackets (`⌐...⌐` style cut corners) on cards/panels instead of
  rounded corners, to read as tactical HUD rather than consumer app.
- **Accent color**: driven by the existing theme system (`text-primary`,
  `bg-primary`) — the redesign must *not* hardcode a fixed accent hue,
  since the user already customizes primary/secondary/neutral globally.
  Mockups use a cyan-on-near-black default (matching the current theme
  default) but every accent in the mockups is written against a CSS
  custom-property (`--accent`) precisely so it maps 1:1 to `bg-primary`/
  `text-primary` when this becomes real Nuxt UI markup.
- **Fixed semantics preserved from the current game** (per the survey):
  cash = amber/yellow, gems = cyan, XP = violet, rarity ladder = zinc → green
  → sky → amber → rose (Ghost → Operative → Specialist → Elite → Phantom).
  These stay theme-independent exactly as they are today — don't let them
  collide with the user's chosen primary color.
- **Typography**: a monospace face (e.g. `JetBrains Mono` / `IBM Plex Mono` /
  system `ui-monospace`) for stats, timers, terminal-style copy; a clean
  geometric sans (e.g. `Inter`, already likely in the project) for briefing
  prose and UI labels.
- **Motion language**: glitch/RGB-split flicker on reveal moments (crate
  opening, rarity stamp), radar-sweep or scan-line wipe on page-load,
  typewriter/teletype reveal for RELAY's subtitle text synced to audio,
  a slow ambient scanline drift on idle panels. Nothing bounces or is
  "cute" — motion should feel like hardware doing something, not a mascot.

Full CSS token set and worked examples are in `mockups/shared.css`.

---

## 5. Audio & animation system (technical design)

### 5.1 Current state (from the codebase survey)

No shared audio/animation infra exists for HackOps. The precedent in
`app/pages/games/*.vue` (slot machines) hand-rolls raw Web Audio API per
page: lazy `AudioContext`, a `Map<string, Promise<AudioBuffer>>` cache,
`playSfx`/`playMusic` helpers, `localStorage`-persisted volume. `gsap` is
already a project dependency (used for reel spins) but has no shared wrapper.

### 5.2 Proposed shared composable (for the eventual implementation phase)

Factor the duplicated slot-machine pattern into `app/composables/useAudio.ts`
once, and have HackOps be its first non-slot consumer:

```ts
// app/composables/useAudio.ts (proposed — not yet built)
export function useAudio(namespace: string) {
  // namespace -> asset base path, e.g. 'hack' -> /hack/sound/**
  // exposes: playSfx(name), playMusic(name, { loop, fadeMs }), playVoice(name, { onEnd, captionsRef }),
  // stopMusic(fadeMs), muted (persisted), volume (persisted)
}
```

- `playVoice()` is the new addition RELAY needs beyond what the slot pages
  do: plays a VO clip and drives a synced subtitle/caption ref (word-by-word
  or line-level reveal — line-level is enough for launch). Must resolve
  instantly to captions-only if the audio file 404s or hasn't been recorded
  yet (see placeholder convention below) — captions are never optional,
  audio is progressive enhancement.
- Respects a single global mute (persisted), plus independent SFX/Music/Voice
  volume sliders — reuse the pattern already in the slot pages rather than
  inventing a new settings surface.
- Asset convention: `public/hack/sound/voice/*.mp3`, `public/hack/sound/sfx/*.mp3`,
  `public/hack/sound/music/*.mp3`, mirroring the existing
  `public/slots/<game>/sound/` convention.

### 5.3 Placeholder convention (for right now — no assets exist yet)

Every mockup marks an audio/image slot the same, unmissable way so they're
trivial to find-and-replace later:

- **Audio**: a visible pill `▶ AUDIO PLACEHOLDER · voice/mission-04-brief.mp3`
  with a dashed border, wired to a stub `playPlaceholder()` in
  `shared.js` that just animates a waveform and advances captions on a
  timer — so the mockups are already "playable" without real files.
  The exact filename shown *is* the intended final asset path.
- **Images**: a dashed-border box with a centered `🖼` glyph, the asset's
  intended filename, and a "Prompt →" link that jumps to the matching entry
  in `content/image-prompts.md`. Never a gray rectangle with no label —
  every placeholder is self-documenting so asset production can happen in
  parallel by someone who never opens this plan doc.

### 5.4 Animation library choices

- **gsap** (already a dependency) for the crate-opening sequence, card
  flips/reveals, and glitch-transition timelines — reuse the slot-machine
  team's existing familiarity with it rather than introducing a second
  animation library.
- Plain CSS `@keyframes`/transitions for ambient/idle motion (scanline
  drift, glow pulse, hover states) — no JS needed for anything that isn't a
  one-shot triggered sequence.
- No new dependency needed for confetti/particles: a lightweight
  CSS/canvas-free "digital rain" or particle-burst can be hand-rolled with
  ~40 absolutely-positioned divs animated via gsap stagger, consistent with
  the hacker aesthetic (matrix-rain reads better here than confetti anyway,
  and confetti would be a tonal mismatch with the rest of the pillar-1
  framing). The mockups demonstrate this with plain CSS/JS.

### 5.5 Reveal-bark frequency — throttle VO on bulk rolls, don't play it every time

Explicit user guidance, ahead of actual VO production: the 5 rarity barks
(§voice-lines.md, played on every crate/recruit reveal per §6.5/§10.7)
should **not** play on literally every single pull. A player bulk-opening
crates realistically does ~30 rolls in one sitting — a voice line firing
on every one of those gets grating fast, especially for the low-stakes
Ghost/Operative barks that fire most often by construction (they're the
most common rarities). Mission-briefing VO doesn't have this problem
(one briefing per deploy, naturally paced) — this is specific to
**rapid-fire repeated reveals** (crate opening, recruit vetting), not a
general rule for all VO in the game.

**Design direction for the real implementation** (not yet built, no
mockup change needed for this — it's a playback-throttling rule inside
`useAudio`'s `playVoice()` call site for reveal barks specifically, not a
visual change):
- Track a per-rarity (or global) roll counter alongside the "quick open"
  toggle already in the crate/recruit-opening flow.
- Play the bark on the *first* reveal of a session, then only every N
  rolls thereafter (N tunable — start around 3–5) for the common
  rarities. **Always** play it uninterrupted for Elite/Phantom pulls —
  those are rare enough, and exciting enough, that skipping the bark
  would undersell the moment; the fatigue problem is specifically about
  the routine Ghost/Operative rolls that happen constantly during a bulk
  session.
- The captions/subtitle track and the visual rarity stamp always play in
  full regardless of whether the audio bark is throttled that roll — only
  the audio is skipped, never the visual feedback. Silence isn't a bug
  state here, a stamp with no VO under it should look and feel
  intentional, not broken.
- Quick Open (the existing toggle, §6.5) already skips the full
  animation — when it's on, skip the bark every time regardless of the
  N-roll counter, since the player has explicitly opted into "just show
  me the result fast."

---

## 6. Screen-by-screen spec

Each subsection maps to one file in `mockups/`. All mockups reuse
`shared.css` + `shared.js` for consistency; open any file directly in a
browser to preview.

### 6.1 `dashboard.html` — tab shell

The new 7-tab bar (§2.1) rendered in the tactical-HUD chrome, plus a compact
top status strip: operator callsign, active-agent count/roster cap, total
power, cash, gems — replacing the current plain chip row with HUD-styled
readouts (corner-bracket frames, small glowing dot per stat). This is the
shared frame every other mockup's screenshot conceptually sits inside; only
this file shows the full chrome so the others can focus on their content
area.

### 6.2 `ops-select.html` — mission select grid

Replaces the current dense op-template table. A responsive grid of mission
**dossier cards**, one per `OpTemplate`:

- Thumbnail art (16:9, placeholder per §5.3) themed to the mission.
- Codename-style title + tier badge (Beginner/Early/Mid/Late/Endgame,
  derived from existing tier grouping — purely a visual label, not a new
  data field).
- Live status corner tag: **Available** / **Squad too weak** (shown instead
  of just disabling Deploy) / **In Progress** (with countdown ring) /
  **Ready to Collect** (pulsing).
- Click anywhere on the card → opens the briefing player (§6.3) rather than
  expanding inline.
- A filter/sort strip (by tier, by status, by success-chance-with-current-roster)
  sits above the grid — same sort options the current table has, just
  restyled as pill toggles.

### 6.3 `ops-briefing.html` — briefing player + squad select + deploy

The centerpiece interaction the user specifically asked for. Layout:

- **Center stage**: a large "video player" panel — actually a static/looping
  ambient art placeholder (§5.3) with a play button, scanline overlay, and a
  progress scrubber that's really just the VO clip's playhead. RELAY's
  briefing line plays on open (or on pressing play), captions teletype in
  beneath the frame in sync (§5.2).
- **Right rail**: mission spec sheet — duration, min/max agents, min power,
  cash range, gem chance, item-drop rarity floor — styled as a redacted
  dossier readout, not a table.
- **Bottom**: squad select — active roster shown as selectable chips/cards,
  live-updating combined power, success-chance bar (color-coded per the
  wiki's thresholds), effective duration, and effective cash/gem/XP preview
  as agents are toggled in/out. This is a direct restyle of the current
  Dispatch modal's live-preview logic — same underlying calls to
  `collectBonuses`/`opSuccessChance`/etc., just moved out of a modal and
  onto the main stage.
- **Deploy** button disabled until `minAgents` met and success chance ≥
  `MIN_DEPLOY_SUCCESS`, exactly as today.
- A **skip briefing next time** / "quick deploy" toggle persists per user
  (localStorage) for players who've heard the line before — mirrors the
  crate "quick open" toggle the user asked for, applied to missions too.

### 6.4 `black-market.html` — recruit + crates hub

The new tab. Two sections on one page (tab-within-tab or a simple anchor
switch — mockup uses a segmented control): **Contacts** (the 3 agent pull
tiers) and **Dead Drops** (the 4 item crate tiers). Each is a **contact
card**: a portrait/scene placeholder for the seller, their name/handle,
one-line teaser (from `content/crate-lore.md`), price, and a rarity-odds
bar (kept as an actual odds bar — this is the one place raw probability
should stay visible and unhidden, since obscuring drop rates on a paid pull
would be a dark pattern). Clicking a card opens the purchase modal (§6.5).

### 6.5 `crate-opening.html` — purchase modal + opening cinematic

Two-stage modal, matching the user's spec exactly:

1. **Stage 1 — the pitch.** Bigger art of the crate/contact, RELAY's intro
   line plays (captioned), full odds table, a cost readout, **Buy & Open**
   / **Just Buy** (adds to inventory without opening — only meaningful for
   items, since agents resolve immediately) and a **Quick Open** toggle
   (persisted) that skips straight to stage-2's end state with no animation.
2. **Stage 2 — the reveal.** On confirm: screen dims, a lock/scan animation
   plays (gsap timeline — scanning light sweep, static/glitch burst), then
   a hard flash-cut to the rarity stamp (color + label per §4's rarity
   ladder) with a matching RELAY reaction bark for that rarity tier
   (`content/voice-lines.md` has one bark per rarity, reused across every
   crate/recruit type so the line count stays finite), then the actual
   item/agent card animates in with its rolled stats. Roll-quality bars
   (already in the current `ItemReveal.vue`) are kept, just restyled to
   match the HUD language.
- Includes a "one more?" repeat-buy shortcut at the end state so bulk
  opening doesn't require re-navigating.

**Round 2 update (§10.7): this file is now gear-only.** Agent recruitment
moved to its own `recruit-opening.html` — see §10.7 for the full reasoning.
Do not re-merge them; the interaction sequences are deliberately different
(vetting animation vs. scan animation, Accept/Reject vs. Send-to-Loadout).

### 6.6 `agents-roster.html` — Agents tab (management only)

- **Active Roster** (top): cards up to `rosterSlots` cap, each showing
  portrait placeholder, codename, class icon/color, level+XP bar, equipped
  gear icons (tool/software/hardware — filled or empty slot glyphs), power
  readout, and **Equip** (→ Loadout) / **Deactivate** actions.
  An empty active slot is an explicit "OPEN SLOT" tile with a **Buy Slot**
  CTA once at cap (`ROSTER_EXPAND_COSTS`), rather than just not rendering.
- **Sleeper / Storage** (below): compact list/grid of inactive agents (up
  to `MAX_AGENTS` total), each with **Activate** / **Equip** / **Fire**
  (kept as the existing 2-click arm-then-confirm pattern — it works well
  and needs no redesign) / **Rename**.
- No recruit UI here anymore — a small "Need more agents? → Black Market"
  link replaces it.

### 6.6a `items.html` — Items tab (inventory + Crafting Bench only)

Not separately numbered in the original 9-screen plan above but built as a
10th mockup for completeness, since the Items tab still exists post-redesign
(§2.1) just without its crate section. Inventory grid (sell action kept as
the existing 2-click confirm) on the left, a persistent Crafting Bench panel
on the right — "Load into Bench" from any inventory card, then Upgrade
(level, gem cost preview) or Re-roll (per-mod lock toggles, live gem cost
that updates with lock count per `rerollCost`). Same interaction model as
today, restyled to the HUD language — this tab was already close to right,
lowest redesign priority alongside History/Leaderboard.

### 6.7 `loadout.html` — `/hack/loadout` equip & comparison

The other centerpiece the user asked for.

- **Left rail**: full roster (active + sleeper, clearly grouped/labeled),
  click to select the agent being outfitted. Selected agent gets a large
  "operator card" at the top of the center column: portrait, three gear
  slots (tool/software/hardware) shown as large equip bays, each either
  showing the equipped item's icon+name+level or an empty-bay prompt.
- **Right rail**: inventory grid, filtered/sortable by slot type, same
  cards as today's `InventoryItem.vue` but restyled to the HUD language.
  Filtering to the slot type of whichever bay is currently selected on the
  operator card, so the right rail always shows "things you could put
  here."
- **Interaction**: click an empty or filled bay to select it (highlights),
  then click an inventory item to stage it — OR drag an inventory card onto
  a bay. Both must work (click-to-place is the accessible/mobile-friendly
  path per the existing app; drag is the power-user path this redesign
  adds). This matches "click & drag or just click" from the brief.
- **Comparison overlay**: staging a replacement for an occupied bay opens a
  side-by-side compare panel — currently-equipped item vs. candidate item,
  and beneath both, the **agent's own stat block before/after**: power,
  loot%, speed%, gem chance%, XP boost, each stat showing the delta inline
  (`+5` green / `-20%` red, exactly as specified), computed from the same
  `agentPower`/`collectBonuses` functions so it can never drift from what
  actually applies on confirm. **Confirm Swap** / **Cancel**.
- Unequipping (dragging an item off a bay back to inventory, or an explicit
  "Unequip" button on the bay) is a first-class action, not just replacement.

### 6.8 `history.html` — field-report log

Same underlying data (`history.get.ts`), restyled as a **debrief log**:
lifetime stat tiles keep their HUD-readout treatment from §6.1, and each
past op becomes a collapsed "after-action report" row (icon, mission name,
outcome stamp — SUCCESS in success color / FAILED in error color, stamped
diagonally like a redacted document stamp — duration, squad size, reward
summary) that expands to a short generated one-liner in RELAY's voice
recapping the outcome (text-only, no audio needed for every history row —
that would be a lot of VO for low-value moments; template-generate the line
client-side from the outcome data, no new content needed per op).

### 6.9 `leaderboard.html` — most-wanted board

Same data (`leaderboard.get.ts`), restyled as a "most-wanted"/rankings
board — top 3 get a larger dossier-photo treatment (placeholder avatars)
instead of podium gradients, rest as a HUD-styled ranked table. Lowest
redesign priority of the 9 screens; included for completeness since the
full pass was requested, but functionally near-identical to today.

---

## 7. Content deliverables (see `content/`)

| File | Contents | Count |
|---|---|---|
| `mission-briefings.md` | RELAY briefing script + subtitles + thumbnail prompt + ambient audio cue, per op template | 19 |
| `agent-bios.md` | Class flavor + codename backstory blurb pattern + recruit-reveal bark per rarity | 4 classes + 5 rarity barks |
| `crate-lore.md` | Seller/contact persona + story blurb + RELAY intro line, per recruit tier and crate tier | 3 + 4 |
| `voice-lines.md` | Master cue sheet: every trigger → line/SFX, in one table for recording/TTS batch generation | ~60 lines |
| `image-prompts.md` | Prompt library: mission thumbnails, crate/contact art, agent portrait system (class × rarity), item icon sets, UI textures | ~50 prompts |

---

## 8. Technical implementation roadmap (post-approval)

This plan and its mockups are deliberately implementation-agnostic (plain
HTML/CSS/JS) so they can be reviewed and iterated on quickly. Once the
direction is approved, suggested build order — each phase ships something
playable, none require the later phases to be useful:

**Phase 0 — foundations (no visible change yet)**
- Build `useAudio` composable (§5.2), add `public/hack/sound/` folders with
  placeholder-silence stubs so the code path is exercised end to end.
- Add HUD design tokens to a scoped stylesheet (or Tailwind config
  extension) consumed by all HackOps pages — corner-bracket frame utility,
  scanline/glitch keyframes, monospace stat styling.

**Phase 1 — Ops redesign**
- `ops-select` grid replacing the current table.
- Briefing player replacing the Dispatch modal (keep all existing
  dispatch validation/preview logic, just remount it in the new layout).
- Ship with captions-only (no real audio yet) — the placeholder system in
  §5.3 makes this fully functional without assets.

**Phase 2 — Black Market**
- New `/hack/market` route/tab; move `recruit.post.ts` UI and
  `items/pull.post.ts` UI here from Agents/Items.
- Crate-opening cinematic (gsap timeline).
- Remove recruit section from `agents.vue`, remove crate section from
  `items.vue` in the same PR (avoid a dead in-between state where both old
  and new entry points exist).

**Phase 3 — Loadout**
- New `/hack/loadout` route.
- Comparison overlay logic — this is the most net-new client logic in the
  whole redesign (everything else restyles existing computations; the
  before/after diff view is genuinely new UI, though it still only calls
  existing pure functions twice — once per candidate).
- Remove equip UI from `agents.vue`/`items.vue` sidebars once shipped.

**Phase 4 — History, Leaderboard, polish pass**
- Restyle only, lowest risk, can slot in anytime after Phase 1.
- Final art/audio asset pass replacing placeholders as they're produced.

**Suggested branch naming** (per repo convention):
`feature/hackops-ops-briefing-redesign`, `feature/hackops-black-market-tab`,
`feature/hackops-loadout-screen`, etc. — one branch per phase above, not one
giant branch, since each phase is independently shippable.

---

## 9. Open questions for you

A few decisions genuinely need your call before/during implementation
(flagging rather than guessing):

1. **Agent portraits**: the brief says agents have profile pictures "with
   concealment." Do you want a small fixed set of masked/silhouette
   portrait templates recolored per rarity (cheap, consistent, fast to
   produce), or fully unique generated portraits per agent (expensive,
   more personality, harder to keep visually consistent across ~15 agents
   × however many players)? `content/image-prompts.md` includes prompts
   for both approaches — recommend starting with the template approach and
   revisiting if it feels flat.
2. **Voice production**: RELAY's ~60 lines (`voice-lines.md`) — real VO
   recording, or TTS (e.g. ElevenLabs-style)? Affects whether the "one
   consistent voice" constraint in §3 is easy (TTS: trivial) or costly
   (real actor: every new op/crate template needs a studio session).
3. **Mobile**: the loadout screen's three-column layout (roster / operator
   card / inventory) is the one screen genuinely hard to fit on a phone.
   Existing pages already collapse the inventory sidebar into a
   `USlideover` on mobile — same pattern should work here, but worth
   confirming that's an acceptable mobile experience before Phase 3 rather
   than after.
4. **Music**: no ambient/background music track exists in the plan yet
   beyond per-VO SFX. Do you want a persistent ambient HackOps music bed
   (like the slot pages have), or should music stay out of it (some players
   mute background loops fast)?

---

## 10. Design review round 1 — feedback & resulting changes

Recorded verbatim-in-spirit so a future implementation pass (or a fresh
Claude session) has the reasoning, not just the diff. Overall verdict on
round 1: direction confirmed, the changes below are refinements, not a
pivot — none of them touch §1's pillars or the tab structure in §2.

### 10.1 Live, real theming — not just a described intent

The user's actual color picker has 17 named hues for **Primary** and
**Secondary** (red/orange/amber/yellow/lime/green/emerald/teal/cyan/sky/
blue/indigo/violet/purple/fuchsia/pink/rose) and 5 for **Neutral**
(slate/gray/zinc/neutral/stone), taken directly from
`app/layouts/default.vue`'s swatch popover. §4's promise that "every accent
maps to a CSS custom property" wasn't enough on its own — it needed to be
provably true by clicking through it. **Change made:** `shared.js` now
ships a real `THEME_PALETTE` with the exact RGB triplets from that
component, a popover UI that visually mirrors the real one (same three
labeled groups, same circular swatches, same selected-ring treatment), and
`applyTheme()` derives `--accent`/`--accent-2`/all the neutral-derived
grays live via RGB mixing — no page reload, persisted to `localStorage` so
the choice survives navigating between mockup files. Click the "● Theme"
button top-right on any mockup. **The one thing to verify when clicking
through it**: rarity/cash/gems/xp colors must never move — they're
intentionally hardcoded per §4, and proving that stays true under an
arbitrary Primary/Secondary/Neutral combination was the actual point of
this ask, not just "make it look nice in green."

### 10.2 Text size and density, generally

Several data-dense areas read too small at the default zoom: inventory
item specs, crafting-bench numbers, loadout bay labels. **Change made:**
added dedicated larger type tokens to `shared.css` (`.card-title-lg` 16px,
`.stat-value-lg` 17px mono, `.stat-label-md` 12px mono, `.mod-chip` 12.5px)
and applied them everywhere a card shows an item's rarity/name/level/power
— items.html, loadout.html, agents-roster.html, crate-opening.html's
reveal card. This is now the standard type scale for "a card showing game
data" going forward; don't reintroduce the smaller ad-hoc 10–11px sizes
from round 1's first pass.

### 10.3 Loadout — scale for ~30 items, not a handful

A player can hold up to `MAX_INVENTORY_SLOTS` (30) unequipped items, and
the round-1 loadout mockup implied a short static list. **Change made:**
`loadout.html`'s inventory panel is now data-driven off
`genMockInventory(30, seed)` (new in `shared.js`), scrolls internally
(`max-height` + `overflow-y`), and keeps the slot-filter pills but adds a
**sort dropdown** (Rarity / Power / Name) next to them — sorting by power
uses `itemTotalPower()` (base-power-from-level + any `power_flat` mods),
matching how the wiki's power formula actually works. Item cards
themselves also grew (§10.2) and now share the exact same card component
(`itemCardHTML()`) as the Items tab, so equip-flow cards and
inventory-tab cards are now visually identical everywhere.

### 10.4 Item card redesign — base power vs. rolled traits, explicit split

Feedback: item cards should show rarity, name, slot type, and a
level-derived power benefit, *separately* from the item's rolled traits
(power, gem chance, speed, XP, bonus gems, etc.) — those are two different
kinds of number (guaranteed-by-level vs. randomly-rolled) and were
blurring together. **Change made:** `itemCardHTML()` in `shared.js` now
always renders a "Base power (from level) +N · total N PWR" line
(`itemBasePower(level) = level × 2`, matching `itemPower()` in
`hack-config.ts` exactly) as its own row, then every rolled mod as a
separate `.mod-chip` underneath (icon + value + label). This is the
canonical item-card layout now — items.html, loadout.html, and the
crate-opening reveal all reference it or its visual language.

### 10.5 Crafting bench — real formulas, not placeholder numbers

Three specific gaps: (a) upgrade cost wasn't shown per-level and doesn't
vary, when it actually follows `itemUpgradeCost(level) = round(1.13^(level
− 1))` gems — cheap early, ~6 gems at the top; (b) re-roll cost wasn't
shown as actually depending on the item's rarity (mod count) and lock
count, when it's `rerollCost = modCount + (2×lockedCount − 1)`; (c) the
tiny lock icon didn't communicate state or give any sense of "how good is
this roll, and how much better could it get." **Change made:**
`shared.js` now has real `itemUpgradeCost()`/`rerollCost()`/`MOD_RANGES`
mirrored from `hack-config.ts`, `items.html`'s bench shows a live
next-4-levels cost preview and the actual re-roll cost recalculating as
you lock/unlock. The lock icon is replaced by a `.lock-chip` — a labeled
"Lock"/"Locked" pill with a status dot, unambiguous at a glance. Every
rolled mod also gets a **range bar** (`.range-bar`, new component): a
track showing the mod's full min–max range (from `MOD_RANGES`) with a
marker at the current roll, so "what's the ceiling on this stat" is
answered visually instead of requiring a wiki trip. This range-bar
component is reused identically in the new recruit reveal (§10.7) against
`AGENT_TRAIT_RANGES` — same visual language for "how good is this roll"
everywhere it applies, whether it's gear or an agent trait.

### 10.6 Active-roster agent cards — bigger portrait, info beside it, gear below

Feedback: portrait was too small; name/rarity/class/level should sit
beside the portrait in a row (not stacked below it); equipped gear should
render as full rows below — name, a rarity-colored accent (not a whole
tinted slot square), and its specs inline — rather than the tiny
icon-only gear-slot squares from round 1. The PWR readout + Equip/
Deactivate button row was explicitly called out as already correct — kept
unchanged. **Change made:** `agents-roster.html`'s active cards now use a
96px portrait beside a name/rarity-badge/class/level block, then a
`stat-label-md` "Equipped gear" section listing each item as a
`.rarity-edge`-bordered row (3px left border in the item's rarity color)
with its name and full `.mod-chip` row underneath, reusing the same mod
vocabulary as items.html/loadout.html. Empty slots render as explicit
dashed "+ empty slot" rows rather than being silently absent.

### 10.7 Black Market — agent recruitment must feel structurally different from a gear crate, not reskinned

This was the biggest structural change in round 1. Feedback: opening a
crate and "recruiting" an agent were visually indistinguishable, which
undersells the fiction — a crate is an object you buy and open, a recruit
is a *person* someone else vets and delivers to you. Specific asks:
rename the recruit tiers' primary CTA framing from "case-opening" language
to a **recruitment-contact** framing (keep tier names, but the seller-card
presentation and "Start Recruitment" button copy replace "Buy & Open");
the wait-for-the-contact step should be its own distinct animation, not
the item crate's scan/decrypt visual; the reveal should show the recruit's
profile (portrait, name, rarity, specialization) plus **rolled traits
against their max-possible range** (same range-bar idea as §10.5, applied
to `AGENT_TRAIT_RANGES` — gem_chance 0.5–5%, speed 3–10%, loot 3–6%,
xp_boost 5–50%, power_flat 10–60, power_percent 5–30%, gem_bonus 1–3);
and the reveal's actions should be **Accept Recruit** / **Reject Recruit**
(reject = an immediate discard, conceptually identical to firing an agent)
— no "Send to Loadout" button, since that only makes sense for gear.
**Change made:** split the single `crate-opening.html` into two files —
`crate-opening.html` stays gear-only (Buy & Open → scan/decrypt → rarity
stamp → item card → Send to Loadout), and the new **`recruit-opening.html`**
handles all 3 agent-pull tiers (Start Recruitment → a **vetting**
animation — pulsing radar rings around a silhouette, cycling status text
"VETTING CANDIDATE… / CROSS-CHECKING REFERENCES… / CONFIRMING
AVAILABILITY…" — → rarity-bark → full recruit profile card with
range-barred traits → Accept/Reject). `black-market.html`'s Contacts
section now links to `recruit-opening.html`, Dead Drops still links to
`crate-opening.html`. This split should carry through to the real
implementation as two distinct Vue components/composables, not one
component branching on a `kind` prop — the interaction sequences diverge
enough (vetting vs. scanning, accept/reject vs. send-to-loadout) that
sharing one component would mean permanent conditional branching for no
reuse benefit.

### 10.8 History — reward summary inline, not hidden behind expand

Feedback: cash/gems/item-drop reward was only visible after expanding a
row; it should be visible inline (the user said "in the middle of that
card/bar") without a click. **Change made:** every `history.html` row now
has a `.reward-inline` chip row (cash in yellow, gems in cyan, item name
in its rarity color, or "No reward · Partial XP only" on a failure)
between the title and the still-expandable RELAY quote/detail. Expand is
now for flavor text only, not for reward numbers — those are always
visible.

### 10.9 Leaderboard — match the real fields exactly

The round-1 mockup invented its own stat set. The real fields (from the
user's own account, screenshotted) are: name, rank, agent count ("10
agents"), **Power**, **Roster** (shown as `owned / active-cap`, e.g.
"10 / 5"), **Equipment** (item count), **Ops done**, and a repeated
larger "total power" callout for emphasis. **Change made:**
`leaderboard.html` podium cards and list rows now show exactly this field
set with these exact labels, including the redundant-on-purpose big
"Total power" line at the bottom of the podium cards. Number formatting
in the user's screenshot uses a European locale (`.` thousands, `,`
decimals, e.g. "1.983,00") — the mockup uses plain comma-thousands for
now since that's a `formatNumber`/locale concern for the real
implementation, not a mockup-fidelity one; flag this to whoever wires up
the real leaderboard page so it goes through the existing
`formatNumber` utility rather than being hand-formatted.

### 10.10 Confirmed as correct, do not change without new feedback

- The green-accent-on-app-default-background look, once confirmed
  themeable (§10.1), was explicitly liked.
- The rarity-odds bar showing exact percentages on Black Market cards —
  explicitly called out as good, keep it un-obscured (also matches
  PLAN.md §6.4's existing anti-dark-pattern note).
- Crafting bench's overall concept (load an item, upgrade or re-roll) —
  liked as-is, round 1 only asked for bigger text + real formulas + a
  better lock affordance (§10.5), not a redesign of the flow itself.
- History's success/failure stamp treatment — liked as-is.
- Leaderboard's overall podium/list visual treatment — liked as-is, only
  the underlying field set changed (§10.9).

## 11. Design review round 3 — theme popover bug, Ops mechanics corrections

### 11.1 Theme popover was rendering hidden — clip-path clips descendants

Bug, not feedback: the popover from §10.1 appeared to do nothing when
clicked. Root cause: it lived inside `.theme-pop-wrap`, itself inside the
statbar's `.frame` — and `.frame`'s corner-cut `clip-path` clips **all**
descendant painting, including absolutely-positioned children that
visually extend outside the frame's box. The popover was rendering, just
invisibly cropped away by its ancestor's clip-path. **Fix:** the popover
element now lives at the end of `<body>`, created once by
`getOrCreateThemePop()` in `shared.js`, and positioned with
`position: fixed` computed from the trigger button's `getBoundingClientRect()`
at click time — it no longer has any clipped ancestor. **Rule going
forward: never nest a popover/tooltip/dropdown inside anything with
`clip-path` (any `.frame`) — always mount it at the body level and
position it via JS.** This will matter in the real implementation too if
Nuxt UI's own popover/dropdown primitives get wrapped in a `.frame`-style
container — check that Nuxt UI's popovers already teleport to a portal
(most component libraries do) before assuming this is a non-issue there.

### 11.2 Operations can run concurrently — including the same mission twice with different squads

Significant correction to §6.2/§6.3's model. The real game lets you
dispatch multiple operations in parallel, and there is nothing stopping
two simultaneous runs of the *same* op template with two different
squads — dispatch just needs enough free (active, unassigned) agents.
Round 1/2's mockups implied a template maps to at most one in-flight
instance (a single "In Progress" corner tag per catalog card). **Change
made:** `ops-select.html` now has a dedicated **Active Operations**
section above the mission board — always visible, lists every currently
running deployment as its own card (not one per template), and the demo
data deliberately includes two concurrent "Corporate Breach" runs with
different squads to make the point unmissable. The mission board below it
no longer carries a blocking "In Progress" status; catalog cards are just
the catalog, always deployable, with a small non-blocking "● N running"
tag if that template happens to have active instances right now.

Each Active Operations card shows exactly what was asked for: **time
left** (live countdown), **finish time** (absolute clock, e.g. "finishes
~14:32"), **percent complete** (bar + number), and the **expected
loot/gems/item-find preview** computed from the squad that was actually
deployed on that run (not the roster's current state) — cash range, gem
chance × count, item-find %. A "Collect" button appears once the timer
hits zero.

### 11.3 Power requirement is advisory, never a hard block — round 1/2 mockups misrepresented this

Per the actual `opSuccessChance` formula in `hack-config.ts`
(`clamp(0,1, (power/minPower − 0.1)/1.3)`), falling short of `minPower`
only lowers your success chance — it is not a gate. The only real gate is
`MIN_DEPLOY_SUCCESS` (1%): deploy is blocked solely when the computed
chance would round to functionally zero, which in practice means "wildly,
almost comically underpowered," not "below the suggested amount." Round
1/2's mission-board cards had a "Squad too weak" corner tag with reduced
opacity implying the card was unavailable — this was simply wrong.
**Change made:** removed the blocking treatment entirely. Every mission
card is fully clickable regardless of your current power. Instead each
card shows an **"est. success, your best squad"** percentage, color-coded
using the wiki's own reference bands (≥69% green / 31–68% amber / <31%
red — matching the wiki's documented power-ratio-to-success-chance
curve), so the tradeoff is visible without being a barrier.
`ops-briefing.html` already had this right (Deploy is only disabled below
`MIN_DEPLOY_SUCCESS`, never below `minPower`) — no change needed there,
it was only the board/catalog cards that needed correcting.

### 11.4 Mission card data — the exact field set, restated

Confirmed field set for a mission board/dossier card, sourced directly
from `OpTemplate` in `hack-config.ts` — no other fields belong here:
**Payout** (`baseCash` range), **Gems** (`baseGemChance` × `baseGemCount`
range — phrased as "chance · count," e.g. "12% chance · 1 gem"), **Power
requirement** (`minPower`, advisory per §11.3), **Agents** (`minAgents`–
`maxAgents`, e.g. "2–4" meaning deployable with anywhere in that range,
not a fixed number), **Time (base)** (`durationMs`, before any
speed-trait modifiers). Tier labels (Beginner/Early Mid/Mid/Late Mid/
Endgame) are a presentational grouping only — there is no `tier` field on
`OpTemplate` in the source, it's derived from the 5 comment-delimited
groups already in the file (see `mission-briefings.md`'s tier headers for
the canonical id→tier mapping) — don't invent a real `tier` column in the
DB for this, keep it a client-side lookup table exactly like the mockup
does.

## 12. PixiJS evaluation — decision, and the first real asset

### 12.1 PixiJS — prototyped, not adopted (for now)

A friend of the user's suggested PixiJS (a 2D WebGL/canvas rendering
engine — hardware-accelerated sprites, particle systems, shader effects)
as a possible upgrade. Built a standalone, isolated comparison prototype:
`prototypes/pixi-crate-scan.html` — an "x-ray scan" reveal (a beam sweeps
down the crate, a mask progressively reveals a glowing wireframe of the
contents underneath with live particle streams, then a chromatic-
aberration glitch burst, case-split, and an item reveal with an orbiting
glow ring) as an alternative to the CSS-only reveal in
`mockups/crate-opening.html`. It does **not** replace or modify that file
— pure side-by-side comparison, loads PixiJS from a CDN so it needs a
network connection to preview (unlike every other file in this repo,
which are all fully offline).

**Decision: keep the current CSS/gsap-based design as-is for now.** Not
worth doing a wholesale redesign pass to adopt it before the real Vue
implementation exists — there's nothing to compare it against yet in
context, and the CSS version already achieves the intended look. Revisit
once the real implementation is further along and there's an actual
screen to decide "is this worth the WebGL dependency for," rather than
deciding in the abstract. If/when revisited, the scoped recommendation
from the prototype's own write-up still stands: PixiJS only for 2–3
cinematic moments (crate open, recruit vetting, maybe the rarity-stamp
burst), never for ordinary DOM UI (nav, cards, forms stay Nuxt UI), and
mounted client-only behind one isolated composable/component so it can't
leak its imperative scene-graph model into the rest of the Vue-templated
app.

### 12.2 First real asset arrived — slicing pipeline and where it landed

The user produced two generated sheets covering all 7 Black Market
contact/seller portraits:

- `assets/crate-seller.png` (1254×1254, 2×2) — top-left = `>_ghostwire`
  (Script Pull), top-right = The Registry (Dark Web Hire), bottom-left =
  the old man (Ghost Recruit), bottom-right = Marsh (Junk Cache seller).
- `assets/crate-seller-2.png` (1024×1024, 2×2) — top-left = Denny's
  Surplus (Standard Crate), top-right = Cutter (Premium Stash),
  bottom-left = the unknown Ghost Cache seller, bottom-right = a
  watermarked duplicate of Marsh — **not used**, deliberately skipped
  rather than sliced.

Both sheets have a thin black cross dividing the 4 quadrants, centered
almost exactly at the midpoint (row/col ~627 of 1254 for sheet 1, ~512 of
1024 for sheet 2) — sliced with a 6px margin inset from center on each
side (not a naive 50/50 split) so no quadrant picks up a sliver of the
divider. Resulting crops: sheet 1's four tiles are 621×621, sheet 2's
three tiles are 506×506 — the two sheets are different source
resolutions so their output tiles are different sizes from each other,
which is fine since `.photo-fill` (`object-fit: cover`) normalizes
whatever size lands in each card's box.

All 7 landed at `assets/contact/{ghostwire,registry,old-man,marsh,
dennys,cutter,unknown-seller}.jpg` and are wired into
`mockups/black-market.html` — **every one of its 7 Contacts/Dead Drops
cards now shows real art**, nothing left as a `.ph-image` placeholder on
that page. Also wired: `mockups/recruit-opening.html` (Registry) and
`mockups/crate-opening.html`, whose demo crate was swapped from Premium
Stash/Cutter to **Junk Cache/Marsh** back when only Marsh's art existed
(odds/cost/RELAY-line/revealed-item all updated to match Junk Cache's
actual ghost/operative/specialist-only drop table) — that swap is still
in place; Cutter's art existing now doesn't obligate swapping it back,
say so explicitly if a Premium Stash demo is wanted instead.

**Asset pipeline convention, reuse for every asset that lands from now
on:** raw generated output goes in `assets/` (multi-image sheets are
fine, don't need to arrive pre-cropped — check for a divider line/cross
and inset the crop a few px from it rather than assuming an exact 50/50
split), sliced with Python/PIL into the exact filenames already specified
in `content/image-prompts.md` / `mission-briefings.md` / `crate-lore.md`
under a category subfolder (`assets/contact/` done; `assets/mission/`,
`assets/agent/`, `assets/item/`, `assets/ui/` once they exist), then each
mockup's `.ph-image` placeholder for that specific asset gets swapped for
`<div class="{same sizing class}"><img class="photo-fill"
src="../assets/{category}/{file}"></div>` — `.photo-fill` (utility in
`shared.css`) is `width/height:100%; object-fit:cover`. Leave every
placeholder without an asset yet exactly as-is (dashed border, filename,
prompt link) — don't guess-substitute an unrelated image, and don't slice
a sheet tile that isn't needed (the watermarked Marsh duplicate above was
correctly left unsliced, not saved-then-ignored).

**Still pending** (per the user, arriving later): all 19 mission
thumbnails, the 4 agent class portrait templates, item icon sets, and UI
textures — the full list is `content/image-prompts.md`. The Black Market
contact/seller set (§1 of that file) is now the one fully complete asset
category.

### 12.3 Follow-up fix — square image containers

Small bug from the moment the first real photos landed: `.c-portrait`,
`.contact-art`, and `.crate-art` had fixed short heights (150–260px) sized
for a wide rectangular card, but every contact/seller photo is square. With
`.photo-fill`'s `object-fit: cover`, a square image forced into a wide
rectangle gets its left/right edges cropped off — "the images seem cut
off." **Fix:** all three containers now use `aspect-ratio: 1 / 1` instead
of a fixed height, so the box matches the photo's actual shape and
`object-fit: cover` has nothing to crop. Cards on `black-market.html` are
now noticeably taller as a direct result — that's the correct tradeoff for
showing the whole photo, not a bug. **Rule for every future square asset
placed in these mockups: give its container `aspect-ratio: 1/1`, don't
force a fixed short height onto a square source image.**

### 12.4 Agent class portraits landed

`assets/agents.png` (1254×1254, 2×2, same thin bright-line divider style
as `agents.png`'s siblings — sliced the same way, 6px margin inset from
the detected ~627/627 center, 621×621 output tiles) — one portrait per
class, confirmed against `CLASS_COLOR` in `hack-config.ts` rather than
guessed: top-left is lit in cool blue/sky → **Infiltrator**, top-right in
amber → **Cryptographer**, bottom-left in fuchsia/purple → **Social
Engineer**, bottom-right in rose/red → **Bruteforce** — the accent color
in each photo matches that class's established color exactly, which is
what confirmed the reading order (the user's own description of the
layout was slightly ambiguous; the color-coding wasn't).

Landed at `assets/agent/{infiltrator,cryptographer,social-engineer,
bruteforce}.jpg` and wired into every spot that previously showed the
generic 👤 placeholder glyph:
- `agents-roster.html` — active roster cards (96×96) and all 3 sleeper
  rows (48×48). The `activeAgents` data array's `class` field was
  switched from a display string (`'Infiltrator'`) to the real
  `AgentClass` id (`'infiltrator'`) to match the convention rarity
  already used — display text now goes through the new `CLASS_LABEL` map
  in `shared.js` instead of being stored pre-formatted.
- `loadout.html` — all 6 roster-list mini-portraits (42×42) and the big
  operator-portrait (150×150, defaults to Cipher/Infiltrator, the
  pre-selected agent).
- `recruit-opening.html` — the reveal-stage recruit-portrait (100×100),
  showing Cryptographer since the demo recruit (Wraith-9) rolled that
  class.

New shared helpers in `shared.js`: `CLASS_LABEL` (id → display string)
and `CLASS_PORTRAIT` (id → `../assets/agent/*.jpg` path), keyed by the
real `infiltrator`/`cryptographer`/`social_engineer`/`bruteforce` values
— reuse these two maps for any future agent-portrait spot rather than
hardcoding the mapping again inline. Per §4's design (also
`agent-bios.md` §4): these 4 photos are the **base template per class**;
a rarity-driven color-grade/glow layer on top (per rarity, per
`content/image-prompts.md` §2) is still a planned follow-up, not done in
this pass — every agent of a given class currently shows the identical
unmodified photo regardless of rarity. `leaderboard.html`'s player-account
avatars were deliberately left untouched — those represent a player's
profile, not a specific agent's class, so a class portrait doesn't apply
there.

## 13. Design review round 5 — polish pass on Ops, History, and the navbar

### 13.1 No emoji on trait/attribute displays

The small icon glyphs (⚡💰⏱💎⭐🔍) prefixing every rolled mod/trait value
(item cards, the crafting-bench re-roll panel, the recruit trait reveal)
are gone. **This rule is scoped specifically to traits/attributes** — it
does not apply to the rest of the app's iconography (slot-type glyphs,
`.ph-image` placeholder glyphs, corner-tag icons, etc. are unaffected and
untouched). `modChipHTML()` in `shared.js` now renders `<b>{value}
{unit}</b> {label}` with the label in a new `.mod-chip-label` style
(muted, uppercase, small) instead of a leading emoji — the bordered
`.mod-chip` box itself, plus the bold-value/muted-label text contrast, is
what marks it as an attribute rather than prose. Same pattern applied to
the hardcoded trait rows in `recruit-opening.html`'s reveal stage. Reuse
`.mod-chip-label` (or the same bold-value/muted-label split inline) for
any future attribute-style display — don't reach for an emoji again.

### 13.2 History — reward chips moved between title and meta line

Each `history.html` row is now a 3-line stack: **(1)** rarity stamp +
mission title, **(2)** the reward chips (cash/gems/item), **(3)** the
agents/duration/time-ago meta line — reward sits between the other two,
not below both of them as in round 2. The chevron moved up onto the title
row by itself since the meta line it used to share space with moved down.

### 13.3 Navbar hero stats — bigger, colored, iconed

`cash`, `gems`, and `power` in the top statbar now get distinct treatment
from the plain dot+label stats around them (callsign, squad count):
bigger bold text (16px vs. the statbar's normal 12.5px) plus an icon,
via a new `.stat-hero` class in `shared.css` and an `ICON_SVG`/`iconSvg()`
helper in `shared.js`. Cash stays yellow (`text-cash`) with a dollar-sign
icon, gems stay cyan (`text-gems`, `.gem` icon) — **the user calls this
color "blue"; it's the same `--gems` cyan token established in round 1,
just described loosely — don't introduce a second, different blue for
gems**, and power is now in the theme's primary/accent color
(`text-accent`) with a zap/bolt icon, matching "power in primary color."
The three inline SVGs are hand-drawn in Lucide's actual technical style
(24×24 viewbox, 2px stroke, round caps/joins, `currentColor`) specifically
so they're a visual stand-in, not a placeholder that'll look different
once swapped — **the real implementation should replace them with actual
`i-lucide-dollar-sign` / `i-lucide-gem` / `i-lucide-zap` via Nuxt Icon**,
per the user's own note that the real project already uses Lucide and
"we can fix it when the time comes."

### 13.4 Bug fix — missing `.gap-12` utility class

The cramped, no-spacing loot-preview line on Active Operations cards
(`ops-select.html`) wasn't a design choice, it was a bug: the markup used
`class="row gap-12 ..."` but `shared.css`'s gap scale only defined
`.gap-4/6/8/10/14/20` — `.gap-12` didn't exist, so the browser silently
ignored the class and the flex row had zero gap. Added `.gap-12 { gap:
12px; }` to the scale. **Worth a sweep for the same mistake if any other
`gap-N` value gets used somewhere before assuming the scale covers it.**

### 13.5 Numeric ranges — always spaced, never a bare dash

`$236,000–$550,000` is genuinely harder to read than `$236,000 – $550,000`
— the two numbers visually run together. **New house rule for every
numeric range in this app (cash payouts, gem-count ranges, agent-count
ranges): always `{value} – {value}` with spaces around the en-dash, never
`{value}–{value}`.** Fixed throughout `ops-select.html` (mission board
cards + Active Operations cards) and `ops-briefing.html` (the live "Cash
est." readout, which had the same bare-dash issue the dossier panel next
to it didn't). Apply this rule to any new range-formatted text added
anywhere in the app going forward — it's cheap and there's no case where
the cramped version reads better.

### 13.6 Base numbers vs. live recalculated numbers — now explicitly labeled

Confirms and labels a distinction that already existed in the underlying
design but wasn't visually called out: **the mission board and the
dossier panel show the op template's base numbers** (`baseCash`,
`baseGemChance`/`baseGemCount` straight from `hack-config.ts`, unmodified
by any agent's gear or traits) — **the moment you open a mission's
briefing and start selecting a squad, the preview panel recalculates
payout, gem chance, and success percentage live from that specific
squad's loot/gem-chance/power bonuses.** This was already how
`ops-briefing.html`'s squad-select panel worked (§6.3) — it already calls
the same `collectBonuses`/`opSuccessChance`-equivalent logic per toggle —
but the mission-board cards and the dossier's static values didn't make
clear they were the *pre-bonus* baseline. **Change made:** relabeled
`ops-select.html`'s card fields to "Payout (base)" / "Gems (base)" (Time
already said "(base)"), added a one-line footnote under each card's spec
block ("Base numbers — pick your squad on the briefing screen to see the
recalculated payout, gems and success chance"), and relabeled
`ops-briefing.html`'s dossier rail to "Cash reward (base)" / "Gem chance
(base)" so it reads as the counterpart to the live numbers in the center
panel right next to it, not a second, disconnected set of numbers.

### 13.7 Responsiveness — explicitly deferred, not a mockup gap

Per the user directly: mockups intentionally aren't responsive right now,
and that's fine — plan for it properly during the real Nuxt/Vue
implementation (where it's a matter of using Nuxt UI's existing
responsive patterns, same as the rest of the app) rather than
retrofitting breakpoints onto static demo HTML that's going to be
rebuilt as real components anyway. **Not a to-do for the mockup set.**
Don't spend effort adding `@media` breakpoints to `mockups/*.html` unless
specifically asked — it would be throwaway work.

## 14. Design review round 7 — slot-type icons match the real project

Corrected an over-design: item slot icons (tool/software/hardware) were
invented as colored emoji (💾 emerald, 💻 indigo, 🖥 orange) instead of
matching the real app, which the user pasted directly — a small neutral
badge (`i-lucide-usb` / `i-lucide-terminal` / `i-lucide-cpu`, `bg-elevated`
background, `text-muted` gray icon, **no per-slot tint**). Fixed:

- Added real `usb`/`terminal`/`cpu` inline-SVG defs to `shared.js`'s
  `ICON_SVG` (same Lucide-technical-style convention as the navbar icons
  in §13.3 — a straight swap for `i-lucide-*` later), replacing the old
  `SLOT_GLYPH`/`SLOT_COLOR` maps with a single `SLOT_ICON` map (slot →
  icon name only, no color — color is now always `var(--text-muted)`).
- `itemCardHTML()` (the shared item-card renderer used by `items.html`,
  `loadout.html`, and agent gear rows) now renders the correct icon in
  gray instead of a colored emoji. **The surrounding box itself is
  unchanged** — still the larger, reserved, transparent slot the emoji
  used to sit in, per the user's own "not sure what we'll do for images
  yet, maybe later" — only the icon shape/color inside that box changed,
  not its size or purpose. When real per-item icons/images arrive, that
  reserved box is where they go.
- `loadout.html`'s two gear-bay icons and `crate-opening.html`'s reveal-
  card icon were hardcoded markup (not routed through `itemCardHTML`) so
  they got the same fix inlined directly rather than via the shared
  function.

**Rule going forward: slot-type icons are always neutral/gray, never
tinted per type** — this reverses the `SLOT_COLOR` convention that was
in the original codebase survey and in earlier rounds of this plan (the
real live UI doesn't actually use those tints, whatever `SLOT_COLOR` in
`hack-config.ts` might define) — trust the user's pasted real-app markup
over the earlier survey's assumption on this point.
