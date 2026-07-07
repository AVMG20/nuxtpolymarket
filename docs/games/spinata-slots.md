# Spiñata Piñata — design brief

A Mexican-fiesta cascading slot with a signature **Piñata Multiplier Track**. Buy-bonus
and buy-free-spins supported. AI-generated art. Built to the repo's slot convention:
the server precomputes the entire round (every cascade, drop, multiplier and the final
capped payout) in one `.play()` call; the client is pure presentation that animates the
result. Mirrors the philosophy documented at the top of
[xenoslot.ts](../../shared/utils/gamelogic/xenoslot.ts).

## Theme & feel

Mexican street fiesta at dusk — papel-picado bunting, adobe walls, warm lantern light.
Loud, colourful, candy everywhere. Reference art: the two attached brainstorm boards and
the "Spiñata Piñata" reference UI.

## Grid & core math

- **6 reels × 5 rows**, **scatter-pay** ("pay anywhere"): 8+ of a kind anywhere on the
  grid pays, regardless of position (Sweet-Bonanza formula). Chosen over line-pay because
  it makes cascades and the candy-multiplier symbols shine.
- **Tumbling cascades**: winning symbols burst (candy-explosion particles), everything
  above drops down, new symbols fall in from the top ("piñata drops"). Repeat until no
  new win.
- Server precomputes the full cascade sequence + payout, capped at
  `SPINATA_MAX_WIN_MULT × bet` (start at 5000× like xenoslot, tune by Monte-Carlo to ~96%
  RTP).

## Signature mechanic — Piñata Multiplier Track (left rail)

The x1→x8 ladder with the ⭐ collector at the bottom-left (in every reference image).

- Every time a **Piñata symbol** lands/breaks during a spin's cascades, the track climbs
  one step (x1 → x2 → … → x8, capped).
- The track multiplier is applied to that spin's **total** win (sum of all its cascades).
- Base game: track resets each spin. In the bonus it can be made **persistent** (climbs
  across all free spins) — that's the big-win engine.
- Animation hook: when a piñata is about to drop, **slow the reel and highlight its row**
  for anticipation, then a pulse on the track as it climbs.

## Symbols

**Low (royals):** 10, J, Q, K, A (optionally 9) — the coloured glyphs from the reference.

**High-pay:** sugar skull, chili pepper, sombrero, tequila bottle, maracas.

**Feature symbols:**
- **Wild = Giga-Piñata** (the horse/donkey piñata). Substitutes for all pays; on landing
  it "smashes" (screen-shake + candy burst).
- **Scatter = Piñata Stick.** 4+ anywhere triggers **Festival of Spins** (free spins).

**Special piñata variants** (land in base and/or bonus):
- **Golden Piñata** — multiplier wild, carries a random x value that multiplies any win it
  joins.
- **Candy-Burst Piñata** — on landing, bursts to force an extra cascade / clears a small
  cluster around it.
- **Hidden Treasure Piñata** — instant cash prize (a random × bet), collected immediately.
- **Giga-Piñata (bonus)** — links to the top-award / jackpot tier.

**Multiplier symbols (candy bombs):** x2, x3, x5, x6 … up to x100. In Festival of Spins
they land and **sum together**, then multiply the cascade win (Sweet-Bonanza formula).

## Festival of Spins (bonus round)

- Triggered by 4+ Piñata Stick scatters (or bought — see below).
- N free spins; retriggers add spins.
- The Piñata Multiplier Track is **persistent** across the round.
- Candy-bomb multipliers accumulate and apply to cascade wins.

## Feature buy (already supported by the platform)

[play-game.post.ts](../../server/api/games/play-game.post.ts) already honours a
per-round `cost` returned by `.play(bet, options)`, and stakes it exploit-safely before
any balance moves. So `options.buy` selects:
- **Buy Festival of Spins** — guaranteed trigger, ~100× bet.
- **Buy Super Festival** — starts with a higher track / more spins, ~300× bet.
- **Double Chance** — toggle that raises scatter odds for ~1.25× stake.

Tune all buy costs so effective RTP matches the base game.

## Animations checklist

- Per-piñata-drop row highlight + reel slowdown (anticipation).
- Candy-explosion particles on every cascade clear.
- Giga-Piñata smash: screen-shake + candy shower.
- Multiplier-track climb pulse; bonus persistent-track counter.
- Big-win / Festival intro banners.

## Assets to generate (AI) → `public/slots/spinata/`

- `bg.jpg` — fiesta background
- `frame.png` — ornate reel border/frame + `title.png` — "Spiñata Piñata" logo
- Low symbols: `10 J Q K A (9).png`
- High symbols: `skull, pepper, sombrero, tequila, maracas.png`
- Feature: `wild_giga.png` (Giga-Piñata wild), `scatter_stick.png` (Piñata Stick)
- Piñata variants: `golden.png`, `candyburst.png`, `treasure.png`, `giga_bonus.png`
- `track.png` — x1–x8 multiplier rail + ⭐ collector
- Candy multiplier bombs: `mult_x2 … x100.png`
- Piñata variations sheet for cascade drops

## Implementation plan (when work starts)

1. `shared/utils/gamelogic/spinata.ts` — types, symbol set, weights, paytable, cascade
   engine, track logic, bonus, feature-buy costs; deterministic precompute returning the
   full animation script + `{ payout, cost }`.
2. Register in `shared/utils/games-registry.ts`.
3. `scripts/spinata-rtp.ts` — Monte-Carlo RTP tuner (mirror `scripts/xenoslot-tune.ts`).
4. `app/pages/games/spinata.vue` — Nuxt UI page that replays the server script with the
   animations above; feature-buy + autospin UI (mirror xenoslot.vue).
5. Generate/import assets into `public/slots/spinata/`.
6. Vitest coverage for the cascade/track/bonus math + RTP bounds.
