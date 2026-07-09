# HackOps Redesign — Implementation Plan

Status: **Phases 0–4 built and verified in-browser** (2026-07-09), on
`feature/hackops-redesign`. See §9 for the build log — what shipped, real
bugs it caught, and what's next. All planned phases are built, including
a fifth-wheel Agents/Items HUD restyle that no phase had originally
scheduled (found and closed during the Phase 4 pass — see §9).

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
   The content docs (`voice-lines.md` etc.) author some lines with bracketed
   ElevenLabs v3 delivery tags (e.g. `[grim]`, `[quiet]`) for generation —
   those are TTS-only and must never reach the screen, so `playVoice` strips
   them before teletyping: `text.replace(/\[[^\]]*\]/g, '').trim()`. Do this
   once inside `playVoice`, not at each call site.
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

### Voice asset drop 1/N — done (commit `Wire in first 8 mission briefing voice lines`)

First real VO landed: `brief-{port-scan,wifi-crack,phishing-run,ransomware-drop,
dark-web,crypto-heist,telecom-tap,supply-chain}.mp3` in
`public/hack/sound/voice/`. **No code wiring was actually needed** — Phase 1's
`MISSION_VOICE` filenames in `hack-content.ts` already matched this naming
convention exactly, so `useAudio`'s existing fetch → decodeAudioData path
picked them up automatically (confirmed via Playwright: the request now
returns `200`, not a 404-to-captions-only fallback).

What *did* need work, and what to watch for on the next drop:

1. **`voice-lines.md`/`mission-briefings.md` got copy edits alongside the new
   TTS generation-notes section** (a concurrent session, not this one) —
   `[grim]`/`[quiet]` delivery tags got embedded *mid-sentence* into a few
   briefing lines (`ransomware_drop`, `black_site`, `nsa_breach`,
   `project_zero`) and `central_bank`/`nsa_breach` picked up punctuation
   changes (added ellipses/commas for pacing). `hack-content.ts`'s
   `MISSION_BRIEFING` copy is sourced verbatim from that file, so it was
   stale — synced the 5 changed lines. **If another content sync lands
   before Phase 2, diff `MISSION_BRIEFING`/`COLLECT_LINES` against the
   content docs again before assuming they still match** — this will keep
   happening as VO gets recorded/adjusted per line.
2. **Real bug caught by this sync, not by typecheck:** a mid-sentence bracket
   tag (`"...call. [grim] This one's..."`) left a doubled space once
   `playVoice` stripped it, since the old regex only trimmed the string
   *ends*. Fixed in `useAudio.ts` — the strip now also collapses internal
   whitespace (`.replace(/\s+/g, ' ')`) before the caption gets it. This
   would only have shown up as a visible double-space in a live caption, so
   it's worth specifically checking for stray `[`/`]` or doubled spaces in
   the rendered caption (not just the source string) whenever new tagged
   lines get wired in.
3. **`collect-success-rare`'s caption text also had a stale markdown artifact**
   — `voice-lines.md` corrected `*that's*` to `THAT'S` (asterisks aren't
   TTS-safe and were never going to render as emphasis in a plain caption
   either). Synced in `COLLECT_LINES.successRareText`.
4. **Not yet wired, no code needed until it lands:** `brief-{corp-breach,
   bank-skim,mil-intel,gov-heist,ai-theft,central-bank,black-site,
   nsa-breach,ghost-protocol,quantum-heist,project-zero}.mp3` (11 of 19
   mission briefings), the general RELAY barks (`brief-outro-generic`,
   `deploy-confirm`, `collect-*`, `agent-levelup`, `agent-max-level`), and
   everything in `agent-bios.md`/`crate-lore.md` (Phase 2 scope, rarity
   barks + contact intros — those two docs also picked up tag edits this
   session, e.g. Phantom bark now opens `[flat]`; keep the same "diff
   before assuming it's current" habit when Phase 2 wires them in).

### Phase 2 — Black Market — done (commits `Add Black Market: Contacts + Dead Drops hub, recruit/crate opening cinematics`, `Wire Black Market into the tab bar and retire old recruit/crate UI`)

Built per §6.4/§6.5/§10.7: `app/pages/hack/market.vue` (Contacts/Dead Drops
segmented grid, real seller/contact art copied from
`docs/games/hackops-redesign/assets/{contact,agent}/` into
`public/hack/img/{contact,agent}/` — this was the first time those mockup
assets made it into `public/`, following the same convention as the Phase-0
sound dirs), `HackCrateOpening.vue` and `HackRecruitOpening.vue` as **two
separate components** per §10.7 (scan/decrypt vs. vetting-radar sequence,
Send-to-Loadout vs. Accept/Reject — confirmed no shared base component, only
the small presentational `HackOddsBar.vue` and the existing `HackRangeBar`/
`HackFrame`/`HackItemCard` are reused between them). Both use `UModal`'s
`#content` slot with `ui.content` reset to transparent/no-ring so
`.hack-frame`'s corner-cut owns 100% of the visual instead of fighting
Nuxt UI's own card chrome (rounded-lg/ring/shadow) — worth remembering for
any future from-scratch HUD modal, since the default `#body`+`:title` pattern
(used by the Ops collect modal) keeps that chrome and works fine there
specifically because it *isn't* trying to look like a `.hack-frame`.

Reveal-bark throttling (§5.5) needed a real `useAudio` change: `playVoice`
gained a `skipAudio` option so a throttled roll still teletypes the caption
in full while silently skipping the clip fetch/play — added
`rarityBarkVoice`/`rarityBarkText` gate on `audio.barkThrottle({ rare,
quickOpen })` in both components. gsap (dynamic-imported client-side, same
pattern as the slot pages) drives the one-shot sequence — flash + stamp
scale-in (`back.out` ease) + reveal-card fade — while the scan-sweep/vet-ring
loops stay plain CSS `@keyframes`, matching PLAN.md §5.4's split exactly.

Content additions to `hack-content.ts`: per-tier contact/seller metadata +
RELAY intro/confirm lines (verbatim from `crate-lore.md`), the shared
rarity-bark table (`agent-bios.md` §2 / `crate-lore.md`, including the
Ghost item-vs-agent variant), and an `agentBioLine()` composer implementing
`agent-bios.md` §1's class+rarity+dominant-trait template system — this
wasn't explicitly scoped in the Phase 2 plan but the recruit-reveal mockup
shows a bio line and the content doc had the exact copy ready, so it shipped
rather than left as a placeholder. **Filename convention I picked, since
`crate-lore.md` doesn't pin one down:** `market-{tierId}-intro` /
`market-{tierId}-confirm` (real tier id, not a display-name slug) — reuse
this for the next voice-asset drop rather than inventing another pattern.

**Retired in the same PR** (§5 Phase 2 explicitly calls for this, no dead
double entry point): the Recruit section in `agents.vue` and Crates section
in `items.vue`, both replaced with a "Visit the Black Market" link;
`ItemReveal.vue` deleted outright (superseded by `HackCrateOpening`'s own
reveal stage, and confirmed nothing else referenced it). Added the Black
Market tab to `hack.vue`'s tab bar between Ops and Agents.

**Verified in a real browser end-to-end, not just typecheck/lint** — this
phase has real money/currency logic so a fresh test account needed crediting
directly in the local dev DB (`UPDATE "user" SET balance = ...`) to get past
the affordability gate; confirmed the gate itself first (disabled button + a
reason message at $0 balance) before crediting. With balance: bought a Junk
Cache crate through the full scan → flash → stamp → reveal sequence and
confirmed the rolled item's mods/range-bar positions match what the server
actually returned (not just placeholder numbers); ran a Ghost Recruit pull
(the one line with an embedded `[quiet]` tag) and confirmed the caption
teletyped cleanly with the tag stripped; recruited an agent, Accepted, and
confirmed it actually persisted (visible on the Agents tab after
navigating away and back — not just in the modal's local state); ran a
second recruit and Rejected it, confirming the agent is gone server-side
(fire.post.ts actually called, not just the modal closing). Confirmed the
6 rarity-bark + all market intro/confirm voice lines 404 gracefully to
captions-only exactly like the mission briefings did in Phase 1, since none
of that VO has been recorded yet.

**Not yet live-tested:** the roster-full / inventory-full disabled states
(only the balance-gate path was driven through a real click; the capacity
gate uses the same `:disabled`/`disabledReason` prop wiring so risk is low
but it's asserted from reading the code, not from actually filling a roster
to 15 agents in a browser). Gsap's timeline sequencing was verified by
outcome (the right stage appears with the right content at the right time)
rather than by inspecting intermediate animation frames — a real regression
in easing/timing specifically (as opposed to sequencing) wouldn't have been
caught by this pass.

### Post-Phase-2 fixes — done (playtest feedback after Black Market shipped)

Four issues reported after actually playing Phase 1+2, all fixed and
re-verified in a real browser:

1. **Real bug: voice never actually stopped on navigation.** `VoiceHandle.cancel()`
   only ever cleared the pre-playback `setTimeout` and stopped the teletype —
   it never touched the `AudioBufferSourceNode` once playback had actually
   started, so leaving a mission briefing (clicking Deploy or the back
   button) or a Black Market pitch left the clip audibly finishing in the
   background. Root cause was `playBuffer()` never returning the node it
   created. Fixed in `useAudio.ts`: `playBuffer` now returns the node, and
   `playVoice`'s handle tracks it and calls `.stop()` (guarded — a node that
   already finished throws on `.stop()`) in `cancel()`. Verified by
   monkey-patching `AudioBufferSourceNode.prototype.start/stop` in a real
   Chromium session and counting calls — confirmed `.stop()` now fires
   exactly when Deploy is clicked and when navigating back to the mission
   board, on the real audio graph, not just at the component level.
   `HackRelayCaption` gained an exposed `stop()` (alongside the existing
   `play()`) so callers can force this explicitly rather than only relying
   on unmount timing; `index.vue` calls it from both `dispatch()` and
   `closeBriefing()` (dispatch's success path already called the latter, so
   one fix covers both of the user's reported triggers), and both
   `HackCrateOpening`/`HackRecruitOpening` call it at the top of
   `buyAndOpen()`/`startRecruitment()`.
2. **Quick Open / Quick Recruit now genuinely skip the pitch voice**, not
   just the reveal-stage animation as before. `HackRelayCaption` in both
   pitch stages now binds `:autoplay="!quickOpen"`. Caught a real gap while
   verifying: `HackRelayCaption`'s internal autoplay watcher only re-fires on
   a `voiceName`/`text` change, not on the `autoplay` prop itself flipping —
   so toggling Quick Open back *off* mid-session wouldn't have restarted the
   line. Fixed with an explicit two-way `watch(quickOpen, ...)` in both
   components (`v ? pitchCaptionRef.stop() : pitchCaptionRef.play()`).
   Verified via caption text/cursor state (the `market-*` intro/confirm
   lines have no recorded audio yet, so `AudioBufferSourceNode.start` never
   fires regardless of this toggle — captions were the only observable
   signal, and they run start-to-completion, tag-stripped, whether or not a
   clip exists, per the existing captions-always-run design).
3. **Mission collect now gets the same flash → stamp → reveal cinematic as a
   Black Market pull**, replacing the old plain `UModal` result dialog — new
   `HackCollectReveal.vue`, simpler than the crate/recruit components since
   the op already resolved server-side before it opens (no pitch/buy stage,
   just the two-beat reveal). Stamp reads SUCCESS/FAILED in
   success/error color instead of a rarity label; reveal stage reuses the
   crate reveal's `HackFrame` + `HackRangeBar` treatment for the dropped item
   instead of the old flat `HackModChip` row, so a mission item drop and a
   crate item drop now look identical. `index.vue`'s `collect()` now enriches
   `levelUps` with `agentName` before handing the result to the component
   (avoided a function prop). Extracted a `sleep()` util to
   `app/utils/sleep.ts` — this was the third copy of the same 3-line
   `setTimeout` promise wrapper (crate/recruit/collect), past the point
   where duplicating it was reasonable.
4. **Real bug: item pulls played an agent-flavored bark.** A Phantom item
   drop said *"Don't ask what they used to do before us"* — unambiguously
   about a person. `crate-lore.md`'s own note said items should reuse every
   rarity's line verbatim except Ghost, but that didn't hold up in actual
   play. Diverged from the doc on user feedback: `hack-content.ts` now has
   item-flavored variants for Ghost/Operative/Elite/Phantom (Specialist's
   "Now we're talking" doesn't reference a person, so it's kept shared on
   purpose). **New voice filenames that don't exist in `crate-lore.md`,
   flag before recording:** `bark-rarity-operative-item.mp3`,
   `bark-rarity-elite-item.mp3`, `bark-rarity-phantom-item.mp3` (Ghost's
   `bark-rarity-ghost-item.mp3` was already spec'd). Verified via a Ghost
   Cache pull (Elite/Phantom only) across several rolls — both new item
   lines render correctly, no agent-only phrasing.

### Phase 3 — Loadout — done

Built per §6.7: new `app/pages/hack/loadout.vue` — roster rail (Active/
Storage, deep-linkable via `?agent={id}` from Agents cards), a center
operator card with three gear bays, and an inventory rail on the right
(slot filter + the existing value/rarity/type sort pattern). This is the
first page to actually wire in `HackItemCard.vue` and `HackFrame`'s
`accent` prop — both were built in Phase 0 but sat unused until now.

**Comparison overlay** (§6.7's "most net-new client logic" call-out, and it
held up): clicking or dragging an inventory item onto a same-slot bay opens
a `UModal` (the same transparent-content-slot pattern as
`HackCrateOpening`/`HackCollectReveal`) showing currently-equipped vs.
candidate `HackItemCard`s, then a delta table under "Impact on {agent}".
The delta table is computed by calling `agentPower`/`agentBonusStats`
*twice* — once against the agent's real `gear`, once against a shallow
copy with the candidate slotted in — so it's structurally impossible for
the preview to drift from what `equip.post.ts` actually applies on
confirm, matching the same "call the real function twice" pattern Ops
already uses for squad-select math. `agentBonusStats`'s own `Power`/
`Power %` entries are filtered out of the delta list (they're folded into
the `agentPower()` total already shown as its own row) to avoid double-
counting the same bonus under two labels.

**Click-to-place and drag-to-equip are the same gate, not two code paths**:
both call `openCompare(itemId)`, which only opens if `item.slot` matches
the target bay. Confirmed via a real Chromium drag (Playwright's
`locator.dragTo`, which drives actual HTML5 dragstart/dragover/drop
events, not a synthetic click) that dropping onto a matching bay opens the
identical overlay as clicking the same card.

Server-side `equip.post.ts` already auto-unequips whatever's in the target
slot (confirmed by reading it before building this), so the client never
needs an explicit "unequip old item first" step — `confirmSwap()` is a
single `equip` call with the new item id.

**Agents page narrowed to roster management** (§5 Phase 3): removed the
per-slot click-to-equip/Unequip interactions, the whole right-hand
inventory rail (desktop `hidden lg:flex` panel + mobile `USlideover`), and
the sell flow that only existed to serve that rail — gear now renders
read-only, and an **Equip** button (`i-lucide-shield-half`) on each active
roster card and in the storage detail modal's footer deep-links to
`/hack/loadout?agent={id}`. `items.vue` needed no changes — its inventory
rail exists for the Crafting Bench, not equip, so it was already correctly
scoped.

Also added the §2.2 "insufficient power" link: the existing low-success
warning in the Ops briefing (`index.vue`) now includes a "Gear up in
Loadout →" link to `/hack/loadout` instead of just naming the problem.

**Mobile** (PLAN.md §9.3, flagged as needing a call before Phase 3):
resolved by extending the existing `USlideover` convention rather than
inventing a new layout — Roster and Inventory both become slideover
triggers on mobile (`lg:hidden`), operator card stays full-width in the
main column. Confirmed in a 390×844 Chromium viewport: both slideovers
open correctly. The slideover content renders in the app's default light
theme with the plain `HackInventoryItem`-style cards (not the dark HUD
`.hack-frame` look) because `UModal`/`USlideover` teleport outside
`.hack-shell`'s scoped dark background — confirmed this is pre-existing
behavior already visible on `items.vue`'s mobile inventory slideover
today, not a regression from this page.

**Verified in a real browser, not just typecheck/lint**: registered a test
account, seeded three test items directly in the dev DB (`hack_items`
insert — faster than grinding Black Market pulls for a mods/rarity spread
to compare), then drove the actual flow — clicked an inventory item into
an empty bay, confirmed the compare overlay correctly showed "Slot empty"
on the current side, confirmed the swap; clicked a second, better item
against the now-filled bay and confirmed the delta table showed real
before/after numbers (Power 62→85, Op Speed +0%→+8%) matching the two
items' actual mods, confirmed the swap and that the previous item
returned to the inventory rail; clicked the bay's Unequip button and
confirmed the slot emptied and the item reappeared unequipped. Separately
drove the same equip via native drag-and-drop. Confirmed the Agents page's
new Equip button navigates to the correct `?agent=` deep link. The only
console noise during this pass was pre-existing and unrelated:
`/api/chat/messages`/`/api/chat/mentions` 500s from an unrelated global
chat feature (confirmed present on unmodified pages too, not touched by
this phase).

### Phase 4 — History, Leaderboard, polish — done

Restyle-only per §6.8/§6.9, same underlying data (`history.get.ts`,
`leaderboard.get.ts` untouched).

`history.vue` → **debrief log**: the 4 lifetime totals moved into
`HackFrame tight` HUD tiles; each past op is now a `HackFrame` row with a
small diagonal outcome stamp (new `.hack-stamp-sm` in `hack.css` — the
existing `.hack-stamp` class is sized for the big centered
`HackCollectReveal` moment, not an inline row, so it needed a compact
sibling rather than being reused directly). Clicking a row expands it to
a one-line RELAY-voice recap. Per §6.8 this is **template-generated
client-side from the outcome data, no new content doc entries** — a small
fixed pool of variants keyed by outcome shape (failure / rare-item success
/ gem success / plain success), picked deterministically by hashing
`op.id` so the line doesn't change on every re-render or reload.

`leaderboard.vue` → **most-wanted board**: top 3 get a larger dossier
card (`HackFrame`, `accent` on #1 only) with a placeholder silhouette
icon in place of the old medal-gradient rows, a "#N MOST WANTED" eyebrow,
and the same power/roster/gear/ops figures; ranks 4+ render as compact
`HackFrame tight` rows. No new data — purely the same fields restyled.

**Scope gap found and closed in the same pass (confirmed with you before
doing it):** `agents.vue` and `items.vue` still used plain Nuxt UI
`UCard`/`rounded-lg` styling, not the `hack-frame` HUD language, even
though `PLAN.md` has mockups for both (`agents-roster.html`, `items.html`
§6.6/§6.6a) — no phase in this doc's §5 had ever actually scheduled a
visual pass for either page, only functional changes (remove Recruit/
Crates in Phase 2, remove equip UI in Phase 3). Restyled both per the
mockups:

- `agents.vue`: roster/storage cards and gear rows now use `HackFrame`
  (base + `hack-frame-tight`/`hack-frame-2` modifiers), `HackModChip` for
  Total Bonuses (replacing the old 2-column text grid) and for each
  equipped item's mods (replacing plain text spans), mono `hack-stat-*`
  readouts for Power. The agent-detail `UModal` keeps its default Nuxt UI
  chrome (title/description props) rather than fighting it with
  `hack-frame` internals, per the precedent already noted in the Phase 2
  entry above.
- `items.vue`: crafting bench is now a `HackFrame accent` panel. The
  re-roll rows dropped their hand-rolled `rollQuality`/quality-color bar
  in favor of the existing `HackRangeBar` component (already used
  identically by `HackCollectReveal`/`HackCrateOpening` — one fewer
  bespoke bar implementation) and the lock toggle now uses `.hack-lock-
  chip` (built in Phase 0, unused until now — its own CSS comment
  literally said "Phase 3/4"). Inventory rail switched from
  `HackInventoryItem` to `HackItemCard` (same prop/emit/slot contract);
  with that swap, **`InventoryItem.vue` had zero remaining references and
  was deleted outright** rather than left as dead code.

**Verified in a real browser**: seeded `hack_history` rows directly
(mixed success/failure/rare-item outcomes) since the test account had no
completed ops yet, confirmed all 4 total tiles and the stamp/expand
interaction render and toggle correctly, and confirmed the debrief line
text matches the outcome (the phantom-item row says "paid off, and then
some" wording, the failure row uses the no-loot phrasing). Confirmed the
leaderboard's top-3 dossier layout and the ranked list below it render
against real seeded data (the current dev DB has ~45 leftover test
accounts from prior verification sessions, all rendering correctly at
that scale).

For the Agents/Items HUD pass specifically: the Playwright browser cache
had been evicted mid-session (a `chromium.launch()` that had worked
minutes earlier suddenly couldn't find its executable) — re-ran `npx
playwright install chromium` before continuing, worth knowing if a future
session hits the same "worked before, missing now" error rather than
assuming something in the app broke. With that fixed: confirmed
`agents.vue` renders the roster/gear/storage cards with zero console
errors, confirmed `items.vue`'s crafting bench correctly loads a real
item, renders its mods on `HackRangeBar`, and that clicking a
`.hack-lock-chip` actually toggles its `.locked` class (not just a visual
check — asserted the class in the DOM).

### Fidelity pass — done (playtest feedback after Phases 3–4 shipped)

The first HUD pass restyled the tokens but several screens didn't actually
resemble their `mockups/*.html`. Reworked all four against the mockups,
plus two smaller asks:

1. **`history.vue` → the `history.html` layout.** Was one `HackFrame` per
   row; the mockup is a *single* frame with hairline-separated
   `.hack-report-row`s, a rotated `.hack-stamp-sm`, `.hack-reward-chip`s
   *between* the title and the meta line (not on the right), and a chevron
   that rotates on expand. New `.hack-report-row`/`.hack-reward-chip`/
   `.hack-chevron` classes in `hack.css`. Lifetime-total tiles now render
   plain `formatNumber` mono text like the mockup instead of
   `CoinBalance`/`GemBalance` — which also **killed a real SSR hydration
   mismatch**: those two components wrap the value in a `UTooltip`
   (`PopperRoot`) that hydrates with a different child count than the
   server rendered. It predated this session (the old totals used them
   too) but only surfaced now because earlier checks client-navigated
   between tabs rather than cold-loading each; a full `page.goto` per tab
   exposed it. Confirmed gone via a Vue-warn listener in Chromium.
2. **`items.vue` → the `items.html` two-column layout.** Inventory left
   (filter buttons + sort), Crafting Bench right (`frame-accent`) with a
   gem cost-preview block and lock-chip + `HackRangeBar` re-roll rows. Item
   cards gained always-visible Load-into-Bench / Sell actions
   (`HackItemCard` `actionsAlways` prop) instead of the select-then-act
   flow. Grid stacks on mobile — no separate bench slideover needed.
3. **`agents.vue` → the `agents-roster.html` cards**, with the user's one
   change: sleeper agents are a **right-side list on `xl`, and drop below
   the roster on smaller screens** (`xl:grid-cols-[1fr_340px]`, verified in
   both a 1600px and a 430px viewport). Real class portraits
   (`CLASS_PORTRAIT`) replace the icon-in-a-box avatars, gear rows use a
   rarity-accent left strip.
4. **`loadout.vue` closer to `loadout.html`.** Kept the fixed three-column
   layout (the user preferred it to the mockup's page-scroll), but framed
   each rail (`HackFrame`), swapped icon boxes for portraits (150px
   operator, 40px roster minis), enlarged the gear bays, and — the user's
   specific ask — **unified the sort controls with the slot filter**: both
   are now `.hack-filter-btn`s (new shared class, also used by `items.vue`)
   instead of a mismatched `UButtonGroup` + direction toggle.

**`HackItemCard` legibility fix** (the "hard to read" item text): titles
are now rarity-colored, with a left slot-icon column and a clear
"base +N · total N PWR" mono line, mirroring the mockup's `itemCardHTML`.
Since it's shared, this improved the cards on Items, Loadout, and Agents
at once.

**Recruit reveal now stamps the rarity at the top** like a crate open
(`HackRecruitOpening` gained the `.hack-stamp` + gsap scale-in the crate
already had) instead of only showing a small badge beside the codename —
verified a real Specialist pull renders the "SPECIALIST" stamp.

**Cursor affordance:** Nuxt UI's base button sets no `cursor`, so enabled
`UButton`s (and native `<button>`s) showed the arrow. Added a scoped
`hack.css` rule — `.hack-shell button:not(:disabled), … a[href] { cursor:
pointer }` — which also reaches the reveal/compare modals since they wrap
their teleported content in `.hack-shell`. Every genuinely-clickable
custom `div` (roster items, gear bays, report rows, sleeper cards) also
carries an explicit `cursor-pointer`; confirmed `pointer` computed on both
a `UButton` and a `.hack-filter-btn` in a real browser.

Verified every hack tab cold-loads clean (only the unrelated
`/api/chat/*` 500s remain, present app-wide) and typecheck passes on all
touched files. Remaining lint is baseline-consistent — `catch (e: any)`
and multi-root templates that the committed `market.vue`/`index.vue`
carry identically.
