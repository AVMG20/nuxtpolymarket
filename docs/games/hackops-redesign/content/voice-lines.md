# Master Voice-Line & SFX Cue Sheet

Single reference for recording/TTS batch generation and for wiring up
`useAudio` calls during implementation. Every row is one asset. Mission
briefings (19 lines) live in `mission-briefings.md` and contact/crate intros
(7 lines) live in `crate-lore.md` — not repeated here, just indexed.

Total new VO line count for full launch: **19 (briefings) + 7 (contacts) +
6 (rarity barks) + 21 (below) = 53 lines**, one voice (RELAY). SFX are
separate, licensable/library sound, not performed.

**Playback note for the 6 rarity barks specifically:** don't wire these to
fire on every single crate/recruit roll — bulk-opening sessions (~30 rolls
at once) make that fatiguing fast. See `PLAN.md` §5.5 for the throttling
rule (always play Elite/Phantom in full, throttle the common rarities to
roughly every 3rd–5th roll, skip entirely under Quick Open). Every other
line in this sheet (briefings, contact intros, one-off action barks) plays
normally — the throttling is specific to rapid repeated reveals.

## Voice — RELAY, general barks

| Trigger | Line | Filename |
|---|---|---|
| Briefing player, squad-select unlocked (session-once) | "Your call, Handler. Pick your people." | `voice/brief-outro-generic.mp3` |
| Deploy confirmed | "They're moving. I'll let you know." | `voice/deploy-confirm.mp3` |
| Op collect — success | "Clean job. Money's already moving." | `voice/collect-success-1.mp3` |
| Op collect — success (high roll / rare item drop) | "Now *that's* a payday. Don't get used to it." | `voice/collect-success-rare.mp3` |
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

## SFX (library sound, not performed) — organized by moment

| Moment | Cue | Filename |
|---|---|---|
| Briefing player — play button pressed | soft terminal-boot chirp | `sfx/briefing-play.mp3` |
| Mission card — status flips to "Ready to Collect" | single soft alert ping | `sfx/mission-ready.mp3` |
| Squad-select — agent toggled in/out | soft UI click, distinct in/out tones | `sfx/squad-toggle-on.mp3`, `sfx/squad-toggle-off.mp3` |
| Deploy button pressed | heavier confirm thunk + rising whoosh (squad "moving out") | `sfx/deploy-confirm.mp3` |
| Crate/contact card hover | subtle HUD hum swell | `sfx/card-hover.mp3` |
| Crate purchase confirmed (pre-open) | cash-register-adjacent digital "transaction" chime | `sfx/purchase-confirm.mp3` |
| Crate opening — lock/scan phase | rising scan sweep + static build (loopable, 1–2s) | `sfx/crate-scan-loop.mp3` |
| Crate opening — glitch burst (pre-reveal) | short chromatic-aberration glitch stinger | `sfx/crate-glitch-burst.mp3` |
| Rarity stamp lands — Ghost/Operative | plain confirm thunk, low-key | `sfx/stamp-common.mp3` |
| Rarity stamp lands — Specialist | brighter chime, slight shimmer | `sfx/stamp-specialist.mp3` |
| Rarity stamp lands — Elite | bigger impact + short glow-swell | `sfx/stamp-elite.mp3` |
| Rarity stamp lands — Phantom | biggest impact, bass hit + extended shimmer tail + brief screen-shake-worthy sub-thump | `sfx/stamp-phantom.mp3` |
| Item/agent card animates in post-stamp | soft mechanical unfold/click | `sfx/card-reveal.mp3` |
| Loadout — item dragged | soft pickup tone (on grab) + soft drop tone (on release) | `sfx/drag-pickup.mp3`, `sfx/drag-drop.mp3` |
| Loadout — swap confirmed | satisfying mechanical "click-lock" (like a magazine seating) | `sfx/loadout-lock.mp3` |
| Loadout — invalid drop (wrong slot type) | short low buzz/denial | `sfx/loadout-invalid.mp3` |
| Countdown timer — op completes (page open at that moment) | soft notification sting, not jarring | `sfx/op-complete.mp3` |
| Nav — tab switch | very subtle HUD blip (near-inaudible, texture only) | `sfx/tab-switch.mp3` |
| Two-click confirm armed (Fire/Sell pattern) | soft warning tick | `sfx/confirm-armed.mp3` |

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
