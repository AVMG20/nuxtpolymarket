# Master Voice-Line & SFX Cue Sheet

Single reference for recording/TTS batch generation and for wiring up
`useAudio` calls during implementation. Every row is one asset. Mission
briefings (19 lines) live in `mission-briefings.md` and contact/crate intros
(7 lines) live in `crate-lore.md` — not repeated here, just indexed.

Total new VO line count for full launch: **19 (briefings) + 7 (contacts) +
6 (rarity barks) + 21 (below) = 53 lines**, one voice (RELAY). SFX can
either come from a sample library or be generated the same way as the VO —
see "SFX generation notes" below.

**Playback note for the 6 rarity barks specifically:** don't wire these to
fire on every single crate/recruit roll — bulk-opening sessions (~30 rolls
at once) make that fatiguing fast. See `PLAN.md` §5.5 for the throttling
rule (always play Elite/Phantom in full, throttle the common rarities to
roughly every 3rd–5th roll, skip entirely under Quick Open). Every other
line in this sheet (briefings, contact intros, one-off action barks) plays
normally — the throttling is specific to rapid repeated reveals.

## TTS generation notes (ElevenLabs)

Applies to every line in this file plus `mission-briefings.md` and
`crate-lore.md` (and the rarity-bark master copy in `agent-bios.md` §2).

**Model:** generate with `eleven_v3` — it's the only model that understands
the bracket delivery tags used below; a v2/multilingual model will just
read the brackets aloud as literal text. v3 also drops SSML `<break>`
support entirely, which is why pacing here leans on punctuation and tags
instead of `<break time="x.xs" />`.

**Stability:** start on **Natural**. It gives enough range for the dry
humor to land without drifting into melodrama — RELAY should never sound
"Creative"-tier expressive. Drop to **Robust** only if a specific take
keeps overacting a line.

**Speed:** for the two lines in `mission-briefings.md` marked with a pacing
note (Central Bank Tap: slower/patient; Crypto Heist: faster/urgent), use
the generation `speed` setting (0.7–1.2) rather than a text tag — it's the
more reliable lever for a whole-line pacing change and those notes apply to
the entire line evenly.

**Tags** (used sparingly — RELAY undersells everything; most lines need
zero tags, and none of these ever stack more than one per line):

| Tag | Use for |
|---|---|
| `[flat]` | zero-inflection, just-the-facts default delivery |
| `[dry]` / `[wry]` | the joke lines — delivered completely straight |
| `[grim]` / `[quiet]` | the handful of graver moments (ransomware, black site, endgame) |
| `[sighs]` / `[tired exhale]` | an actual performed breath — only where one is explicitly called for |

**Punctuation first, tags second** — reach for these before a bracket tag;
they're more reliable and don't risk the instability heavy tag use can
cause:
- `...` for hesitation, trailing off, a grim pause
- `—` for a hard interrupting beat (already used throughout this copy)
- CAPS on a single word for the rare emphasis point — not markdown
  `*asterisks*`, which aren't rendered for speech and risk being read
  literally as punctuation

**Captions:** bracket tags are generation-only. Before rendering a line as
an on-screen caption, strip them (`text.replace(/\[[^\]]*\]/g,
'').trim()`) — see `IMPLEMENTATION.md` §2.1. Punctuation-based cues
(ellipses, dashes, caps) are caption-safe as-is; leave those in.

## SFX generation notes (ElevenLabs Sound Effects)

Different tool from the VO above — ElevenLabs' **Sound Effects** generator
(web app: "Sound Effects"; API: `POST /v1/sound-generation`), text-to-SFX
rather than text-to-speech. No voice ID, no delivery tags — just a plain
description of the sound. Applies to every row in the SFX table below.

**Prompt shape:**
- **Simple one-shots** (most of our UI cues): a short, plain, literal
  description of the sound itself. "Single crisp digital UI click, no
  reverb tail." Don't write a scene — describe the sound.
- **Multi-beat sounds** (e.g. the stamp-impact-then-shimmer cues): describe
  the sequence of events in order, comma-separated. "Stamp impact hit,
  followed by a short glowing shimmer swell."
- **Tonal/musical cues**: name tempo/key if it matters. None of our current
  library needs this, but if a music-adjacent stinger ever gets added here
  instead of to the music beds table, that's where it'd apply.

**Useful vocabulary** (these are recognized terms that steer the model more
reliably than vague phrasing — use them explicitly where they fit):
`impact` (collision/contact sound), `whoosh` (movement through air),
`ambience` (background environmental texture), `one-shot` (single
non-repeating hit — say this explicitly for every UI cue below, it's the
single most useful word in this whole list), `loop` (seamlessly repeating),
`braam` (big brassy cinematic hit), `glitch` (malfunction/jitter/erratic
digital texture), `drone` (continuous textured tone).

**Parameters:**
- **`duration_seconds`** (0.1–30s): left unset, the model picks a length
  automatically — fine for a quick exploratory pass, but for a short UI
  one-shot pin it explicitly (0.3–1.5s for clicks/pings/chimes, up to ~2s
  for the bigger stamp impacts) so generations don't wander long and need
  trimming. Note: costs 40 credits/second whenever it's set explicitly —
  another reason to keep it tight rather than generous.
- **`prompt_influence`**: **High** = literal, predictable, consistent —
  the right default for basically this entire table, since we want a
  cohesive UI language, not surprises. **Low** = more creative variation —
  only worth trying for ambient/texture beds (HUD hum, scanline noise)
  where some organic variety is a feature, not a bug.
- **`loop`**: set `true` for anything meant to tile seamlessly beyond 30s
  or repeat without a seam (the crate-scan sweep, any ambience texture).
  Leave `false` (default) for every one-shot UI cue — which is nearly
  everything in the table below.
- **Output format**: MP3 works everywhere; WAV at 48kHz is available too
  but only for non-looping generations.

**Workflow tip:** the generator gives a few takes per prompt — generate 2-3
variations of each prompt below and keep the best, rather than trying to
perfect the wording up front.

## Voice — RELAY, general barks

**Canonical source has moved.** Every line below (plus rarity barks and
market copy) now lives in `app/utils/hack-voice-lines.ts`, which each has
**3 variants** to cut down on bulk-session repetition — this table is kept
only as a readable index of triggers; for the actual current copy and
filenames (`${id}-1.mp3`, `${id}-2.mp3`, `${id}-3.mp3`), read the code.
`scripts/generate-hack-voice-lines.ts` generates whatever's missing via
ElevenLabs, driven by that same file.

| Trigger | Line (variant 1 of 3 — see hack-voice-lines.ts) | Filename |
|---|---|---|
| Briefing player, squad-select unlocked (session-once) | "Your call, Handler. Pick your people." | `voice/brief-outro-generic.mp3` |
| Deploy confirmed | "They're moving. I'll let you know." | `voice/deploy-confirm.mp3` |
| Op collect — success | "Clean job. Money's already moving." | `voice/collect-success-1.mp3` |
| Op collect — success (high roll / rare item drop) | "Now THAT'S a payday. Don't get used to it." | `voice/collect-success-rare.mp3` |
| Op collect — failure | "We lost this one. Everyone's alive, that's the part that matters." | `voice/collect-failure.mp3` |
| Op collect — failure, agent squad wiped stat-wise (flavor only, no permadeath in this game) | "Rough night. They'll shake it off." | `voice/collect-failure-rough.mp3` |
| Agent level-up (any) | "They're getting better. Good — they'll need to be." | `voice/agent-levelup.mp3` |
| Agent hits max level (20) | "That's as sharp as they get. Time to gear them up instead." | `voice/agent-max-level.mp3` |
| Roster slot purchased | "New seat at the table. Fill it wisely." | `voice/roster-expand.mp3` |
| Agent fired | "Done. Didn't expect that one to last, honestly." | `voice/agent-fired.mp3` |
| Agent activated (sleeper → active) | "Waking them up." | `voice/agent-activate.mp3` |
| Agent deactivated (active → sleeper) | "They'll get some rest." | `voice/agent-deactivate.mp3` |
| Crafting Bench — item upgraded | "Sharper. Costs gems, not miracles." | `voice/craft-upgrade.mp3` |
| Crafting Bench — re-roll, good result | "That's better than what you had." | `voice/craft-reroll-good.mp3` |
| Crafting Bench — re-roll, worse result | "...Well. You paid for the roll, not the outcome." | `voice/craft-reroll-bad.mp3` |
| Loadout — swap confirmed | "Suits them." | `voice/loadout-swap.mp3` |
| Loadout — unequip | "Stripping it back down." | `voice/loadout-unequip.mp3` |
| Insufficient power to deploy | "Not with this squad. You'll get them killed — or worse, caught." | `voice/deploy-blocked-power.mp3` |
| Insufficient cash for a purchase (recruit/crate/upgrade) | "You're short. Come back when the number's real." | `voice/insufficient-funds.mp3` |
| First-ever login / new player onboarding | "New operation, huh? Let's see what you've got to work with. I'm RELAY — I run logistics. You make the calls, I make them happen." | `voice/onboarding-intro.mp3` |
| Leaderboard — player enters top 3 (nice-to-have, low priority) | "People are starting to notice your work. Careful what that attracts." | `voice/leaderboard-top3.mp3` |

## SFX library — organized by moment

Every "prompt" cell below is written to be pasted directly into the
ElevenLabs Sound Effects generator, per the notes above. Unless a row says
otherwise, generate with `prompt_influence: High` and no `loop`.

### Already generated & wired (`public/hack/sound/sfx/`)

These are shipped and in use today — the prompts below are reconstructed to
match what's already playing, so a future regenerate/replace stays
consistent rather than drifting to a new sound.

| Moment | Prompt | Duration | Filename |
|---|---|---|---|
| Generic UI confirm click (primary buttons across every page) | "Single crisp digital UI click, one-shot, subtle low-mid thock, no reverb tail" | 0.3s | `sfx/click.mp3` |
| Generic UI soft click (lighter/secondary actions — generated, not yet wired to a specific action) | "Soft muted UI click, one-shot, gentler and quieter than a primary confirm click, minimal high-end" | 0.3s | `sfx/click-soft.mp3` |
| Action denied / request failed (fire agent, sell, upgrade, re-roll, equip, dispatch, collect — any failed API call) | "Short low buzz denial tone, one-shot, error/rejection feel, quick descending digital blip, no melodic pitch" | 0.4s | `sfx/deny.mp3` |
| Purchase confirmed (recruit hire, crate buy, item sell) | "Digital cash-register-adjacent transaction chime, one-shot, bright short confirm tone, satisfying and quick, no reverb tail" | 0.6s | `sfx/purchase.mp3` |
| Briefing player opened | "Soft terminal boot-up chirp, one-shot, quick ascending digital blip like a system powering on, subtle and short" | 0.5s | `sfx/briefing-open.mp3` |
| Deploy button pressed | "Heavy mechanical confirm thunk immediately followed by a rising whoosh, one-shot, conveys a squad moving out, punchy low end on the thunk" | 1.2s | `sfx/deploy-confirm.mp3` |
| Recruit vetting sequence — scan ping | "Single radar/sonar-style ping, one-shot, quick blip with a short reverb tail trailing off, sparse and unobtrusive, no melodic pitch" | 1s | `sfx/radar-ping.mp3` |
| Loadout — swap/unequip confirmed | "Satisfying mechanical click-lock, one-shot, like a magazine seating into a firearm, tight and solid" | 0.5s | `sfx/loadout-lock.mp3` |
| Rarity stamp lands — Ghost / Operative / Specialist (shared until dedicated Specialist sound is sourced) | "Plain mechanical stamp impact thunk, one-shot, low-key confirm hit, no shimmer or tail, quick and dry" | 0.5s | `sfx/stamp-common.mp3` |
| Rarity stamp lands — Elite | "Stamp impact hit, followed by a short glowing shimmer swell, one-shot, more weight and brightness than a plain stamp thunk" | 1s | `sfx/stamp-elite.mp3` |
| Rarity stamp lands — Phantom | "Big stamp impact with a deep sub-bass hit, followed by an extended shimmering tail and a brief low sub-thump, one-shot, dramatic and weighty" | 1.8s | `sfx/stamp-phantom.mp3` |

### Still needed

Everything below is a good next batch — none of these exist yet, and none
are wired into the UI (several of the moments they cover, like the
crate-scan phase and squad-select toggles, are already built; others like
the level-up/roster chimes pair with barks added in `hack-voice-lines.ts`
that don't have an SFX layer yet).

| Moment | Prompt | Duration | Filename |
|---|---|---|---|
| Mission card — status flips to "Ready to Collect" | "Single soft alert notification ping, one-shot, gentle attention-getting chime, not urgent or harsh" | 0.5s | `sfx/mission-ready.mp3` |
| Squad-select — agent toggled on | "Soft UI click confirming an item added, one-shot, slightly rising pitch, quick and light" | 0.3s | `sfx/squad-toggle-on.mp3` |
| Squad-select — agent toggled off | "Soft UI click confirming an item removed, one-shot, slightly falling pitch, quick and light, distinct from a toggle-on tone" | 0.3s | `sfx/squad-toggle-off.mp3` |
| Crate/contact card hover | "Subtle HUD hum swell, one-shot, very quiet atmospheric texture pulse, barely audible" | 0.4s | `sfx/card-hover.mp3` |
| Crate opening — scan/lock phase (loopable) | "Rising electronic scan sweep layered with building static, tense scanning texture, no hard transient at the loop point" — set `loop: true` | 2s | `sfx/crate-scan-loop.mp3` |
| Crate opening — glitch burst (pre-reveal) | "Short chromatic-aberration-style glitch stinger, one-shot, jittering digital malfunction texture, quick and abrasive but brief" | 0.4s | `sfx/crate-glitch-burst.mp3` |
| Item/agent card animates in post-stamp | "Soft mechanical unfold click, one-shot, gentle physical snap like a panel opening, quick and satisfying" | 0.4s | `sfx/card-reveal.mp3` |
| Loadout — item dragged (on grab) | "Soft pickup tone, one-shot, light upward digital blip signaling an object being grabbed" | 0.3s | `sfx/drag-pickup.mp3` |
| Loadout — item dropped (on release) | "Soft drop tone, one-shot, light downward digital blip signaling an object being placed, distinct from a pickup tone" | 0.3s | `sfx/drag-drop.mp3` |
| Loadout — invalid drop (wrong slot type) | "Short low buzz denial, one-shot, blunter and lower-pitched than a generic error tone" (or just reuse `deny.mp3` — same intent, one less asset) | 0.4s | `sfx/loadout-invalid.mp3` |
| Countdown timer — op completes while page is open | "Soft notification sting, one-shot, pleasant short chime confirming a background task finished, not jarring" | 0.6s | `sfx/op-complete.mp3` |
| Nav — tab switch | "Very subtle HUD blip, one-shot, near-inaudible texture-only tick" | 0.2s | `sfx/tab-switch.mp3` |
| Two-click confirm armed (Fire/Sell pattern) | "Soft warning tick, one-shot, quick attention tone signaling a destructive action is now armed and needs a second click" | 0.3s | `sfx/confirm-armed.mp3` |
| Agent level-up (pairs with the `agent-levelup` VO bark, no SFX layer yet) | "Short rising digital chime, one-shot, positive progression/level-up feel, bright and quick, no melodic complexity" | 0.5s | `sfx/agent-levelup.mp3` |
| Roster slot purchased/expanded (pairs with the `roster-expand` VO bark) | "Mechanical unlock/expand thunk, one-shot, satisfying confirm tone signaling new capacity opened up" | 0.6s | `sfx/roster-expand.mp3` |
| Gem(s) awarded on collect | "Bright crystalline chime, one-shot, quick sparkling tone for a bonus-currency pickup, higher-pitched and shorter than the cash purchase chime" | 0.5s | `sfx/gem-collect.mp3` |

## Music beds (looping, `useAudio` "music" channel, independent volume)

| Context | Mood | Filename |
|---|---|---|
| Ops tab — mission select (ambient, idle) | low tension pulse, sparse | `music/ops-select-ambient.mp3` |
| Briefing player — while playing/paused | per-mission ambient cue, see `mission-briefings.md` (19 files) | `music/mission/<id>.mp3` |
| Black Market tab — ambient | moodier, transactional-tension bed | `music/market-ambient.mp3` |
| Crate opening — scan/reveal sequence | builds from `market-ambient` into a tighter, rising variant during the scan phase, resolves on stamp | `music/crate-reveal-build.mp3` |
| Agents / Loadout tabs — ambient | calmer, "home base" bed | `music/basecamp-ambient.mp3` |
| History / Leaderboard — ambient | reuse `basecamp-ambient.mp3`, no new asset needed | — |

Per plan §9 open question 4: all rows above are proposed, contingent on the
user's call on whether persistent music is wanted at all. If declined, only
the SFX table and voice lines are needed — cut the music table entirely
rather than shipping it disabled (simpler than a per-track mute matrix).
