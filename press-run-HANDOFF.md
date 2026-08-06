# press-run.html — handoff

A standalone, single-file test bench for the print-sheet supply model described in
`collector-sim-design.md` (§3, §4, §5). No build step, no dependencies, no network. Open it in a
browser or drive it headlessly with jsdom.

**It is not a mock.** It builds real sheet layouts, permutes real cuts, maintains real cursors, and
tracks real populations to exhaustion. Every number it displays is computed, not authored. If you
change something and a rate moves, that is a real consequence, not a display bug.

---

## 1. What problem it solves

Trading-card packs are usually simulated by rolling dice per slot against a rarity table. That
approach cannot express finite supply: nothing stops the tenth-thousandth pack from containing a
card that "only 50 exist of."

This models the physical process instead. Cards live on **print sheets** at integer
**multiplicities**. A sheet is printed some number of times (**impressions**). Packs are cut from
the resulting continuous run. Pull rates are therefore *derived* from `multiplicity / sheet_size`,
and populations are exactly `multiplicity × impressions`. Supply is finite by construction rather
than by enforcement.

The bench exists to answer two questions the design document could not answer on paper:

1. Can real published pull rates actually be expressed as integer sheet layouts?
2. What breaks when you add mechanics (god packs) on top?

Both answers turned out to be interesting and are recorded in §7 below.

---

## 2. Running and testing it

Open `press-run.html` in any browser. There is no server.

**Always test through the DOM, not just the engine.** The functions below the
`/* rendering */` banner are as likely to break as the ones above it, and a bug was shipped
precisely because an earlier harness truncated the file at that banner and only exercised the
engine. Use this:

```js
const {JSDOM} = require('jsdom');
const fs = require('fs');
const errs = [];
const dom = new JSDOM(fs.readFileSync('press-run.html','utf8'), {
  runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w){ w.alert = ()=>{}; w.addEventListener('error', e=>errs.push(e.message)); }
});
const w = dom.window, d = w.document;
const click = s => d.querySelector(s).dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const set   = (s,v) => { d.querySelector(s).value = v;
                         d.querySelector(s).dispatchEvent(new w.Event('change')); };

// exercise every set × mode × god rate × open button
// then assert on errs.length === 0
```

Engine internals are reachable from inside the page via `w.eval("...")`, which is the fastest way
to run large statistical checks:

```js
w.eval(`
  commit('sv8pt5', 100000, 'structure', 4242, 0.00125);
  for (let i=0;i<100000;i++) openPack();
  window._out = { sir: (tally['Special Illustration Rare']||0)/opened, gods: godsOpened };
`);
```

The interactive controls are: `#setpick` (buttons, `data-set`), `#modepick` (buttons, `data-mode`),
`#npacks` (select), `#godrate` (select), `#recommit`, `#reset`, and `button.go` (`data-n` = packs to
open).

---

## 3. Architecture

Single `<script>`, four banner-delimited regions, in order.

### Primitives

| Function | Purpose |
|---|---|
| `mix32(x)` | 32-bit integer hash. Not cryptographic — production should use SipHash or HMAC. |
| `rng(seed)` | Seeded float generator, used only for shuffles. |
| `makePerm(C, seed)` | **Core mechanism.** Returns a keyed bijection on `[0, C)`. Four-round Feistel over the smallest even bit width covering `C`, with cycle-walking to stay in domain. Used twice: once per sheet over cut indices, once per run over pack indices. |
| `layoutSheet(entries, k, seed)` | Places `{id, mult}` entries into an array of positions such that no id repeats within any window of `k` consecutive positions, measured circularly. Greedy most-remaining-first, which satisfies the constraint whenever it is satisfiable, plus a wraparound repair pass. `k <= 1` shuffles instead. |
| `validateWindow(positions, k)` | Verifies the above. Run at commit; a pass means intra-pack duplicates are *structurally impossible*, not merely unobserved. |

### Set definitions

`pool(prefix, from, count, tier, pad)` generates card stubs. Three set builders —
`pitchBlack()`, `perfectOrder()`, `prismatic()` — return set objects (shape in §4). `SETS` maps
key → set.

### Netting

`netGodPacks(entries, slots, N, G, godCounts, cards)` de-rates a chase sheet so that adding god
packs does not change total supply. See §6.

### Engine

Module-level mutable state, reset by `commit()`:

```
S            // the committed run
opened       // packs opened this session
tally        // tier key → count, for observed rates
lastPack, lastCut, godsOpened, lastGod
```

`commit()` → `drawFromSheet()` → `openPack()` → `sheetRates()`. Detail in §5.

### Rendering

`renderAll()` fans out to `renderRun`, `renderExhaust`, `renderCommit`, `renderGod`, `renderStats`,
`renderStrip`, `renderPop`. All read from `S` and the tally; none mutate state. `boot(reuseSeed)`
wires the controls and re-commits.

---

## 4. Data model

### Set object

```js
{
  key, name, code, era, released,
  cardsPerPack, packsPerBox,        // packsPerBox null = not sold in booster boxes
  note,                             // shown in the UI; state provenance honestly here
  pools:  { IR, SIR },              // card arrays the god-pack builder needs
  cards:  { [id]: {id, tier} },     // flat lookup, includes energy
  modes:  { [key]: { label, desc, sheets, slots } },
  godPack: { doc, note, build(pools) } | undefined,
  published: { [tierKey]: ratePerPack }
}
```

### Modes

A **mode** is a complete pack template: its own sheets and its own slot list. Two exist because
some published rate tables cannot be expressed as integer slots (§7.2):

- `structure` — "slot-true". The documented pack shape, exact integer slots.
- `rate` — "rate-true". Reverse and hit slots pooled onto one sheet drawn `k` times.

Prismatic has only `structure` because its rates decompose cleanly and a second fit would be noise.

### Sheets and slots

```js
sheets: { [name]: { entries: [{id, mult, pattern?}], k, finish? } }
slots:  [ { sheet: name, count: n }, ... ]
```

`k` must equal the total slots drawn from that sheet in one pack. `pattern` on an entry
(`'reverse'`, `'pokeball'`, `'masterball'`, `'holo'`) overrides the sheet's `finish` and is how one
sheet carries several finishes of the same card. `finish` is the fallback.

**The reverse sheet is deliberately one sheet, not a weighted choice between sheets.** Standard
reverse, Poké Ball, Master Ball and ACE SPEC all live on it at different multiplicities. This
reproduces published rates within 2% *and* inherits the no-duplicates guarantee, which independent
weighted draws would not.

### God pack config

```js
godPack: {
  doc: 'confirmed' | 'authored',   // provenance — surfaced in the UI, do not fake it
  note: '...',
  build: (pools) => ({ sheets: {...}, slots: [...] })
}
```

Built lazily at commit so it can reference the set's card pools.

### Committed run (`S`)

```js
{
  def,          // set object with the active mode's sheets/slots merged in, plus godSlots
  base,         // unmodified set object
  nPacks, seed, hkey, revealed,
  G,            // god pack count, exact
  godFit,       // {ok, entries, scaled, freed} | {ok:false, reason}
  permGod,      // keyed permutation over pack index
  sheets: { [name]: {
    M, R, k, slots, gslots, positions, posPattern,
    cuts, cursor, perm, finish, tokens, leftover, check,
    issued: {}, total: {}      // keyed 'cardId|pattern'
  }}
}
```

---

## 5. Engine flow

### `commit(setKey, nPacks, modeKey, runSeed, godRate)`

1. Resolve the mode; merge god-pack sheets into the sheet set if `godRate > 0`.
2. `G = round(nPacks × godRate)`.
3. **Net god packs out of the chase sheet** (§6). If infeasible, `S.godFit.ok === false` and the UI
   refuses the run.
4. Per sheet: `M = Σ mult`; `draws = slots × (N − G) + gslots × G`;
   `R = ceil(draws / M)`; `k = max(slots, gslots)`; lay out positions; validate the window;
   build the cut permutation over `C = floor(M × R / k)`.
5. Record `total['id|pattern'] = mult × R` — the exact final population.
6. `seed` is random unless supplied. Same seed ⇒ byte-identical run.

### `drawFromSheet(sh, count)`

```
n     = sh.cursor++
cut   = sh.perm(n % sh.cuts)
start = (cut × sh.k) % (sh.M × sh.R)
card i = sh.positions[(start + i) % sh.M]
```

**`start` is an offset into the whole run (`M × R`); `positions` is one sheet (`M`).** Always take
`% sh.M` before indexing. This exact confusion caused a crash in the strip renderer.

### `openPack()`

```
isGod = S.G > 0 && S.permGod(opened % S.nPacks) < S.G
slots = isGod ? S.def.godSlots : S.def.slots
```

Draws each slot, tallies by `tierKey(pattern, tier)`, sets `pack.isGod`.

### `sheetRates()`

Returns the exact per-pack rate each sheet produces, independent of sampling — `slots × mult / M`
summed by tier key. This is the "Sheet" column in the stats table and the thing to assert against.
It skips god sheets (`if (!sh.slots) continue`), since those belong to a different template.

---

## 6. God packs

A god pack replaces an entire pack's contents with top-tier cards. Modelled as a **second pack
template drawn from its own sheets**, never as an upgrade roll — a per-pack roll would make the god
pack count a random variable and destroy finite supply.

Which packs are god packs is fixed by a second keyed permutation over the pack index:
`is_god(n) = π_god(n) < G`. Exactly `G` per run, O(1), no state, and pre-committed so the fairness
scheme covers god-pack positions for free.

### The netting rule — do not remove this

Total supply of a tier must not change when god packs are switched on:

```
(N − G) × r_chase(T) + G × c(T) = N × r₀(T)

⇒  r_chase(T) = [ N × r₀(T) − G × c(T) ] / (N − G)
```

`netGodPacks()` holds sheet size constant and hands the freed multiplicity to the filler tier
(Rare). It scales the whole sheet up by an integer factor when needed so every card in the reduced
tier still gets at least one position — Prismatic requires this, since 32 SIRs sharing 27 slots
would print zero copies of five of them.

**Why it matters:** published rates are reverse-engineered from pack-opening samples, so any
published rate already contains every mechanic that was live during that sample. Stack god packs on
an unmodified chase sheet and Prismatic's SIR rate goes from a published 1 in 45 to an observed
1 in 29, inflating top-tier population by a third.

**Feasibility:** if `godRate × c(T) > r₀(T)` the required chase rate is negative and no layout
exists. Prismatic at 1 in 250 correctly refuses to commit. This is a real constraint, not a bug —
a set's god pack design is bounded by the rest of its rate table.

---

## 7. Findings encoded in the file

Preserve these; they are the point of the exercise.

**7.1 Modern packs have two reverse slots.** Prismatic's standard reverse, Poké Ball, Master Ball
and ACE SPEC rates sum to 1.97 cards per pack. They compete for the same two slots; patterns are not
extra slots.

**7.2 Some published rate tables do not decompose into integer slots.** Perfect Order and Pitch
Black both sum to 2.94 cards across the reverse and hit slots, not 3. Forced into the documented
structure, their entire hit ladder lands ~11% under published while reverses run ~11% over — a
systematic offset reproducing on two independently sourced sets. Hence two modes. Prismatic
decomposes cleanly and has one.

**7.3 Sheets do not exhaust together.** Impressions round up independently, so run length is the
*minimum* cut count across sheets. Energy empties first on two sets, uncommons on the third.
Leftovers are small but nonzero.

**7.4 Value is not monotonic in rarity.** A Prismatic Master Ball (1 in 20 packs across a 67-card
pool) is rarer per specific card than that set's Hyper Rare.

---

## 8. Deliberate liberties

Flagged in the UI; do not silently "fix" them.

- **Card IDs are structural** (`PBL-120`), not named. The catalogue import supplies names; inventing
  them for a real set would be misleading. Numbering happens to match reality — Pitch Black's Mega
  Hyper Rare lands at #120, as it does in the actual set.
- **Some Ultra Rares and SIRs carry uneven multiplicity**, so a few are genuinely short-printed. No
  data source records this; real sheets do it.
- **Pitch Black's Rare and reverse rates are unpublished** and inherited from Perfect Order.
- **God pack recipes for the two Mega Evolution sets are authored, not documented.** `doc:'authored'`
  says so in the UI. Prismatic's is `confirmed`.
- **Sheet multiplicities are fitted by hand.** No source publishes them. They are the one layer of
  the file with no external ground truth.

---

## 9. Data provenance

| Layer | Source |
|---|---|
| Rarity counts, variant pool sizes | ThePriceDex (built on Scrydex) |
| SV/ME-era hit rates | TCGplayer pull-rate studies, 1,200–2,000 packs |
| Pitch Black hit rates | PullRates.com |
| Pack slot structure | PokéBeach set guides (prose, manual) |
| God pack rates and recipes | Community estimates, ~1 in 700–1,000 packs |
| Sheet multiplicities | Fitted here — no external source exists |

No official pull rate has ever been published for an English booster pack.

---

## 10. Invariants to assert against

Any change must keep all of these:

1. Full run to exhaustion ⇒ every `issued['id|pattern']` equals `total['id|pattern']` exactly.
2. Zero intra-pack duplicate `id` values, from the layout constraint alone.
3. `validateWindow` passes on every sheet in every set × mode configuration.
4. Pack size is constant (11 for all three sets), god packs included.
5. Committed `G` equals god packs actually opened, at every rate.
6. Observed rate of a god-supplied tier is invariant to `godRate` (Prismatic SIR holds at ~1 in 46.6
   with god packs off, at 1 in 2,000, and at 1 in 800).
7. Infeasible god configurations refuse to commit with a reason.
8. Same seed ⇒ identical run; different commits ⇒ different `hkey`.
9. Zero uncaught errors across every set × mode × god rate × open-button combination.

---

## 11. Not implemented

Condition, grading, marketplace, boxes and case structure, reprints, promos.

**The most significant gap is the replay half of provable fairness.** `sheet_key` is revealed at
sellout, but nothing re-derives the run from it to verify the reveal. That is the part a player would
actually be trusting, and it is the obvious next thing to build — it needs only a function that takes
`(seed, setKey, nPacks, mode, godRate)` and reproduces pack *n*, which `commit()` already supports
via its `runSeed` argument.

---

## 12. Known traps

- **Run-space vs sheet-space indexing.** `drawFromSheet` returns `start` as an offset into `M × R`.
  Anything indexing `positions` must apply `% M` first.
- **`sheetRates()` must skip god sheets** or god-pack contributions get double-counted into the
  normal template's rates.
- **`k` must match slot count.** A sheet used by both templates (energy) must draw the same count in
  each, or `k = max(slots, gslots)` silently mis-sizes the cut space.
- **Seeds must be random per commit.** An earlier version derived the seed from `setKey.length` and
  pack count, so "Commit new run" regenerated an identical run and appeared to do nothing.
- **Changing a set's rarity counts invalidates its fitted multiplicities.** They were fitted against
  specific pool sizes. Re-fit rather than assuming they still land.
