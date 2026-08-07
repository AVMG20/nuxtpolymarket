# Holo treatments the renderer cannot do yet

What legacy (scan-based) cards can render today: the WOTC **cosmos holo**,
approximated by the `cosmos` foil preset masked to the art window
(`resolveLegacy`, `app/utils/tcg/foil.js`). Modern cards get the game's real
foil masks/effects, including the Poké Ball / Master Ball reverse patterns.
Everything below is missing, listed in the order it unblocks sets.

A scan carries its foil baked into the photo, so "support" means a *(mask
region, pattern texture)* pair driven by the existing shader — the same shape
cosmos already uses. Reverse treatments need an **inverse** art-window mask;
frame treatments need a border mask.

## 1. Reverse holo — blocks everything after Neo

Foil on the whole card *except* the art window. Introduced in Legendary
Collection; every set from 2002 on has a reverse of nearly every card, and the
pull-rate tables price the reverse slot separately. Era flavors (different
pattern texture, same inverse mask):

- **Legendary Collection "fireworks"** (base6)
- **e-Card stripes** (ecard1–3)
- **EX-era standard** (ex1–ex16)
- **DP/Platinum** (dp1–7, pl1–4)
- **HGSS Poké Ball stamp** (hgss1–4, col1)

## 2. e-Card era specials — blocks Expedition/Aquapolis/Skyridge

- **e-Card holo rare** — its own sheen pattern, not cosmos.
- **Crystal type** (Aquapolis, Skyridge secrets) — faceted crystal texture
  over the artwork.

## 3. EX era specials — blocks ex1–ex16 beyond the basics

- **Holo rare pattern** of the era (cosmos successor, "holon" sheen).
- **Pokémon-ex** — holo art plus foil frame elements.
- **Gold Star** — holo art with the gold star; art often breaks the frame.
- **Delta Species (δ)** — distinct holofoil over the art.

## 4. DP/Platinum era specials

- **LV.X** — partial etched-foil frame.
- **Secret/shiny rares** (DP-on "cracked ice"-style).

## 5. HGSS era specials

- **Prime** — textured holo frame around the art window.
- **LEGEND** — full-card sparkle holo, and a two-card layout problem on top.
- **Shinies** (Call of Legends SL1–11, HGSS) — sparkle holo.

## Already fine without new work

Base1–base5, gym1–gym2, neo1–neo4: cosmos holo covers every foil printing
those sets have (secrets/shinings included — they reuse the cosmos treatment
well enough at scan resolution).
