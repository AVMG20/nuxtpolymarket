# HackOps Redesign — Implementation Plan

Status: **Phases 0–1 built and verified in-browser** (2026-07-09), on
`feature/hackops-redesign`. See §9 for the build log — what shipped, a real
bug it caught, and what's next. Phases 2–4 not started.

This is the bridge from the design spec
(`PLAN.md` + `mockups/` + `content/`) to real Nuxt/Vue code. It assumes
`PLAN.md` as the source of truth for *what* every screen looks like and
resolves the *how*: file-by-file changes, the audio system, routing, and the
gaps `PLAN.md` left open. Read `PLAN.md` first — this doc does not repeat the
per-screen visual specs, it maps them onto the existing codebase.

Nothing here changes mechanics, formulas, DB schema, rarity tiers, or pricing.
This is a presentation-and-interaction-layer rebuild that reuses every pure
function in `shared/utils/hack-config.ts` and every existing endpoint.

---

## 0. Scope & guardrails

- **Frontend-only.** No `server/` or `shared/` changes. Every new screen maps
  to an endpoint that already exists (§7). Audio-toggle state is `localStorage`,
  not the DB.
- **Do not touch the global sidebar.** The left `USidebar` in
  `app/layouts/default.vue` (games list + `CoinBalance`/`GemBalance` + the
  theme switcher) is shared chrome for *all* games — HackOps is one entry in
  it. All redesign work lives inside the HackOps route subtree (`app/pages/hack*`
  and `app/components/hack/`). The mockups' top "status strip" is rebuilt
  *inside* the HackOps tab bar, not by editing the app shell — and it shows only
  HackOps-specific status (callsign, power, roster count), never a second
  cash/gems readout, since the sidebar already owns those.
- **Mechanics frozen.** Preview numbers keep coming from `collectBonuses`,
  `effectiveCashRange`, `effectiveGemChance`, `effectiveItemDropChance`,
  `effectiveDurationMs`, `opSuccessChance`, `agentPower`, `itemPower`,
  `agentBonusStats`. The redesign changes presentation only.

### Decisions locked (this session)

1. **Audio: 3 saved channels — Voice, SFX, Music.** Each independently
   muteable + volume, persisted. The Music bed defaults **OFF** (per
   `PLAN.md` §9 open-question 4 — many players mute loops fast) but ships
   available, so the full `voice-lines.md` music table is in scope.
2. **Briefing player is an in-page overlay**, not a route. Clicking a mission
   dossier card swaps the grid for the briefing view within `/hack`; a Back
   control returns to the grid. No URL change, deploy stays on one route.
3. Build order follows `PLAN.md` §8 phases, one PR per phase.

---

## 1. Gaps in PLAN.md this doc closes

Found during the codebase pass; none change the design direction, they fill
holes the spec left for implementation.

1. **Collect-outcome reveal has no mockup/spec.** The post-op success/failure
   modal (`app/pages/hack/index.vue` current lines ~678–779: loot, XP,
   level-ups, inventory-full warning) is a live reveal moment with RELAY barks
   already written (`collect-success-1`, `collect-success-rare`,
   `collect-failure`, `collect-failure-rough`, `agent-levelup`,
   `agent-max-level`). §6 never covers restyling it. **Resolution:** it gets
   the HUD reveal treatment + auto-play bark in Phase 1, alongside the briefing
   player (both are Ops-tab reveal surfaces).
2. **Tab-shell edit unscheduled + tab bar is crowded.** §2.1 defines the tabs
   but §8 never says "edit `hack.vue`." Final nav is Ops, Black Market, Agents,
   Loadout, Items, History, Leaderboard, **Wiki = 8 entries**. **Resolution:**
   icon-forward compact tab bar (label hidden below `lg`, matching the current
   `hidden sm:inline-block` pattern); the array grows per phase (Black Market
   added in Phase 2, Loadout in Phase 3), never shipping a tab that points at a
   not-yet-built page.
3. **Briefing routing unspecified** — resolved above (in-page overlay).
4. **Browser autoplay policy unaddressed.** Auto-playing VO on mount is blocked
   until the user's first gesture on the page. Within the SPA this is a
   non-issue (clicking a mission card *is* a gesture), but a cold load of
   `/hack` stays silent until first interaction. **Resolution:** captions run
   independent of audio (already the §5.2 rule); `AudioContext.resume()` fires
   on the first pointer/key event inside the hack shell; a muted/blocked/404
   clip never blocks the caption or the visual.
5. **Audio controls have no home that isn't the sidebar.** **Resolution:** a
   compact audio-settings popover pinned to the right of the HackOps tab bar.
6. **Component-refactor map absent** — see §6.
7. **"Reject Recruit" sequencing.** `recruit.post.ts` persists the agent
   *before* the reveal, so Reject = call `agents/fire.post.ts` on the
   just-created agent (money already spent, no refund — matches §10.7's
   "discard"). Spelled out in §5 / §7.

---

## 2. Audio & captions system — the keystone (Phase 0)

Everything else depends on this, so it ships first. It factors the raw
Web-Audio pattern currently copy-pasted into the slot pages
(`app/pages/games/spinata.vue` etc. — lazy `AudioContext`, a
`Map<string, Promise<AudioBuffer|null>>` buffer cache, `masterGain`,
`localStorage` volume) into one composable, and adds the VO/caption path RELAY
needs.

### 2.1 `app/composables/useAudio.ts` (new)

```ts
// namespace maps to a public asset base, e.g. 'hack' -> /hack/sound/**
export function useAudio(namespace: string) {
  // Three channels, each persisted independently in localStorage:
  //   hack:audio:voice:{muted,volume}
  //   hack:audio:sfx:{muted,volume}
  //   hack:audio:music:{muted,volume}   (music muted:true by default)
  // Plus a master mute: hack:audio:muted
  return {
    // reactive, persisted:
    channels,           // { voice, sfx, music } -> { muted: Ref, volume: Ref }
    masterMuted,        // Ref<boolean>

    playVoice,          // (name, opts) -> VoiceHandle
    playSfx,            // (name) -> void
    playMusic,          // (name, { loop = true, fadeMs = 400 }) -> void
    stopMusic,          // (fadeMs = 400) -> void
    unlock,             // resume AudioContext (call on first gesture)
    barkThrottle,       // reveal-bark gate, see §2.4
  }
}
```

`playVoice(name, { captionsRef, text, delayMs = 300, onEnd })`:

1. After `delayMs` (200–400ms window — your ask), start teletyping `text` into
   the `captionsRef` (a `Ref<string>` the component binds to a `RelayCaption`).
2. In parallel, if the `voice` channel is on **and** master isn't muted **and**
   the buffer resolves, play the clip. Sync caption completion to clip length
   when the clip exists; otherwise the caption teletypes at a fixed cadence
   (same feel as the mockup's `playPlaceholderVoice`).
3. On 404 / muted / autoplay-blocked → captions still run start to finish. Audio
   is pure enhancement. Returns a handle so `onUnmounted` can cancel a caption
   mid-stream when the user navigates away.

Buffers: reuse the slot pattern — `fetch(`/hack/sound/{channel}/{name}.mp3`)`,
`decodeAudioData`, cache the promise. A 404 caches `null` so we never re-fetch a
missing clip (this *is* the placeholder path until real VO lands — captions-only
until then, no code change needed when files arrive).

### 2.2 Auto-play + the 200–400ms delay

The delay exists so the caption "pops" a beat after the surface appears (feels
deliberate, not simultaneous) and gives the reveal art a moment to settle. It's
a `playVoice` default, applied at each trigger site — not a global timer.

### 2.3 Autoplay unlock

`hack.vue` registers a one-shot `pointerdown`/`keydown` listener that calls
`unlock()` (`audioCtx.resume()`) the first time. Before that, `playVoice` runs
captions only. In practice every path to a reveal passes through a click first,
so audible playback is the normal case; the guard only matters for a cold
deep-load.

### 2.4 Reveal-bark throttle (`PLAN.md` §5.5)

`barkThrottle(rarity, { quickOpen })` returns whether to *play the audio* this
roll (visual stamp + caption always play regardless):

- First reveal of the session → always play.
- Elite/Phantom → always play in full.
- Ghost/Operative/Specialist → play, then skip until the Nth roll after (N ≈
  3–5, module const).
- `quickOpen` true → always skip the audio.

### 2.5 Toggle UI

`app/components/hack/HackAudioSettings.vue` — a compact button (speaker icon,
reflects master-mute state) in the right slot of the HackOps tab bar, opening a
Nuxt UI popover with a mute switch + volume slider per channel (Voice / SFX /
Music). Persisted via the composable. **Not** in the global sidebar.

### 2.6 Trigger map (where audio auto-plays)

| Surface | Channel | Cue | Auto-play |
|---|---|---|---|
| Briefing overlay opens | voice | `voice/<mission-id>-brief` | on open, delay 300 |
| Briefing squad unlocked (once/session) | voice | `brief-outro-generic` | on first squad pick |
| Deploy pressed | voice + sfx | `deploy-confirm`, `sfx/deploy-confirm` | on click |
| Op collect reveal | voice | `collect-success-*` / `collect-failure-*` | on modal open, delay 300 |
| Black Market purchase pitch | voice | contact/crate intro (`crate-lore.md`) | on modal open, delay 300 |
| Crate/recruit rarity stamp | voice + sfx | rarity bark + `sfx/stamp-*` | on stamp, throttled (§2.4) |
| Crafting upgrade / re-roll | voice | `craft-*` | on result |
| Loadout swap / unequip | voice + sfx | `loadout-*` | on confirm |
| Tab enter (if Music on) | music | per-tab ambient bed | cross-fade on tab change |

---

## 3. Shared foundation (Phase 0)

### 3.1 HUD tokens — `app/assets/css/hack.css`

Port `mockups/shared.css` into a scoped stylesheet imported by `hack.vue`
(scopes the tactical-HUD look to the HackOps subtree without leaking into other
games). Key translations:

- The mockup's `--accent` / `--accent-2` → Nuxt UI `primary` / `secondary`
  (`rgb(var(--ui-primary) ...)`), so the redesign inherits the user's live
  theme automatically — no hardcoded accent.
- Corner-bracket frame utility, scanline drift, glitch/RGB-split keyframes,
  monospace stat styling, `.mod-chip` / `.mod-chip-label` (no-emoji trait
  chips, §13.1), `.range-bar`, `.stat-hero`, `.lock-chip` — all ported.
- **Fixed semantic colors reuse the config, not new tokens:** rarity uses
  `RARITY_STYLE` / `RARITY_ACCENT`; cash = yellow, gems = cyan, xp = violet as
  the pages already do. These stay theme-independent (§4).
- **CSS gotcha (§11.1):** never nest a popover/dropdown inside a `clip-path`
  frame — it clips descendants. Nuxt UI's `UPopover`/`UModal` teleport to a
  portal by default, so this is handled as long as we use them rather than
  hand-rolled absolute overlays inside a `.hack-frame`.

### 3.2 Shared components — `app/components/hack/`

Built from the mockup's `shared.js` render helpers so every card is identical
everywhere it appears (§10.3/§10.4):

| Component | From | Used by |
|---|---|---|
| `HackFrame.vue` | `.frame` corner-cut panel | every screen |
| `HackItemCard.vue` | `itemCardHTML()` — base-power row + rolled mods | Items, Loadout, Agents gear, crate reveal |
| `HackModChip.vue` | `modChipHTML()` — bold value + muted label | inside item cards, recruit traits |
| `HackRangeBar.vue` | `.range-bar` | crafting bench, recruit trait reveal |
| `RelayCaption.vue` | teletype caption + `useAudio` wiring | briefing, market, reveals |
| `HackAudioSettings.vue` | §2.5 | tab bar |

---

## 4. Routing & tab shell (Phase 1, extended per phase)

- `app/pages/hack.vue` — restyle to HUD chrome: compact icon-forward tab bar
  (8 entries, labels hidden below `lg`), the HackOps status strip
  (callsign / power / roster count from `state`), and `HackAudioSettings`
  right-pinned. Registers the autoplay-unlock listener. Tabs point only at
  live pages; Black Market/Loadout tabs are added in Phases 2/3.
- Ops briefing is an **in-page overlay** inside `app/pages/hack/index.vue` — a
  reactive `briefingTemplateId` ref swaps the grid view for the briefing view;
  no route. Deploy and collect stay on `/hack`.
- New routes: `app/pages/hack/market.vue` (Phase 2), `app/pages/hack/loadout.vue`
  (Phase 3). Deep-links from other tabs use query params
  (`/hack/loadout?agent={id}`, `/hack/market`) per §2.2.

---

## 5. Phase-by-phase build

Each phase is an independently shippable PR (`feature/…` off up-to-date `main`).

### Phase 0 — Foundations (no visible change)
- `useAudio.ts` (§2), `public/hack/sound/{voice,sfx,music}/` (empty — 404→captions).
- `hack.css` tokens (§3.1) + shared components (§3.2).
- Ships behind the existing UI; nothing wired yet.

### Phase 1 — Ops (`feature/hackops-ops-briefing-redesign`)
- `hack.vue` chrome + status strip + audio popover (§4).
- `index.vue` → `ops-select`: **Active Operations** section (reuse the existing
  `activeOpsPreview` computed — it already lists concurrent runs per op id, §11.2)
  above a mission **dossier grid**. Cards carry the §11.4 field set with
  "(base)" labels (§13.6), spaced ranges (§13.5), advisory "est. success"
  color bands (§11.3), and non-blocking "● N running" tags. No "too weak"
  gating.
- Briefing overlay: port the current dispatch-modal math (`modalStats`) onto the
  main stage — center "player" panel with `RelayCaption` auto-play, right-rail
  redacted dossier, bottom squad-select with live success bar / cash / gems /
  duration. Deploy gated only at `MIN_DEPLOY_SUCCESS`. Persisted "quick deploy"
  toggle.
- Collect reveal restyled to HUD + auto-play bark (gap §1.1).
- Fully functional captions-only (no real VO yet).

### Phase 2 — Black Market (`feature/hackops-black-market-tab`)
- `app/pages/hack/market.vue` — Contacts (3 agent tiers) + Dead Drops (4 crate
  tiers) via segmented control; contact art from `assets/contact/*`; odds bars
  kept un-obscured (§6.4). Reads `agentPullTiers`/`itemPullTiers` from `state`.
- `app/components/hack/CrateOpening.vue` (gear) **and** `RecruitOpening.vue`
  (agent) — **two components, not one branching on a prop** (§10.7). gsap
  timelines: scan/decrypt vs. vetting radar; Send-to-Loadout vs. Accept/Reject
  (Reject = fire the just-pulled agent, §1.7). Barks throttled (§2.4). Reveal
  cards use `HackRangeBar` against `MOD_RANGES` / `AGENT_TRAIT_RANGES`.
- Add the Black Market tab; **same PR** removes the Recruit section from
  `agents.vue` and the Crates section from `items.vue` (no dead double entry
  point).

### Phase 3 — Loadout (`feature/hackops-loadout-screen`)
- `app/pages/hack/loadout.vue` — roster rail / operator card / inventory rail;
  click-to-place **and** native drag equip; slot-filtered inventory; the
  **comparison overlay** (the only genuinely new client logic) computing
  before/after via `agentPower` + `collectBonuses` twice (current vs. candidate)
  so it can't drift from the equip result. First-class unequip.
- Add the Loadout tab + `Equip` deep-links on Agents cards; remove equip UI from
  `agents.vue`. Narrow Agents to roster management, Items to inventory + bench.

### Phase 4 — History, Leaderboard, polish (`feature/hackops-log-restyle`)
- `history.vue` → debrief log: inline reward chips between title and meta
  (§13.2), diagonal SUCCESS/FAILED stamp, expandable client-templated RELAY
  one-liner (no per-row VO).
- `leaderboard.vue` → most-wanted board with the exact §10.9 field set, numbers
  through `formatNumber`.
- Swap `.ph-image`/`.ph-audio` placeholders for real assets as they arrive.
- Optional Wiki visual pass.

---

## 6. Component refactor map

| Today | Redesign |
|---|---|
| `components/hack/InventoryItem.vue` | superseded by `HackItemCard.vue` (shared across Items/Loadout/Agents) |
| `components/hack/ItemReveal.vue` | logic migrates into `CrateOpening.vue`'s reveal stage |
| `pages/hack/index.vue` dispatch modal | briefing overlay + squad-select (same math) |
| `pages/hack/index.vue` collect modal | HUD collect reveal + bark |
| `pages/hack/agents.vue` recruit section | `RecruitOpening.vue` under Black Market |
| `pages/hack/agents.vue` equip UI | Loadout page |
| `pages/hack/items.vue` crates section | `CrateOpening.vue` under Black Market |
| `pages/hack/items.vue` bench | kept, restyled to HUD (§6.6a) |

---

## 7. Endpoint mapping (confirms frontend-only)

Every interaction already has an endpoint — no server work:

| Action | Endpoint (existing) |
|---|---|
| Load everything | `GET /api/hack/state` |
| Deploy | `POST /api/hack/ops/dispatch` |
| Collect | `POST /api/hack/ops/collect` |
| Recruit (Contacts) | `POST /api/hack/recruit` → returns `{ agent, rarity, ... }` |
| Reject recruit | `POST /api/hack/agents/fire` on the returned agent id |
| Crate pull (Dead Drops) | `POST /api/hack/items/pull` |
| Equip / unequip (Loadout) | `POST /api/hack/items/equip` |
| Upgrade / re-roll (bench) | `POST /api/hack/items/{upgrade,reroll}` |
| Sell / activate / rename / expand | existing `items/sell`, `agents/active`, `agents/rename`, `roster/expand` |
| History / leaderboard | `GET /api/hack/{history,leaderboard}` |

`state.get.ts` already returns active + stored agents, unequipped items with
mods, `activeOps` (as a list keyed by op id — concurrent runs work), tiers,
roster/inventory caps, `totalPower`, and per-template `status` /
`effectiveSuccessChance`. Nothing new needs adding server-side.

---

## 8. Remaining open decisions (from PLAN.md §9)

Not blocking Phase 0/1; flag when the relevant phase starts:

- **Agent portraits** (§9.1): class-template + rarity color-grade is the
  planned default (base class photos already in `assets/agent/`); the rarity
  grade layer is a Phase 2/4 art follow-up.
- **Voice production** (§9.2): TTS vs. recorded — captions-only ships fine
  regardless; wiring is identical either way.
- **Mobile loadout** (§9.3): three columns collapse to the existing
  `USlideover` inventory pattern; confirm before Phase 3.
- **Music beds** (§9.4): resolved — Music is an available channel, defaulting
  off.

---

## 9. Build progress log

Branch `feature/hackops-redesign` off `main`. One commit per phase, no
descriptions beyond the subject line per repo convention. Update this section
as each phase lands so the state of the redesign is legible without replaying
the whole conversation.

### Phase 0 — Foundations — done (commit `Add HackOps Phase 0 foundations…`)

Built exactly as scoped in §2/§3: `app/composables/useAudio.ts` (namespaced,
reusable per-game; persisted Voice/SFX/Music via `useState` — SSR-safe, no
hydration mismatch, hydrated from `localStorage` on `onNuxtReady`; a
module-level `Map<namespace, AudioEngine>` holds the non-serializable
`AudioContext`/buffer-cache/gain-node state outside Vue reactivity, mirroring
`server/utils/balance`'s "engine vs. state" split), `app/assets/css/hack.css`
(every class `hack-`-prefixed — confirmed safe to import globally per-page
without leaking into Nuxt UI's own utility classes of the same conceptual
name, e.g. `text-muted`), and the 6 shared components. `barkThrottle()`'s
signature was simplified from the plan's `HackRarity`-typed version to a
generic `{ rare: boolean }` flag so the composable stays domain-agnostic
(reusable by a future non-HackOps game) rather than importing hack-config
types into generic audio code.

### Phase 1 — Ops — done (commit `Redesign HackOps Ops tab…`)

`hack.vue` tab shell restyled to the HUD chrome (status strip: operator name
+ power + squad count, no cash/gems duplicate per §0; `HackAudioSettings`
popover; autoplay-unlock listener on first pointer/key event). `hack/index.vue`
rebuilt: dossier grid with tier badges/pills (tier is a new
`app/utils/hack-content.ts` client-side lookup, not a DB field, per PLAN.md
§11.4), Active Operations restyled, briefing as the locked-in **in-page
overlay** (a `selectedTemplate` ref swaps grid↔briefing, no route change —
confirmed via Playwright that the URL stays `/hack/` across the swap), squad
select + live stats reusing the original `modalStats` computation verbatim,
collect-reveal restyled with a `HackRelayCaption` bark. `hack-content.ts` also
carries the 19 approved RELAY briefing lines verbatim from
`content/mission-briefings.md` and the 3 collect-outcome barks from
`content/voice-lines.md`.

**Verified in a real browser**, not just typecheck/lint — registered a test
account, logged in, and drove the actual Chromium-rendered page (Playwright,
installed to a scratch dir, not a project dependency): mission grid renders
with live "est. success" color bands, opened a briefing, confirmed via DOM
inspection that the caption teletypes the exact approved line text starting
~300ms after the panel mounts (your ask), confirmed a missing voice `.mp3`
(none recorded yet) 404s and playback still completes captions-only exactly
as designed, selected an agent and confirmed the live stat grid + Deploy
button enable, and confirmed the still-unstyled Agents/Items tabs render
unaffected underneath the new tab bar (no CSS leakage from the `hack-`
namespace).

**Real bug found and fixed by that browser pass, not by typecheck:** Nuxt
auto-imports `app/components/hack/*.vue` with the directory name prefixed
onto the component tag, deduplicating only when the filename already starts
with it. Every other component was named `Hack*.vue` and resolved fine;
`RelayCaption.vue` didn't start with "Hack", so it silently registered as
`<HackRelayCaption>` while every usage in `index.vue` wrote `<RelayCaption>`
— an unresolved tag Vue renders as a literal, inert custom element (no error,
no console warning, just a dead caption). Fixed by renaming the file to
`HackRelayCaption.vue` (`git mv`) and updating both call sites, for
consistency with the rest of the `Hack*` family — worth remembering if a
future component in this directory is tempted to skip the `Hack` prefix.

**Not yet live-tested:** the actual `POST /api/hack/ops/dispatch` round trip
(button-enable state and the request payload were verified, but Deploy
wasn't clicked through to a real dispatch) and the collect-reveal modal
(requires a completed op — shortest template is 2h). Both reuse unmodified
original logic, so risk is low, but flag before calling Phase 1 fully closed.

**Also noticed, not touched:** `content/voice-lines.md` has an in-progress
uncommitted edit (ElevenLabs TTS generation notes — model/stability/tags)
that isn't mine; left it alone and out of the Phase 1 commit.

### Phase 2 — Black Market — not started
### Phase 3 — Loadout — not started
### Phase 4 — History, Leaderboard, polish — not started
