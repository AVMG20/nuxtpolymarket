# Collector Simulator — Design Doc

*Draft v0.4 — implementation-ready. Every open question from v0.3 is settled; the design is scoped to its actual host platform and playerbase (Appendix D).*

**What changed from v0.3.** All 23 open questions in the former §13 are resolved. The three that reshaped the rest of the document: packs are bought with the host platform's existing **gems** rather than an invented collector currency, which deletes the conversion-cap machinery entirely (§7.3); the **auto-battler ships in v1** rather than being deferred (§12); and the design is now scoped to a **seven-player playerbase**, which changes print runs by an order of magnitude and makes most of the anti-abuse machinery in §7.5 unnecessary. Provable fairness is cut (§3.4). Destructive attrition is cut (§7.4).

## 1. Goals

Simulate the experience of collecting a trading card game, with the parts that make real collecting interesting preserved rather than abstracted away:

- **Genuinely finite supply.** Every card that exists was "printed" as part of a bounded run. When a set is exhausted, it is exhausted forever.
- **Print-sheet-accurate pull rates.** Rarity emerges from how cards were laid out on print sheets, not from a `rand() < 0.03` check.
- **Variant patterns as first-class objects.** Reverse holo, Poké Ball pattern, Master Ball pattern, etc. are separate collectible entities with separate populations.
- **Physical condition and third-party grading**, including grader inconsistency and population reports.
- **Admin-authored sets**, with the ability to clone the structure of official sets as a starting point.

### Non-goals (v1)

- Actual TCG gameplay — deck building, energy, evolution, battling by the real rules. The auto-battler in §12 **ships in v1**, but it is a demand axis for the economy rather than a second product, and it is deliberately not the real game's rules.
- Any bridge between in-game currency and real money. See §9.
- **Provable fairness.** Cut deliberately (§3.4). The commitment is kept; the reveal is not.
- **Destructive attrition.** Cut deliberately (§7.4). Populations are permanent; scarcity is a supply-side property here, not a decay-side one.

### Scale

The whole design is now scoped to a known playerbase, and this changes more than it looks like it should. Numbers throughout the document assume:

| | |
|---|---|
| Players | **7**, not growing |
| Pack allowance | 4/day global across all live sets, no rollover |
| Friday bundle | 36 packs, claimable Fri–Sun |
| Peak throughput | ~450 packs/week platform-wide |
| Realistic throughput | ~250–300 packs/week |
| Print run *N* | ~1,000 (small set) to ~2,500 (flagship) |
| Live sets | 2 at launch, ~2 added per quarter |

The consequence worth internalising before reading §7: **at this scale a specific chase card has one to four copies in existence, forever.** That is not a tuning failure, it is the intended texture — but it means the market machinery in §7 was written for a game that does not exist here, and §7.5 in particular is now mostly inert. Where a mechanism only earns its place at scale, this draft says so rather than shipping it as dead code.

---

## 2. Core domain model

The central modeling decision: **a card and a variant are different things, and the collectible unit is the pair.**

```
Set        1 ──< Card        (number, name, rarity, artwork ref)
Card       1 ──< Printing    (card × finish × pattern × print_run)
Printing   1 ──< Copy        (an individual instance owned by a user)
```

- **Card** — one entry in the official checklist: "Armarouge, 041/198, Rare". Number, name, rarity symbol and artwork all come from imported set data and are **never varied**. Rarity in particular is a card attribute, not a variant axis (§5).
- **Variant** — *not* a single enum. It decomposes into three independent fields: **finish** (non-holo / holo / reverse holo), **pattern** (which foil — Cosmos, Mirage, Poké Ball, Master Ball…), and **print run**. Folding these into one enum, or mixing rarity in among them, is the modeling error that makes fan projects feel wrong.
- **Printing** — a (card, finish, pattern, print_run) tuple. This is the thing with a finite population and a market price.
- **Copy** — one physical instance. Has a serial, an owner, and immutable condition sub-scores.

Finish eligibility — which finishes a given card comes in — is **per-card data** on the checklist, not derivable from rarity (§5.1). Pattern eligibility is a **per-set matrix**, and has been set-specific since the EX era (§5.3). Recent sets have also diverged on *how* patterns are distributed: some treat alternate reverse patterns as guaranteed slot fillers, others as rare hits. <cite index="11-1">In some sets the patterns behave like ordinary reverse foils, with energy always in the first reverse slot and Poké Ball always in the second, rather than as "hits."</cite> The slot model in §4 needs to express both.

---

## 3. Finite supply: the print sheet model

This is the hardest part of the system and the part most worth getting right.

### 3.1 Why sheets

Real cards are printed on uncut sheets — a grid where each card appears some number of times. A pack pulls one card from each sheet. **Rarity is literally multiplicity on a sheet.** Adopting this directly gives us:

- exact, guaranteed final populations,
- pull rates that are a trivial consequence of the layout,
- an admin UI that is intuitive ("put 3 copies of Charizard on the 121-slot rare sheet"),
- and a natural place for reprints to live.

### 3.2 Structure

```
Sheet {
  id, set_id, size M          // e.g. 121 positions
  positions: [Printing; M]    // position → (card, variant)
  impressions R               // how many times this sheet was printed
  cursor                      // atomic; next token to hand out
}
```

Total tokens on a sheet: `T = M × R`. Card X with multiplicity *m* on the sheet ends up with exactly `m × R` copies in existence. Pull rate for X from that slot is exactly `m / M`.

### 3.3 Drawing without materializing 10 million rows

We want the whole print run pre-shuffled at set creation, but we don't want to store it. Use a **keyed pseudorandom permutation** over the index space.

**The unit that gets shuffled is the pack-cut, not the individual card.** This matters: a real pack is a vertical slice through a stack of cut sheets, so its *k* commons come from *k* adjacent positions. Shuffling individual cards instead would let one pack draw the same position twice and hand you two identical commons, which real packs don't do.

Concretely, treat the sheet's full run as a **circular sequence of `M × R` positions** (the *R* impressions concatenated end to end), divided into consecutive runs of *k*, where *k* is the number of slots that pack template draws from this sheet. Total cuts `C = M × R / k`. Choose *R* so this divides evenly, or let the tail be leftover.

At set creation, generate a secret `sheet_key`. Define `π: [0,C) → [0,C)` as a 4-round Feistel network keyed by `sheet_key`, using SipHash or truncated HMAC-SHA256 as the round function. For domains that aren't a perfect square power of two, use **cycle-walking**: build the Feistel over the smallest `2^(2k) ≥ C`, and re-apply until the output lands below `C`. Expected iterations under 2.

Drawing a pack's worth from a sheet:

```
n     = atomic_increment(sheet.cursor)      // one DB round trip
cut   = π(n)
start = (cut × k) mod (M × R)
cards = [ sheet.positions[(start + i) mod M] for i in 0..k ]
```

**Layout constraint.** No-duplicates is now a property of the sheet layout, enforced at authoring time rather than at draw time: *no card may appear twice within any sliding window of k consecutive positions on the circular sheet.* This is cheap to validate in the sheet designer (§8.1) and impossible to violate at runtime.

Properties this buys us:

- **Exact counts.** The shuffle is a bijection over cuts, so consuming the first *N* cuts consumes each position its proportional number of times. Card X with multiplicity *m* on a sheet with *k* pack-slots ends with `N × k × m / M` copies, exact to the rounding of the final partial impression (±1). Note this is **not** `m × R` — see the exhaustion rule below.
- **No intra-pack duplicates**, by construction.
- **O(1) storage and O(1) work per draw.** The only persisted state is a cursor.
- **No race conditions** beyond a single atomic increment (`UPDATE sheets SET cursor = cursor + 1 RETURNING cursor`).
- **Reproducible and auditable.** The entire print run's ordering is determined at creation.

**Exhaustion is defined by the pack count, not by a sheet.** The admin authors *N* packs; each sheet's impressions are derived as `R_j = ceil(N × k_j / M_j)`. The run ends when the *N*th pack is opened. Every sheet finishes mid-impression with tokens left on it, and **those tokens are destroyed, not drawn.** This is exactly how real print runs work — you print sheets, you collate packs, and the offcuts are waste.

Two consequences to hold onto:

- **Population is a function of *N*, not of *R*.** `pop(X) = N × k × m / M`, accurate to ±1 depending on where the run stops inside the last impression. The admin's authored population figures are therefore *targets accurate to ±1*, not guarantees, and the sheet designer must display the derived number rather than the ideal one.
- **God packs consume no base-sheet cuts** (§3.8), so a run of *N* packs draws `N − G` cuts from the base sheets. Size impressions against `N − G` or the run ends slightly late.

This replaces the earlier open question about which sheet defines exhaustion. There is no longer a minimum-across-sheets calculation and there are no stranded tokens to account for — there is leftover paper, which is thrown away.

**Emergent side effect: box mapping.** Because a cut's *contents* are fixed by layout and only *which cut you get* is random, players who log enough packs can start predicting what else is in a box. This is a real phenomenon in physical collecting and arguably a feature. If you'd rather defeat it, vary the cut alignment per impression — but note that mapping is part of what makes opening a box socially interesting.

### 3.4 Commitment, without reveal

**The key is never revealed.** Full provable fairness — publish `H(sheet_key)` at launch, reveal `sheet_key` at sellout, let anyone replay the run — is cut from the design. Two reasons, one practical and one structural.

The practical one is that seven players who know each other do not need a cryptographic trust mechanism against an admin who is one of them. The structural one is sharper: §3.5 fixes a pack's contents **at purchase**, and §7.3 makes sealed packs and bundles holdable indefinitely. Publishing the key would therefore make every unopened pack in the game computable at precisely the moment sealed product becomes interesting. Sellout is when a sealed bundle from that set becomes valuable, and it would also be the moment its contents stopped being a secret. Sealed speculation would die on the day it was born.

**The commitment is kept.** At set creation, hash the sheet layouts, the key, *N*, and the god pack count *G*, and publish the digest. It costs a few lines and it means the parameters are provably fixed even though nobody can derive the run from them. If verification ever matters later — a dispute, a new player, an accusation that a chase card was quietly reweighted — the option still exists. Without the commitment that door closes permanently.

What this cuts from the build: the reveal endpoint, the replay verifier, and the public-run-audit UI. Appendix C's note that replay verification is "the obvious next thing to build" no longer applies; it is out of scope rather than pending.

### 3.5 Sealed product

**Tokens are reserved at purchase, not at open.** Buying a pack atomically claims its token indices and stores them on the pack row; opening merely reveals them. Both single packs and Friday bundles (§7.3) are **holdable indefinitely** and tradeable while sealed.

This matters more than it looks. It means a sealed pack genuinely contains something specific, so:

- sealed packs and bundles can be traded as a gamble with real (simulated) provenance,
- supply locked in unopened product is actually locked, exactly as in reality,
- population reports can distinguish **known population** (opened) from **unaccounted** (still sealed) — which is precisely how real population data behaves.

**Sealed hoarding is the design's only supply sink.** §7.4 cuts destructive attrition, so nothing removes a card from the world once it is opened. What does remove supply is product that is never opened: a bundle sitting in someone's collection is 36 packs that may never enter circulation. At seven players with a ~2,500-pack flagship run, a couple of hoarded bundles is a meaningful fraction of a set held permanently off-market. That is voluntary, it is the collector fantasy rather than a penalty, and it costs nothing to implement because it is simply the absence of a forced-open rule.

**Concurrency note.** Claiming tokens is a read-then-write on the sheet cursor and must be a single guarded statement, not a `SELECT` followed by an `UPDATE` — see Appendix D. `UPDATE sheets SET cursor = cursor + k WHERE id = ? AND cursor + k <= limit RETURNING cursor` is the shape; a purchase that does not get a row back did not happen.

### 3.6 Reprints

**Sets sell out permanently.** When the *N*th pack is opened the set is gone from the shop and exists only on the secondary market. This is the load-bearing property of the whole design and nothing may quietly undo it.

Once a set is live, sheets are **frozen** — editing them would break every supply guarantee. Admins *can* authorise additional supply, and it is added the way it is added in reality: a **new print run** appended to the set, with its own `Printing` rows, its own population, its own price, and its own line in every population report. A reprint is never silently fungible with the original. First-run copies stay distinguishable from later ones forever, which gives you the "1st Edition" dynamic for free.

Two rules on top of that, and they are what make "admins can reprint" and "sets genuinely sell out" able to coexist:

- **A reprint must be visually distinguishable.** The authoring tool requires a cosmetic delta — a stamp, a border tweak, a date line (§5.4). A reprint players cannot tell apart gives the market two prices for one apparent object, and turns grading arbitrage from a skill into a trap.
- **A reprint is announced before it lands** (§11.4). It moves prices sharply and predictably, so an unannounced one is insider information handed to whoever watches the admin queue.

In practice reprints should be rare. Under the global pack cap (§7.3) attention concentrates on the newest set, so older sets tick down slowly and most never clear at all — which means the only sets that are candidates for a reprint are the ones that actually sold out, which is exactly the right filter.

---

**One deliberate exception.** Promos are outside this model entirely — no sheets, no committed run, minted on claim (§11.2). Everything in §3 describes pack-distributed cards only.

### 3.7 Alternatives considered

**Per-printing stock counters.** The obvious simpler design: give each printing a remaining-stock count and draw by sampling proportional to remaining stock. This is sampling without replacement, so it also yields exact finite populations and correct pull rates, with no sheets and no Feistel. It is less code.

Sheets were chosen anyway, for three reasons in descending order of weight:

1. **Rate and population become a single fact.** With counters you store stock and pull weight separately, and nothing prevents an inconsistent pairing — weights that exhaust a chase card after 10% of packs, leaving the remaining 90% structurally unable to contain one. That needs a validator. With sheets, multiplicity *is* both numbers, so the invalid configuration cannot be expressed. This is the real argument: it's architectural, not performance.
2. **Contention.** Sampling proportional to remaining stock requires a consistent view of the whole pool — a Fenwick tree or a pool-wide lock. Sheets collapse this to one atomic increment on one row.
3. **Pack coherence.** The cut model in §3.3 gives no-intra-pack-duplicates for free. Independent weighted draws need explicit dedup logic.

**The Feistel survives the cut of §3.4's reveal**, for three reasons that have nothing to do with verification. It keeps the commitment meaningful — the digest is only worth publishing if the ordering it commits to is genuinely fixed in advance. It gives O(1) storage and one atomic increment per draw, against a Fenwick tree or a pool-wide lock for the sampling alternative. And it preserves the option of revealing later, which is free to keep and impossible to add retroactively. The sheet model is worth keeping either way.

### 3.8 God packs

A god pack is a booster in which the entire contents are replaced by top-tier cards. They originate in Japanese high-class products and have since appeared in English — Prismatic Evolutions is confirmed, and the Black Bolt / White Flare recipe is nine Illustration Rares plus one Special Illustration Rare. Recipes are fixed per set, not rolled: VSTAR Universe gives five SARs and five ARs; Terastal Festival ex gives the nine Eevee-evolution SARs. Community rate estimates cluster around 1 in 700–1,000 packs, and no official figure has ever been published.

**Model a god pack as a second pack template drawn from its own sheets**, never as an upgrade roll on the normal one. A per-pack dice roll would destroy the finite-supply guarantee — the number of god packs in a run would be a random variable.

Instead, fix the count at commit and fix the positions with a **second keyed permutation over the pack index**:

```
G          = round(N × god_rate)          // exact, decided at commit
is_god(n)  = π_god(n) < G                 // π_god: [0,N) → [0,N), keyed
```

This gives exactly *G* god packs per run, O(1) with no additional state, and — because the permutation is committed before anyone opens anything — the fairness scheme in §3.4 covers god-pack positions for free. It is the same construction as §3.3 applied one level up: cuts within a sheet, packs within a run.

Three consequences follow.

**Normal sheets serve N − G packs.** A god pack consumes nothing from them. Impressions must be sized per template or the run overshoots.

**God packs must be netted out of the chase sheet, not stacked on top of it.** This is the important one. Total supply of a tier over the run must not change when god packs are switched on:

```
(N − G) × r_chase(T) + G × c(T) = N × r₀(T)

so   r_chase(T) = [ N × r₀(T) − G × c(T) ] / (N − G)
```

Hold sheet size constant and hand the freed multiplicity to the filler tier. That is the physically correct move: if god packs carry the top tier, the ordinary chase slot delivers it less often and delivers Rares more often. God packs redistribute *where* the top tier comes from, not *how much* of it exists.

Skipping this step is a real trap, and the reason is general. Published rates are reverse-engineered from pack-opening samples, so **any rate published from a sample already contains every mechanic that was live during that sample.** The TCGplayer study that produced Prismatic's 1-in-45 Special Illustration Rare figure opened 1,200 packs, which would have contained roughly 1.5 god packs and about 15 SIRs from them. Those are already inside the published number. Adding a god-pack channel on top of an unmodified chase sheet inflates the observed rate to 1 in 29 and the top-tier population by a third.

**God pack feasibility is bounded by the published rate of the tier in the recipe.** If `god_rate × c(T)` exceeds `r₀(T)`, the required chase rate goes negative and no valid layout exists. Prismatic at 1 in 250 fails: ten SIRs every 250 packs is 1 in 25 against a published 1 in 45, so god packs alone would supply nearly twice the set's entire SIR output. Pitch Black survives the same rate because its recipe targets Illustration Rares at 1 in 9 — a hundred times the headroom. **A set's god pack design is therefore constrained by the rest of its rate table**, and the authoring tool should reject infeasible configurations at commit with a reason attached rather than silently producing a set with inflated populations.

**God packs are in scope. *G* is authored per set and kept private.** The committed count is sealed into §3.4's commitment digest at set creation, so it cannot be adjusted mid-run to manipulate the market, but it is never published. Players cannot count down to it live.

This is what closes the one real objection to god packs. Publishing *G* is what would make depletion observable — once all *G* are known to have been pulled, every remaining sealed pack provably contains none, and late buyers of sealed product have measurably worse expected value that everyone can compute. That cuts directly against §7.2's hidden-supply premise. Keeping the count private preserves both the fixed-in-advance property and the market opacity, and it introduces no new kind of thing to trust: the trust model is the same as the sheet layout's — fixed at creation, opaque in the moment.

The exposure mostly does not arise anyway. Under the global pack cap most sets never approach exhaustion (§7.3), so the endgame where a remaining count becomes exploitable rarely arrives; and when a set genuinely does clear, a late-run frenzy is the market event §7.6 wants.

---

## 4. Packs and slots

A **pack template** is an ordered list of slots. Each slot draws from a *weighted selection of sheets*, which is what lets one model express both slot-guaranteed and hit-rate variants.

```yaml
pack_template:
  name: "Modern EN 11-card"        # 4C + 3U + 2 reverse + 1 hit + energy
  slots:
    - { count: 4, sheets: [{ common: 1.0 }] }
    - { count: 3, sheets: [{ uncommon: 1.0 }] }
    - { count: 2, sheets: [{ reverse: 1.0 }] }  # one sheet, all patterns on it
    - { count: 1, sheets: [{ chase: 1.0 }] }    # scales Rare → Mega Hyper Rare
    - { count: 1, sheets: [{ energy: 1.0 }] }   # not part of the 10
```

**Correction to the earlier draft: modern packs have two reverse slots, not one.** Prismatic Evolutions is explicit about it, and the arithmetic confirms it — its standard reverse, Poké Ball, Master Ball and ACE SPEC rates sum to 1.97 cards per pack. Those four things **compete for the same two slots**; the patterns are not additional slots bolted on. ACE SPEC in particular is housed in the first reverse slot.

**Put all reverse patterns on one sheet rather than selecting between sheets by weight.** The earlier draft modelled the reverse slot as a weighted choice among `reverse_standard`, `reverse_pokeball` and `reverse_masterball`. A single sheet carrying all patterns at appropriate multiplicities is strictly better: it reproduces the published rates to within 2%, and it inherits the §3.3 no-intra-pack-duplicates guarantee for free, which independent weighted draws do not. A fitted Prismatic reverse sheet of 2,683 positions — standard at multiplicity 21, Poké Ball at 4–5, Master Ball at 1, ACE SPEC at 11 — lands a specific Master Ball at 1 in 1,341 against a published 1 in 1,362.

<cite index="47-1">From Scarlet & Violet onward the rare slot is guaranteed to be at least a holo rare</cite>, which is a change from earlier eras where it was often a plain rare — so this is a per-era template property, not a constant.

**Slot structure is per-set authored data with no structured source.** No API carries it. PokéBeach set guides are the only reliable description, and they are prose. Budget for manual entry of one pack template per set, and treat it as a first-class authoring step rather than a derived value.

Templates must be genuinely configurable, because pack structure varies enormously by region and era. Japanese packs are a different shape entirely: <cite index="48-1">roughly three commons and one uncommon, with a fifth variable slot carrying the hit</cite>. Anything hard-coded to the English ten-card layout will need tearing out the first time you author a Japanese-style set.

The **chase sheet** is where the rarity ladder actually lives — a single sheet holding everything from ordinary rares up to the top tier at appropriate multiplicities. Real published rates for a recent set give a sense of the shape: <cite index="45-1">roughly one Double Rare in 5 packs, one Illustration Rare in 9, one Ultra Rare in 18, one Special Illustration Rare in 72, and a Mega Hyper Rare around one in 1,250</cite>. Those fall out of sheet multiplicities rather than being stipulated.

### Published rate tables do not always decompose into integer slots

This is the single most useful finding from building the reference implementation, and it needs a policy.

A sheet model forces every slot to be an integer and every sheet's multiplicities to sum to its size. Published rate tables carry no such constraint, because they are measured per pack rather than derived from a structure. The two do not always reconcile.

- **Prismatic Evolutions decomposes cleanly.** Its rates fit 4C + 3U + 2 reverse + 1 hit + 1 energy with every tier landing inside 5%, most inside 2%.
- **Perfect Order and Pitch Black do not.** Their published rates sum to 2.94 cards across the reverse and hit slots, not 3. Force the documented structure and the entire hit ladder comes in about 11% *under* published while reverses run 11% *over* — a systematic offset, not sampling noise, and it reproduces identically on both sets.

**The policy is slot-true, globally.** Every sheet is a plausible size with integer multiplicities, the documented pack structure is preserved, and the resulting rates are whatever the layout produces. Rate-true — pooling the reverse and hit slots onto one sheet drawn *k* times, which reproduces published rates inside 3% at the cost of the guaranteed hit slot — is **not** an output mode.

Two consequences follow, and both are improvements:

- **Published rates become a diagnostic, not a target.** The sheet designer shows authored rate against published rate side by side with the delta. An admin seeing 1 in 1,290 against a published 1 in 1,362 gets to decide whether that is close enough. It is information, never a validation failure.
- **Rate-fitting survives as an authoring aid.** The reference implementation's fitter is still the right way to *generate* a starting layout — "here is the integer layout on a 121-slot sheet that lands closest to this published rate" — after which the admin adjusts by hand. What is gone is rate-true as a guarantee about the output.

The honest cost is that chase rates will sit a few percent off anything a player could look up. Given that nobody can look up *your* set's rates — you are the printer — this is a good trade, and being able to say "these are the actual sheets, go count them" is worth more than matching a figure that was itself reverse-engineered from someone else's 2,000 packs.

Note that this is §3.7's argument arriving from the other direction. Per-printing stock counters would have accepted any of these tables without complaint. The sheet model cannot express an inconsistent configuration, so the inconsistency surfaces at authoring time — which is the whole point.

**Pack count derivation.** *N* is the primary authored number and everything else derives from it (§3.3). The admin sets a target pack count; the tool computes required impressions per sheet as `R_j = ceil((N − G) × k_j / M_j)` and reports the leftover tokens that will be destroyed.

**Derive *N* from cadence, not the other way round.** Total platform throughput is fixed at roughly 450 packs/week at maximum participation and 250–300 realistically, *regardless of how many sets are live* — the pack cap is global (§7.3), so a new set does not add capacity, it divides it. Therefore:

> **Minimum viable cadence = *N* ÷ total weekly throughput.**

Release faster than that and the backlog grows without bound: sets pile up half-consumed, sellout stops happening, and the finite-supply premise quietly stops meaning anything. That is the failure mode to design against, and it is the opposite of the real game's — The Pokémon Company prints to demand and can let a dozen sets be simultaneously available; this design cannot.

Working numbers at two live sets and a quarterly cadence:

| | Small set | Flagship |
|---|---|---|
| *N* | ~1,000 | ~2,500 |
| Commons (multiplicity 1 on a 120-slot sheet, k=4) | ~33 copies | ~83 copies |
| Specific Master Ball (1 in 1,341) | 0–1 copies | 1–2 copies |

Two things fall out that need to be said plainly rather than discovered. **Six-copy merges (§12.2) are comfortable for commons and impossible above Rare**, which is exactly the pay-to-win defence §12.2 wants, arriving from the supply side. And **master set completion may simply never happen for a given set** — with chase populations of one or two, at most one or two players can ever hold the required copies. §11.1's tracker should therefore treat core checklist completion as the real goal and master completion as an aspiration that may go unfulfilled, which is also true of real modern Pokémon, where almost nobody master-sets an expansion.

The sheet designer must show the projected sellout date live, recomputed against actual burn rate as the run progresses. That projection is not just an admin tool: "42% consumed, projected sellout in six weeks" is the signal that makes speculation legible rather than blind, and it should be public.

**Boxes are the Friday bundle.** There is no separately purchasable booster box SKU. The 36-pack bundle in §7.3 *is* the box, and it arrives as a weekly ritual rather than a shop decision — which is a better fit for a seven-player group than a purchase would be, because it synchronises everyone onto the same evening.

Mechanically a bundle is 36 consecutive pack purchases: tokens reserved at claim (§3.5), holdable sealed, tradeable as a unit. **Box guarantees are deferred**, not cut. Real sets ship exactly this — <cite index="42-1">in the Japanese SV2a set, every booster box contained precisely one Master Ball reverse holo, drawn from 153 possibilities</cite> — and the mechanism is a bundle-level constraint that reserves tokens across the 36 packs and re-rolls at allocation. It interacts awkwardly with the clean token model in §3.3 and it is not needed at launch. Revisit once bundles are live and it is clear whether a guarantee would improve the Friday reveal or flatten it.

### Calibration

Ship defaults derived from community-collected pull-rate data for the era being emulated, and treat every number as admin-tunable. Published rates genuinely disagree — for the same current top tier, sources put it anywhere from <cite index="43-1">about 1 in 220 packs</cite> to <cite index="18-1">as low as 1 in 1,260</cite>, depending on set, region, and whose sample you trust. There is no canonical number to hard-code. Store rates as set-level data with a provenance note, not as constants:

```
rate_entry = {
  set_id, pattern, tier,
  value,                    // per-pack probability
  source,                   // "tcgplayer-study" | "community-aggregate" | "inherited" | "derived"
  sample_size,              // packs, where known
  observed_at, region
}
```

The provenance fields are not bookkeeping. A 1-in-3 Poké Ball figure from a 1,200-pack TCGplayer study and a 1-in-1,250 top-tier figure from a 500-pack community log differ by orders of magnitude in confidence and must not be stored identically. New sets ship with no rate data at all for weeks — Pitch Black released 17 July 2026 and still had no rate table on the main aggregator two weeks later — so `source: "inherited"` from the previous set in the same era is a necessary and honest state, not a placeholder.

**Store rates at pool granularity, never at pattern × rarity.** Aggregators present per-tier breakdowns of pattern rates, but those are arithmetic rather than measurement: a Poké Ball pool of 100 cards at an aggregate 1-in-3 mechanically yields 1-in-14.4 for its 21 Rares and 1-in-6.6 for its 46 Commons. The tier rows carry no information beyond the aggregate and the pool size. Store `{pattern → pool, rate_per_pack, provenance}` and derive the rest.

---

## 5. Variants

**Rarity is a property of the card, not a variant axis.** The rarity symbol is printed on the card and is part of its identity in the official checklist — Card #041 in a set *is* a Rare, and that never varies. It comes in with the imported set data and is never authored or rolled.

What varies is the **finish**, and this is confirmed by the marketplace taxonomy itself: <cite index="53-1">a reverse holo is foil on every part of the card except the illustration, and this changes only the physical appearance — not the rarity, and not the collector number.</cite>

So a card's identity is the checklist entry, and a *printing* adds three things on top of it:

| | What it is | Example |
|---|---|---|
| **Card** (fixed) | Checklist entry: number, name, rarity symbol, artwork. Imported, never varied. | Armarouge, 041/198, Rare |
| **Finish** | Where the foil sits. The main variant axis. | non-holo, holo, reverse holo |
| **Pattern** | *Which* foil. Era default, per-set overrides. | Cosmos, Tinsel, Mirage, Master Ball |
| **Print run** | Which physical printing. | 1st Edition, Shadowless, Unlimited |

The consequence collectors care about: <cite index="51-1">the same card number can exist in more than one finish, which is why a master set is larger than the numbered checklist — you are collecting each finish, not just each card.</cite>

### 5.1 Finish eligibility

Which finishes a card comes in is **not uniform** — it depends on the card's rarity and the era. The modern rule of thumb: <cite index="51-1">commons and uncommons come as non-holo plus reverse holo; rares often come as holo plus reverse holo; special rares such as ex, illustration rares and secret rares are usually a single premium finish.</cite>

A real example from Scarlet & Violet base, which shows all three shapes in one set: <cite index="56-1">Armarouge 041/198 exists as both Rare (Holo) and Rare (Reverse Holo); Gyarados ex 045/198 is Double Rare with a single finish</cite>; commons sit at non-holo plus reverse.

Note the era dependence — in older sets, rares were commonly non-holo with separate Rare Holo cards on the checklist, so "Rare ⇒ holo" is a modern rule, not a universal one. Never derive eligibility from rarity.

**Author eligibility as a per-set predicate, not as per-card flags.** Sets specify it as a rule, and the rule is short. Prismatic Evolutions: every card in the main set except Pokémon ex and ACE SPEC gets a standard reverse and a Poké Ball reverse, including Trainers; only regular Pokémon excluding ex get a Master Ball; the eight basic Energy are reverse-eligible as plain sheen holos. Three clauses generate a 100 / 100 / 67 matrix over 180 cards. Storing 180 rows of booleans instead is more data, less legible, and unverifiable.

**Validate the predicate against a published variant count.** This is cheap and it catches real errors. Sources disagree on eligibility more often than you would expect, and the arithmetic settles it:

- Pitch Black is reported by two independent sources as 120 cards / 194 variants, which is 120 + 74 — Common, Uncommon and Rare only. A third source states the master set is 204 cards, being 120 plus 84 reverse holos "one for each Common, Uncommon, Rare, and Double Rare".
- Perfect Order's 124 cards / 203 variants gives a reverse pool of 79 = 44 + 24 + 11, with no Double Rare. Prismatic excludes ex from reverse for the same reason.

So the third source is wrong, and the variant count found it in one line of arithmetic. Make the count a required field on an imported set and fail the import when the predicate does not reproduce it. Per-card overrides then exist only for genuine exceptions.

**This imports for free.** The card object exposes finish availability directly: <cite index="58-1">the price types available are normal, holofoil, reverseHolofoil, 1stEditionHolofoil and 1stEditionNormal.</cite> Which keys are *present* on a card tells you which finishes that card exists in. One normalisation note: <cite index="63-1">Unlimited and Unlimited Holofoil printings are identical to Normal and Holofoil, used only for products that also have 1st Edition printings</cite> — collapse them on import.

There is also a genuine edge case worth handling: <cite index="53-1">deck-exclusive and league promo reprints keep the original expansion symbol and collector number but can change rarity — a Rare Holo reprinted as a Rare, or a Rare reprinted as a Rare Holo with a different foil pattern from the set's other holos.</cite> So "same number, same set, different rarity" is rare but real. Let rarity live on the printing as an optional override of the card's value, defaulting to inherit.

### 5.2 The rarity vocabulary is era-scoped data

Rarity doesn't vary per card, but the *set of possible rarities* grows constantly, so it can't be an enum in code. <cite index="21-1">Base Set had three rarity tiers and a single foil treatment; the current Mega Evolution series uses more than a dozen classifications.</cite>

Current (Mega Evolution era) ladder, by symbol: <cite index="44-1">circle for Common, diamond for Uncommon, black star for Rare, two black stars for Double Rare, two silver stars for Ultra Rare, one gold star for Illustration Rare, two gold stars for Special Illustration Rare, three gold stars for Hyper Rare, and a pink star for ACE SPEC Rare</cite> — plus two tiers newer than that:

- **Mega Hyper Rare** — <cite index="18-1">fully gold-embossed cards showing front-facing Mega Evolved Pokémon, given their own rarity symbol</cite>. Typically only two per set, which makes any specific one the rarest card in a modern set.
- **Mega Attack Rare** — <cite index="18-1">introduced with Ascended Heroes in January 2026, marked by two pastel stars, one pink and one green</cite>.

And it keeps moving: <cite index="19-1">Paldean Fates added shiny rarity symbols; Black Bolt & White Flare introduced Monochrome Rares</cite>, and <cite index="25-1">a set launching in September 2026 introduces an opalescent effect whose symbol has not yet been confirmed</cite>. Japanese sets use a parallel and non-matching scheme (R, RR, AR, SR, SAR, UR, MUR).

**Implication:** rarity values are *reference data* with an ordering and a symbol asset, extended per era. Rarity determines which sheet a card sits on (§4) — that's its mechanical job — but it is read from the card, never assigned.

### 5.2 Foil patterns are era defaults with per-set overrides

Each era has a default holo pattern, and collectors use it to date a card. The registry:

| Pattern | Era |
|---|---|
| Starlight / Galaxy Star | Base Set, Jungle, Fossil |
| Cosmos / Galaxy | <cite index="31-1">Base Set 2 through Call of Legends</cite> |
| Tinsel | <cite index="27-1">Black & White through Legendary Treasures</cite> |
| Sheen / Mirror | <cite index="27-1">XY era, with the diagonal refraction differing between Japanese, Korean and international printings</cite> |
| Water Web | Sun & Moon |
| Mirage | <cite index="31-1">Introduced with Scarlet & Violet; like Sheen but refracting horizontally, with holofoil silver borders on standard holos</cite> |
| Cracked Ice | <cite index="29-1">Theme deck exclusives and blister pack promos</cite> |
| Crosshatch | <cite index="27-1">Play! Pokémon event prizes</cite> |
| Sequin, Confetti | General Mills and McDonald's promo distributions |

### 5.3 Reverse holo: per-set patterns are not new

Worth correcting an assumption in the earlier draft. Poké Ball and Master Ball patterns are a *revival*, not an invention — set-specific reverse treatments date to the EX era, where <cite index="31-1">EX FireRed & LeafGreen used an energy-symbol pattern with a faint Poké Ball in the attack box, EX Deoxys used a pinwheel, EX Emerald used Poké Balls and stars, and EX Unseen Forces used a 3D Poké Ball</cite>. <cite index="46-1">EX-era reverse holos also carried a stamp of the expansion logo in the bottom right of the picture.</cite>

Timeline: <cite index="46-1">reverse holos began with Legendary Collection</cite> and <cite index="47-1">became a standard guaranteed slot from EX Sandstorm in 2003 onward</cite>.

**Implication:** the reverse pattern set is a *per-set property from the beginning*, not a modern exception bolted onto a global default. Build it that way and the EX era, the Prismatic Evolutions era, and whatever comes next all drop in without a schema change.

### 5.4 Print run as a collectible axis

This is where §3.6 pays off, because the real game already works exactly this way. Base Set exists as sequential print runs distinguished by cosmetic detail: <cite index="40-1">1st Edition carries a stamp and no drop shadow, Shadowless has neither stamp nor shadow, Unlimited has the shadow</cite>, with the copyright line as a secondary tell and a fourth print distinguishable by a 1999–2000 date.

The market consequence is large: <cite index="39-1">a 1st Edition Base Set Charizard commands roughly ten times its Unlimited counterpart, with Shadowless landing four to six times above Unlimited</cite>.

Two details worth stealing:

- **Print runs are visually distinguishable.** That's what makes them tradeable as separate objects. When an admin authors a reprint, the tool should require a cosmetic delta — a stamp, a border tweak, a date line. A reprint that looks identical is just inflation.
- **Master set definitions get messy, and that's good.** <cite index="38-1">Grading services treat 1st Edition Base Set as a 103-card set rather than 102</cite>, because of a single card that exists in two forms within the same run. Let master-set definitions be authored data with exceptions, not computed from a card count.

### 5.5 Two axes the earlier draft missed

Reviewing a mature schema (Appendix A) surfaced two collectible dimensions not in the model above.

**Stamps.** A printing can carry one or more stamps applied on top of an otherwise identical card: pre-release, staff, Pokémon Center, retailer stamps (GameStop, EB Games), seasonal ones (snowflake advent calendar, trick-or-trade Halloween), competitive ones (Ace Trainer, player rewards, Worlds by year, and placement stamps like finalist or top-sixteen), and a long tail of named-player and event stamps. The reference enum runs to roughly 150 values.

Two properties matter for the model:

- **Stamps are a list, not a value.** One card can carry several — a pre-release card given to staff has both the set-logo stamp and the staff stamp.
- **Stamps are orthogonal to finish and pattern.** A stamped holo is a distinct printing from both the unstamped holo and the stamped non-holo.

So `Printing` becomes `(card, finish, pattern, print_run, stamps[])`. Stamps are also the most natural hook for authored sets — a promo stamp is a cheap, legible way to make a limited printing feel special without new artwork.

**Error variants.** Misprints are a real collectible category and are enumerated in reference data as printing subtypes: missing HP, evolution box errors, ink dot errors, energy symbol errors, shifted energy costs, wrong card backs, rarity errors, and stamp errors. This connects to the print-run model in §3.6 — a genuine error affects a *portion* of a run, which is exactly what the sheet model can express (one bad position on one sheet). Optional for v1, but it's a well-shaped feature: near-zero implementation cost, high collector appeal, and it makes low-population chase items that aren't just "the rare one."

### 5.6 Consequences for the model

- **Eligibility has two levels.** Finish eligibility is per-card data imported with the checklist; pattern eligibility is a per-set matrix. Neither is derivable from rarity.
- **Value is not monotonic in rarity.** <cite index="13-1">Master Ball versions are dramatically rarer than ordinary reverse holos and routinely outprice even the regular holo of the same card, by as much as 10x.</cite> A common with the right pattern beats a holo rare. Price on population and demand, never on `f(rarity)`.
- **Master set completion is the endgame.** <cite index="10-1">A set carrying three reverse patterns requires four copies of every regular Pokémon.</cite> Make the tracker first-class; it's the strongest retention mechanic real collecting has.
- **Texture is a flag, not a pattern.** Modern top-tier cards are physically embossed. It affects perceived value and, realistically, how wear presents — so it feeds §6.1's condition distribution.

---

## 6. Condition and grading

### 6.1 Hidden sub-scores

At the moment a copy is generated, roll four hidden continuous attributes, each on [1, 10]:

`centering_front`, `centering_back`, `corners`, `edges`, `surface`

Draw from Beta distributions with per-set quality parameters, so a "1999-era" set can be authored with genuinely worse centering than a modern one. These values are **immutable** — a copy's physical condition is fixed at creation. Only the *knowledge* of it changes.

**There is no derived condition label.** No NM / LP / MP readout, anywhere in the UI. A card's condition is expressed *only* as marks rendered on the card itself, and the player has to look. If you want a number, you pay a grader for one.

This is the right call and it changes the shape of the whole game. Condition assessment stops being a readout and becomes a **skill**. It gives grading a real job rather than a cosmetic one. And it makes every raw card a small inspection problem, which is the actual texture of collecting.

### 6.2 Rendering condition

Each sub-score drives a procedural overlay on the card render, seeded by a hash of the copy's identity — `H(copy_serial, flaw_salt)` — so **the same card always looks identical, on every client, forever, with no rendered asset stored anywhere**:

| Attribute | Visual expression |
|---|---|
| Centering | Artwork offset within the border. Objectively measurable by eye. |
| Corners | Whitening, softening, fraying at the four corners. |
| Edges | Whitening and nicks along the border edges. |
| Surface | Scratches, print lines, dimples, loss of gloss. |

**The inspection interaction is the feature.** At minimum: zoom, and a **tilt / light-angle control**. Surface scratches and print lines should only catch the light at certain angles, exactly as they do in the hand. This is worth building properly — it's the moment-to-moment texture of the game, it makes foil patterns (§5.2) visually meaningful, and "tilting a card under a lamp" is instantly legible to anyone who has ever done it.

**Two things are separated deliberately: the flaws are fixed and stored; the lighting is a function of the tilt.** Sub-scores are rolled at creation and written to the Copy row, because §6.4's grader reads them and the 9/10 boundary depends on the actual numbers. The hash then drives *placement and appearance* given those scores — where exactly the whitening sits, how the scratch runs, the shape of the print line. Light position is driven purely by the angle the player is holding the card at, so the same tilt always shows the same thing.

This is the alternative to varying the render per viewing session. Per-view noise — different glare each time you open the card — was considered as a way to make the 9/10 call a judgement rather than a memorisation problem, and it was rejected: a player who sees a scratch, screenshots it, comes back and cannot find it reads the game as broken, not the card as hard to judge. Tilt-driven lighting gets the same effect honestly. A card you do not work over hides flaws that a card you do reveals, so the skill sits in the inspecting rather than in the luck of the viewing, and nothing ever reads as flaky.

**Centering gets a measuring tool; nothing else does.** Centering is genuinely objective in real life — anyone with a ruler can measure it — so give players an overlay that reports the ratio. Corners, edges and surface are judgment calls and stay visual-only. This split mirrors reality and gives inspection an internal structure: one thing you can *know*, three things you can only *estimate*.

### 6.3 Detectability: the render must be lossy

The critical tuning problem. If the render carries full information, a careful player computes the grade themselves and grading is pointless. If it carries too little, inspection is theatre and everything is a coin flip.

The principle: **visual inspection should reliably separate grade bands, but not resolve within the top band.** A beaten-up card must look beaten up. A 4 and an 8 should never be confusable. But a 9 and a 10 should be genuinely indistinguishable by eye — which is precisely the boundary where real collectors give up and pay a grader, and precisely where the money is.

So the render is a deliberately lossy channel. The player sees `visual(subscores)` with information discarded. The grader sees `subscores + noise`. **Neither is ground truth**, and a skilled player can narrow the range without ever pinning it.

One constraint this imposes: the render must never *contradict* the grade. A card that looks pristine and returns a 6 reads as broken, not as suspenseful. Large flaws are always visible; only marginal distinctions hide.

**Private tags, not public labels.** For inventory management, let players annotate their own copies with their own assessments. Their notes, their judgment, possibly wrong. This solves the UX problem of managing thousands of cards without the system ever handing out an authoritative number.

**The lossiness itself is a playtest parameter, not a designed constant.** The principle above is settled; the exact amount of information the render discards is not, and cannot be settled by analysis. Seven players is too few for anything statistical and entirely enough to tune this by hand: ship a first cut, watch whether people can call 9s from 10s, and move the parameter. Instrument it — log every submission's predicted grade (from the private tag) against the returned grade, and the gap between them *is* the measurement.

**Vision bots are not a threat model here.** §7.5's earlier concern — that a deterministic client-readable render invites a model trained to extract sub-scores — assumed an anonymous playerbase and a public API. There is neither (§7.5, Appendix D). This is why the deterministic render costs nothing: the defence it would have provided is not needed, so the choice can be made on inspection quality alone.

### 6.4 The grading service

Give it a fictional name — a joke that gestures at the real graders reads better than a straight clone anyway, and sidesteps the trademark problem entirely. The convention to play off is the three-letter grader (PSA, BGS, CGC, SGC, TAG), and the terminology worth borrowing is "Gem Mint" for the top grade.

Submission flow: pay a fee in Coins → card enters a queue with a real time delay → returns slabbed with a grade and a cert number.

**Turnaround is 24 hours.** Long enough that submitting is a commitment you cannot take back, short enough that a seven-player group is not waiting a week on one card. Where possible, schedule returns to land near the Friday bundle window (§7.3) so openings and reveals share a rhythm. The delay is doing real work: §10.3's return ceremony only lands because you waited for it, and the wait is the period in which you have committed and cannot change your mind.

**Price the fee as a percentage of declared value, not flat** (§7.3). Real graders do exactly this; it makes grading a sink that scales with the market rather than shrinking against it; and declaring low to save money while capping your own recourse is a genuine decision rather than a formality.

Grade computation, PSA-like in that the worst attribute dominates:

```
raw      = 0.6 × min(subs) + 0.4 × mean(subs)
observed = raw + Normal(0, σ)        # σ ≈ 0.4
grade    = clamp(round(observed), 1, 10)
```

The noise term is the important part. It means a borderline 9/10 card genuinely returns different grades on different submissions, which creates the **crack-and-resubmit** loop that dominates real high-end collecting. Cracking a slab should carry a small chance of damaging the card, so the gamble has teeth.

**Premium tier: sub-grades.** Offer an expensive service level that returns the individual attribute scores, the way BGS does and PSA doesn't. This is more than flavour — sub-grades reveal ground truth for that one card, which lets a player calibrate their own eye against it. The premium tier is effectively *buying training data for your own judgment*, which is a progression mechanic that costs nothing to implement and rewards exactly the skill the game is about.

### 6.5 Population reports

Track `(printing, grade) → count` globally and expose it. "Population 4, none higher" is one of the most powerful value signals in real collecting and costs almost nothing to compute here.

Note that this now falls out correctly on its own: **population reports can only cover graded cards**, because graded cards are the only ones with a known condition. Raw population is genuinely unknown, and sealed population (§3.5) is unknown on top of that. This is exactly how real population data behaves, and it means the reports understate true supply in a way players have to reason about rather than look up.

---

## 7. Economy and marketplace

The marketplace is a core pillar, not a convenience feature. Most of the long-term fun lives here: price discovery, speculation, the chase for a specific card, grading arbitrage, and cornering a low-population printing. The design should optimize for *making those things skill-expressive* rather than for frictionless transacting.

### 7.1 Market structure

Four transaction types, each doing a different job:

| Type | Job |
|---|---|
| **Fixed-price listings** | Baseline volume. Seller names a price, buyer takes it. |
| **Standing buy orders** | The bid side. "I'll pay 400 for any NM copy of X." |
| **Auctions** | High-value singles and sealed product. Creates events and drama. |
| **Direct trade offers** | Card-for-card (± Coins). The social heart of collecting. **Kept deliberately** — see below. |

**Everything on this market is priced in Coins**, the host platform's currency (§7.3). Gems buy packs; Coins buy cards. The whole grading-arbitrage loop — buy raw, pay to grade, sell slabbed — therefore stays in one unit with no conversion mid-loop.

**The bid side is the piece most projects skip and shouldn't.** Without standing buy orders, the market is a classifieds board: there is no visible floor, dumping bulk is miserable, and price discovery only works in one direction. With them you get a live order book, an obvious "what is this actually worth right now" signal, and instant liquidity for sellers who don't want to babysit listings.

**Directed trades stay, and anonymity is not attempted.** Removing the ability to choose a counterparty was considered as a structural defence against alt-account self-dealing, and rejected. It does not work: an alt never needs to trade to its operator, it can simply sell into the open market and receive Coins, which are the host's currency and move by the host's rules. What it *would* have cost is real — card-for-card swaps are the social heart of collecting, and at seven players they are more of the market than the order book is. Alt accounts are accepted as a cost of a Coin-denominated market (§7.5).

**Fungibility: the raw/slabbed split.** Hiding the condition label (§6.1) has a large and welcome consequence here — it splits the market cleanly in two:

- **Slabbed cards are fungible.** Grade is public and certified, so `(printing, grade)` is a sufficient key. These trade on the order book, auto-match, and behave like a commodity.
- **Raw cards are not fungible.** There is no condition key to match on, because condition is only knowable by looking. Every raw card is a unique inspection problem and therefore a **unique listing only** — never auto-matched, never blind-filled.

This is worth stating as a design win rather than a limitation. It gives grading a real economic function beyond number-go-up: **grading converts an illiquid unique item into a liquid commodity.** That's the actual reason people grade in real life, and here it falls straight out of the condition model.

Standing buy orders therefore only exist for slabbed cards, and low-serial copies (§7.6) are excluded from the book even when slabbed.

**Buyers must be able to inspect before purchase.** Every raw listing shows the real card render with full zoom and tilt, not a stock image, and the copy's ownership chain (§11.3) alongside it. Without this, buying raw is a lottery rather than a skill, and the entire §6 design collapses into a slot machine. Sellers may *claim* a condition in listing text; claims carry no authority and can be wrong. Caveat emptor is fine precisely because inspection is available.

**Bulk lots** are a first-class listing type, sold explicitly as unsorted and uninspected. Selling 500 assorted commons as one unit has to be as easy as selling one card, or low-value cards silently become unsellable and clog every collection in the game. This also creates a genuine niche: buy bulk cheap, inspect patiently, pull the gems, resell. Card searching is a real hobby activity and here it's a real strategy.

### 7.2 Price discovery

Expose a lot of data. Rich public information is what turns speculation from a coin flip into a skill:

- Last sale, trailing 7/30-day trimmed median, volume, spread between best bid and best ask
- Full price history chart per `(printing, grade)`
- Population report alongside price — "pop 12, 3 in grade 10" is doing as much work as the price itself
- Want lists with alerts ("notify me if a grade-9 copy lists under 400")

**Price indices only work for slabbed cards.** Raw sales have no condition key, so a raw price history is a mixture of unknown quality and averaging it produces a misleading number. Show raw sales as a scatter with an explicit "condition unknown" marker rather than a single index line — or don't index them at all. The honest signal is a range, not a price.

This asymmetry is itself interesting: the graded market has clean public prices, the raw market is fog. Moving a card from one to the other is what grading does.

**Prices are set by the wealthiest cohort, and that is not a bug to fix.** The market is Coin-denominated and Coins are uncapped, so every quoted price reflects what the richest account will pay. This is true of real card markets too. It does mean no progression path may depend on affording a market price — pack allowance, promo claims and achievements all route through gems, play and presence rather than through purchase.

**At seven players, most of this section is aspirational and should be built lightly.** A trailing 30-day trimmed median over a market with three sales in it is not a signal, it is noise with a decimal point. Ship last-sale, full history, and population alongside price; hold the indices, the want-list alerts and the spread analytics until there is volume to compute them from. The honest display for a thin market is the raw sale list, not a smoothed line.

**One thing should stay genuinely unknown: how much sealed product is still out there.** Because §3.5 reserves tokens at purchase, the number of unopened packs is real but unpublished. Nobody knows the true remaining supply of a set, only what has surfaced. That single piece of hidden state is the engine of most interesting speculation in the game, and it costs nothing to preserve.

### 7.3 Money supply: two currencies, both the host's

**This module sits inside an existing game with an existing economy** (Appendix D). That inverts the usual design problem: the collector sim does not control the faucet, cannot cap it, and should not try. It decides only what it absorbs and at what price.

The v0.3 draft solved the host's enormous income spread with an invented collector currency converted at a fixed rate under a daily cap. **That machinery is deleted.** The host already has the mechanism, built and live.

#### Gems buy packs; Coins buy cards

| | Currency | Where it comes from | What it buys here |
|---|---|---|---|
| **Gems** | `user.gems`, integer | Earned by *production* in the host's idle games — miner gem factory, colony gem snail, hack ops | Packs, bundles, auto-battler ranked entry (§12.11), cosmetics (§10.5) |
| **Coins** | `user.balance`, `numeric(19,4)` | The host economy at large | Every card purchase, the marketplace fee (§7.6), grading fees (§6.4), vendor buyback payouts (§7.4) |
| **Pokémon Dollars ₱** | Run-local, never persisted | Granted per round | The auto-battler shop, within one run only (§12.4) |

Three currencies is the ceiling; there is no fourth, and the collector currency the earlier draft was going to need has no name because it does not exist.

**Why gems solve the spread problem better than a cap would.** Gem supply is rate-limited by *production*, not by wealth. A rich player who wants packs must buy gems on the host's existing order book, which bids the gem price up and transfers Coins to the players who mined them. The spread compresses itself, continuously, in proportion to demand — where a fixed cap is a number you guess, then re-guess. It also disposes of the rollover question (gems are a balance; balances accumulate) and of the second-exchange-UI cost (the exchange is already built, matched under an advisory lock, with a self-trade-excluding guide price — see Appendix D).

**Pack price: 1 gem per 2 packs.** Gems are integers, so packs are sold in pairs and everything divides evenly.

| | Packs | Gems |
|---|---|---|
| Daily allowance | 4 | 2 |
| Friday bundle | 36 | 18 |
| Full week, maxed | 64 | 32 |

Against host production — a developed account earns roughly 13–15 gems/day, an early one 2–3 — a full weekly allowance costs about a third of a mature player's output and more than a new player's entire income. That is the intended curve: newcomers choose between daily packs and the bundle; established accounts buy everything without noticing, and the cap becomes their only limit.

#### The closed loop, and why nobody should "fix" it

Coins buy gems on the book → gems buy packs → packs yield cards → cards sell for Coins. **This loop is self-correcting and it is the pressure valve the conversion cap was trying to be.** If opening packs is profitable in Coin terms, players bid gems up until it is not; if it is unprofitable, gem demand falls and packs get cheaper. The gem price is doing the work. Do not pin it, do not subsidise it, and do not price packs in Coins "for simplicity" — that removes the only mechanism holding the two economies in relation.

The pack cap bounds how fast the loop can run. The gem price bounds whether running it is worth it.

#### The caps

**Global daily allowance: 4 packs, across all live sets, no rollover.** Global rather than per-set is the important word. With two or more sets live, players allocate a scarce allowance between chasing the newest release and filling gaps in an older one — which makes the cap a choice rather than a chore, and gives each set a meaningful demand signal. Per-set caps would multiply throughput with every set added, collapsing every run at once.

**Friday bundle: 36 packs for 18 gems, claimable Friday through Sunday.** The window rather than a single day is deliberate: at seven players, one person missing a Friday is 8% of a maximal week, and the bundle carries roughly 56% of all supply. Forgiving one evening costs nothing; punishing it costs a lot.

**Packs do not roll over; gems do.** The asymmetry is the point. Supply is finite and unrecoverable, so an accumulated pack allowance dumped in one sitting is a burst the print run cannot absorb. Money is just fairness to someone who plays three evenings a week.

**No eligibility gate in v1.** With packs priced in gems, an alt account's allowance is worthless until the alt has run production games for it, so the cost of an alt is already denominated in hours. A host-progression threshold on the daily allowance remains the correct lever if that ever stops being true — see §7.5 for the residual exposure.

#### The one place currency enters

Player-to-player trades move Coins between accounts and burn the fee; they create nothing. The gem exchange is peer-to-peer and creates nothing. **The vendor buyback (§7.4) is the module's only Coin emission**, which is why it is priced as a floor rather than as a liquid exit, and why §7.5's detection of buyback volume outrunning pack purchases is the guard on the whole system rather than a nice-to-have.

#### Notation

**₱ is run scrip and must never be Coins.** It is granted every round, so if the shop spent real currency the auto-battler would instantly be the largest faucet in the design. ₱ is granted, spent, and destroyed inside a single run — it never converts, never carries over, never trades. This is an invariant (§12.9), not a naming convention. The one thing to watch is that ₱ is the *persistent* currency in the source material, so players may assume a balance carries between runs; show it draining to zero at run end rather than explaining it.

**On the symbol: there is no correct codepoint.** The real mark is a P with a double horizontal strikethrough over the *tail*, and nothing in Unicode matches it — the ruble ₽ (U+20BD) has a single stroke, and the peso ₱ (U+20B1) has a double stroke over the *head* of the P. So ship the real glyph as an asset (a webfont glyph or inline SVG; §8.3 already generates overlays, and a currency mark is trivial beside stamps and print-run deltas), and fall back to ₱ (U+20B1) in plain text — logs, exports, alt text, anywhere a custom font cannot reach. It matches on stroke count and has had font coverage since Unicode 3.2 where ₽ only arrived in 6.3.

Prices in ₱ are small integers, so the source material's multiples-of-100 convention does not apply inside a run.

#### What to instrument from day one

Gem price and gem volume attributable to pack demand; pack consumption rate against remaining print run, per set; fee burn rate; buyback volume against pack purchases (the emission guard); and the median price of a benchmark basket.

**And one the original draft did not need: the Gini coefficient of card holdings.** With a Coin-denominated market and no cap on bidding power, the question is not whether prices inflate but whether the entire card supply ends up in one or two accounts. At seven players that is a live possibility rather than a theoretical one, and it is invisible on a price chart.

### 7.4 Attrition — mostly cut, and why

The v0.3 draft argued that finite printing alone is not enough: without a card sink, populations only ever rise, every set drifts toward "everyone owns everything," and the collecting fantasy dies. That argument was written against print runs in the hundreds of thousands. **At *N* ≈ 2,500 across seven players it does not apply.** Nothing drifts toward everyone-owns-everything when a specific chase card has two copies in existence. Scarcity here is a supply-side property, not a decay-side one.

So:

**The vendor buyback destroys the cards it buys, and is priced as a floor.** Destruction is kept because it is free and correct — a card sold to the vendor should not reappear. The *price* is set below any plausible market price, so the buyback functions as a floor for genuinely worthless bulk rather than as a liquid exit. This resolves the tension with §12.2's six-copy merges without needing to model the two forces against each other: at a floor price, play demand always outbids the vendor, so anyone with a use for the card keeps it.

Two rules on the floor, both load-bearing:

- **It is per-card, derived from the printing's population** — never flat. A flat floor makes a short-printed chase card worth destroying if the market ever dips, which is the one irreversible mistake available in this design.
- **It is the module's only Coin emission** (§7.3). A floor price on a faucet is still a faucet: set above what the market pays for true bulk, it becomes a printing press with a pack cap attached — feed the allowance in, sell to the vendor, repeat. §7.5's check for buyback volume outrunning pack purchases is the guard, and it is not optional.

**No wear, no degradation, no time decay.** Condition is immutable (§6.1). Every mechanic proposed for making it mutable shared a defect: they all punish the activity the design exists to encourage. Wear-on-trade taxes the market, wear-on-time taxes holding, wear-on-handling taxes looking at your own cards. There is no version that is not a penalty attached to engagement, which is why none of them read as fun.

**Slab-cracking damage stays** (§6.2), because it is the one destructive mechanic that is a *chosen* gamble rather than a tax — you crack knowing the risk, in pursuit of a regrade.

**The actual supply sink is sealed hoarding** (§3.5). A bundle never opened is 36 packs that never enter the world. It is voluntary, it is the collector fantasy rather than a punishment, and it already ships.

**The schema stays open.** Condition sub-scores remain mutable columns even though nothing writes to them, and `Copy` carries a lifecycle state — `raw` / `slabbed` / `sealed` / `destroyed`. If a destructive sink is ever wanted, the most promising shape is **merge-consumption**: §12.2's six-copy merge currently holds copies and returns them, but a variant that permanently consumes them in exchange for a persistent play-side asset would be a sink players actively queue up for rather than one inflicted on them. Revisit once the auto-battler is live and its bulk demand is observable.

### 7.5 Manipulation and abuse

**Scope this section down hard.** It was written for an anonymous market at scale. Seven players who share a chat channel and know each other's names are not that, and shipping the full apparatus would be dead code with a maintenance cost. What follows is split into what to build and what to knowingly not build.

Some "manipulation" is legitimate play and should be left alone regardless — cornering the market on a low-population card is a real collector strategy and it is fun.

#### Build

**The ownership chain is the whole defence** (§11.3). Every copy records its complete holder history, visible on every listing. A card shuttling between the same two accounts advertises itself to anyone considering buying it. This is the one defence that cannot be tuned around, because the evidence travels with the item rather than living in a model — and at seven players it is not merely sufficient, it is *better* than any algorithm, because every participant can read it and every participant knows the counterparties.

**The burned fee** (§7.6). 5% on every sale means faking a price history costs real money on every hop.

**The buyback emission guard** (§7.4). Watch for buyback volume outrunning pack purchases, and for asset flows converging on a hub account. This is the only monitoring that is genuinely load-bearing, because the buyback is the module's only Coin faucet.

#### Do not build in v1

**Trimmed medians requiring ≥N distinct counterparties.** With seven players, any threshold above 2 makes the price index permanently read "insufficient data." Show the raw sale list.

**Per-pair contribution caps on the price index.** Same reason.

**Closed-loop currency circulation detection.** Seven accounts *are* a small cluster; the signal has no baseline to stand against.

**Listing-to-purchase delay against sniping bots.** No public API exists (Appendix D), and being fast buys nothing when nobody is racing you. Add it if someone actually scripts against their own session and it becomes annoying.

**Server-side rendering and per-view variation against vision bots.** Not a threat model (§6.3). Anyone building a CV pipeline to grade cards for a group this size has earned the result.

#### Alt accounts: accepted, with one residual cost

Removing directed trades was considered and rejected (§7.1) — it does not stop alt farming, because an alt can sell into the open market and receive Coins without ever transacting with its operator. What it would have cost is the social heart of the market.

So alts are accepted. Two exposures remain and both are worth naming rather than defending against:

1. **A pack allowance is a Coin income entitlement.** If a pack's expected Coin value exceeds its gem cost, each additional account is worth real money. Gems are the brake — an alt earns nothing until it has run production games — but the brake is hours, not a wall.
2. **Alts consume print run.** This is the sharper cost and it is not about money. The pack cap makes supply duration a function of headcount, and *N* is authored against it (§4). Every farm account inflates headcount without adding a player, so sets sell out faster than planned — and that is not recoverable, because the run is finite.

If either becomes real, the lever is a **host-progression threshold on the daily allowance** (§7.3): one price for everyone, no arbitrage, but an alt costs however many hours that threshold represents.

### 7.6 Emergent hooks that come free

- **Serial numbers.** Every copy already has a token index from §3.3. Surface it. Low serials (#1, #007) and meaningful ones become independently desirable at zero implementation cost.
- **Grading arbitrage is now the game's core skill loop.** Buy raw, judge it by eye, grade it, sell slabbed — all three legs in Coins, no conversion mid-loop. Because condition is hidden (§6), this is not a mechanical money printer: it rewards players who read cards well and punishes those who don't. Tune the grading fee against the typical grade-9-to-10 value gap so it stays a genuine gamble, and note that it doubles as the main bridge between the illiquid raw market and the liquid slabbed one.

- **The marketplace fee is 5%, burned.** It is the module's primary permanent sink and the single most consequential number in the design: it sets the inflation drain, the cost of wash trading, and whether flipping is viable at all. The tension is real in both directions — every point of fee is a point of spread a flipper must clear before breaking even, so at 10% casual flipping dies and only large-margin grading arbitrage survives, while at 2% the sink is thin and washes are cheap. 5% is the starting anchor, held down by the fact that it no longer carries the drain alone: §6.4 prices grading as a percentage of declared value, and §10.5's cosmetics drain gems without touching supply.

  Two invariants on it. **The fee is burned, never pooled** — no prize funds, no rebates. And **the fee must never call `accumulateRake`**: the host returns 1% of wagered volume to a locked rakeback balance (Appendix D), so routing marketplace fees through it would send a fifth of the module's primary sink straight back out. That pattern is idiomatic in the host codebase and someone will reach for it by reflex.
- **Market events.** A set selling out should spike prices; an announced reprint should tank them. This gives admins real narrative levers over the economy.

All trades must be atomic and escrowed. No partial states, ever.

---

## 8. Admin tooling

### 8.1 Set authoring

1. **Set metadata** — name, symbol, release date, era (drives condition quality parameters).
2. **Checklist** — two paths. For an **imported set**, the card rows (number, name, rarity, artwork, finish eligibility) come from official data and are **read-only**; the admin never edits them, which is the whole point of importing. For an **authored set**, the admin creates card rows by hand. Either way the admin's real work starts at step 3 — the checklist is input, not the design surface.
3. **Sheet designer** — drag cards onto sheets with multiplicities. Live pull-rate preview updating as you edit; this is the single most valuable piece of the admin UI. Must enforce the §3.3 window constraint: no card twice within any *k* consecutive positions, where *k* is the slots-per-pack drawn from that sheet. Show violations inline; block commit until clean.
4. **Print run** — set target pack count *N*; review derived impressions, the leftover tokens that will be destroyed, and the **projected sellout date** against current burn rate (§4). *N* is the primary control and everything else derives from it.
5. **Rate diagnostic** — show authored rate against published rate per tier, with the delta. Under slot-true (§4) this is information, never a blocker. The rate-fitter is available here as a *starting layout generator*, not as an output mode.
6. **Simulation** — Monte Carlo *N* packs and show the resulting distribution *before* committing, including final populations per printing. At *N* ≈ 2,500 the interesting output is not the rate table but the population table: catching "this set has zero obtainable Master Ball Charizard" here rather than after launch is most of the value.
7. **God pack config** — authored rate per set; the tool computes *G*, nets it out of the chase sheet (§3.8), and rejects infeasible configurations with a reason. *G* is committed and **never displayed publicly**.
8. **Commit** — generates `sheet_key`, publishes the commitment digest over layouts, key, *N* and *G* (§3.4), freezes sheets. The key is never revealed.

### 8.2 Cloning official sets

Import structure from a public catalog API, then hand it to the admin as an editable draft. Current landscape:

- **TCGdex** — open source, no API key, REST and GraphQL, multi-language catalog data. Good default.
- **Scrydex** — <cite index="4-1">a commercial multi-TCG rebuild from the pokemontcg.io team, with broader coverage and market price points on card records; new production projects should probably start there.</cite>
- **pokemontcg.io** — <cite index="4-1">free and well-documented, the API a generation of Pokémon projects was built on, and it still works</cite> — but third-party uptime monitoring currently shows roughly 55% reliability and ~8s response times, so don't put it on a hot path. Import to your own store and cache aggressively.

Promo sets import the same way but bypass everything downstream: no sheet template, no print run, no pack template. They land as a checklist that §11.2 and §11.5 draw from directly.

Import maps rarity strings onto a **sheet template** (a reusable layout like "modern 10-card SV-era"), producing a draft the admin can then adjust. Keep the structural template and the visual assets as **separate objects** — the template is the reusable, ownable part.

**Correction to an earlier assumption: pattern data does exist in structured form.** TCGdex's open-source card database carries a `foil` field enumerating exactly the pattern registry in §5.2 — `pokeball`, `masterball`, `cosmos`, `galaxy`, `starlight`, `tinsel`, `cracked-ice`, `mirror` and more — alongside per-card finish flags. See Appendix A. The marketplaces still have the gap (<cite index="63-1">TCGplayer has no option for variants like Cracked Ice or Cosmos Holo, so they list them as separate products, which makes automatic identification difficult and requires an external mapping database</cite>), but the collector databases have solved it. Import rather than hand-author, and reserve manual entry for corrections.

---

### 8.3 Asset pipeline

Assets come from a separate TCG Live scraper and visualizer. The important architectural constraint that follows:

**Composite, don't collect.** §5 defines a printing as `card × finish × pattern × print_run × stamps[]`, and §6 adds per-copy condition on top. There is no world in which you scrape a finished image per printing — most of those combinations don't exist in TCG Live at all. It has no wear, no Shadowless, no drop-shadow-vs-not, none of the ~150 stamps, and likely not every foil pattern. Scrape **components**, composite at render time.

| Layer | Source | Notes |
|---|---|---|
| Illustration | Scraped | Per card. The bulk of the payload. |
| Frame / template | Scraped | Per era × card type. Reusable across hundreds of cards. |
| **Foil mask** | Scraped or derived | **The load-bearing asset.** See below. |
| Pattern textures | Scraped or authored | Tiling textures: cosmos, tinsel, mirage, Poké Ball, Master Ball. |
| Rarity + set symbols | Scraped | Small, highly reusable. |
| Print-run deltas | Generated | 1st Edition stamp, drop shadow, copyright line (§5.4). |
| UI glyphs | Authored | The ₱ mark has no Unicode equivalent (§7.3) — ship it as a font glyph or SVG. |
| Stamps | Generated | ~150 overlays (§5.5). |
| Condition marks | Generated procedurally | §6.2. Never scraped. |

**The foil mask is the piece to make sure the scraper captures.** Holo means the artwork window is foiled; reverse holo means everything *except* the artwork window is foiled. Both derive from a single per-frame region mask. With it, finish and pattern become render parameters and any combination composites for free — which is exactly what §5's model requires. Without it you need a separate scraped image per finish, you can't render pattern combinations that TCG Live doesn't ship, and the whole variant model degrades into an asset-collection problem.

**Layering, and the one rendering detail that matters.** Condition marks (§6.2) sit on top of the scraped stack, but not uniformly:

- **Centering is geometry, not overlay.** Offset the composite within the border before compositing anything else. It's a transform, applied first.
- **Edge and corner wear** is alpha at the card boundary, above the frame.
- **Surface flaws must render above the foil layer *and* respond to light on a different curve than the foil does.** This is the detail that decides whether inspection works. A scratch that shimmers in sync with the holo pattern is invisible; a scratch that catches light when the foil doesn't is exactly how you spot damage on a real foil card. If the visualizer already drives foil from a tilt/light vector, the surface layer needs its own response function against that same vector — not a reuse of the foil's.

That last point is the main integration requirement to hand to the visualizer work, and it's much cheaper to build in now than to retrofit.

**What the scraper won't cover**, and therefore what must be generated: all condition rendering, all print-run cosmetic deltas, all stamps, embossing/texture on premium tiers if TCG Live doesn't model it, and any foil pattern the client doesn't implement. Budget for a procedural overlay system as a real component, not a finishing touch.

---

## 9. Legal constraints

Two things worth deciding early rather than late.

**Artwork and names.** Card art, character names, and set identities are The Pokémon Company's intellectual property, and sourcing assets by extracting them from TCG Live is a step up in exposure from linking a public API's image URLs — it's an official first-party client, and its terms almost certainly prohibit extraction. That's a real difference in risk profile, not a formality.

It doesn't change the recommended architecture; it sharpens it. Keeping *set structure* (yours) separate from *assets* (not yours) was already the design (§8.2, §8.3) — the compositing model makes that separation natural, since the codebase holds masks, layer logic and procedural overlays rather than card images. The practical mitigations are the same ones already in the plan, applied with more conviction: ship the product asset-free, make the asset pack user-supplied and locally sourced, and keep the scraper a separate tool from the game rather than a service the game depends on. A private or personal-use project is one risk profile; a public product distributing extracted first-party artwork is a materially different one. Worth an explicit decision before the asset pipeline hardens, because it determines whether §8.2 and §8.3 ship enabled by default.

**Loot box regulation.** Randomized paid rewards are regulated in several jurisdictions, and the regulatory trigger is almost always **convertibility to real value**. As long as currency is purchased with nothing and cashes out to nothing, this is a simulator.

A player marketplace raises the stakes here, because it creates in-game assets with a clear internal valuation — which is exactly what an unofficial real-money secondary market in accounts and items grows on, whether or not you sanction it. That off-ramp existing in practice is what regulators look at, not whether you built it. Concretely: put anti-RMT terms in place from launch, keep account transfers unsupported, and watch for the trade-graph patterns in §7.5, which catch RMT and wash trading with the same detection. Keep the no-real-money wall explicit in the code, not just in the design doc.

---

## 10. Presentation, slabs and display

Display is the only activity in the design that doesn't consume supply, and it's the natural home for the raw/slabbed split from §7.1: **binders are how you present raw cards, slabs and shelves are how you present graded ones.** Two presentation systems for the two states a card can be in.

### 10.1 One renderer, two cameras

The architectural decision to make now, before either half is built. §8.3 describes a layered compositor driven by a tilt vector; this section describes a full 3D slab viewer. **Do not build both.** Make the card renderer 3D-native from the start and treat the flat card view as a fixed orthographic camera on the same scene.

If the compositor ships as 2D-with-a-tilt-parameter and the slab viewer arrives later as real 3D, you will have two renderers, two lighting models, and two implementations of the foil shader that disagree with each other. This is cheap to decide now and expensive to unpick later.

### 10.2 The slab

The TAG design is a good reference precisely because of what it *doesn't* do — <cite index="14-1">the slabs are sleek and minimal, designed to highlight the card rather than the label</cite>. Three properties are worth modelling, in descending order of how much they sell the object:

**Parallax depth.** The card sits inset behind acrylic, so tilting shifts the card relative to the slab surface. This single effect is what makes a slab read as a physical object rather than a card with a frame drawn on it. And there are genuinely three depth planes, not two, because <cite index="18-1">the grade and data are permanently inscribed inside the slab rather than printed on a paper insert</cite> — slab surface, inscription, card face. Three-layer parallax is unusual and instantly legible.

**A second specular layer.** The acrylic reflects independently of the card's foil. Two speculars responding to the same light vector on different curves — which is the same principle as the surface-scratch rendering note in §8.3, and can share the machinery.

**Radiused edges and stacking.** <cite index="12-1">TAG slabs use radiused edges and are designed to interlock and stack.</cite> The radius catches light along the border and is most of what makes the silhouette read as premium. Stacking matters for §10.5.

**The mechanical consequence: slabbing costs you inspectability.** Acrylic diffuses, the reflection layer sits in the way, and parallax fights close zoom. A slabbed card genuinely cannot be examined the way a raw one can — which is realistic, and gives the crack-out gamble (§6.4) real weight. You are trading the ability to look for a certified number, permanently.

### 10.3 The return ceremony

Grading results should never arrive as a notification with a number in it. TAG worked this out for the physical product: <cite index="19-1">the post-grade packaging uses black foil that mimics the feel of ripping a pack, giving collectors the chance to pull a card from a pack twice.</cite>

Copy that exactly. The submission returns as a sealed package. You open it. The slab is revealed face-down or edge-on, and **the grade is only readable once you rotate it**. The grade is the payoff of a gamble that started when you bought the pack — it deserves the same reveal treatment as the pack itself, and it costs almost nothing on top of a 3D viewer you're already building.

### 10.4 The report: where truth is finally revealed

§6.3 makes the card render deliberately lossy, so the player never sees ground truth. The grading report is where that debt gets paid, and TAG's is a strong model: <cite index="16-1">eight subgrades covering front and back centering, corners, surface and edges</cite>, plus <cite index="18-1">a defect viewer with zoom to 800x and specific flaws labelled as the ones that drove the grade</cite>, and <cite index="17-1">a transparency slider that blends between the normal colour view and the defect-visualisation view</cite>.

Three things to steal:

- **The blend slider.** Dragging between "what the card looks like" and "where the defects are" is the single best calibration tool a player could have for training their own eye. It directly serves the premium sub-grade tier in §6.4.
- **Named defects.** Labelling *which* flaws cost the grade teaches faster than a number does.
- **Reports are public and permanent.** <cite index="19-1">A report exists independently of who owns the card, so any collector can look it up before making an offer.</cite> This is a marketplace feature as much as a grading one — it makes slabbed listings genuinely inspectable in a way raw ones aren't, which reinforces the fungibility split in §7.1.

Consider adopting the granular score too: <cite index="12-1">a 1000-point score under the 1-10 grade distinguishes a "high 10" from a "low 10" and enables precise ranking against every other graded copy.</cite> That converts "pop 4, none higher" into an actual leaderboard position, and gives display a scoreboard.

Note this argues for expanding §6.1's sub-scores from five to eight — front and back for each of centering, corners, edges and surface. More granular, maps onto a real system, and gives the report more to show.

### 10.5 Binders, sleeves and shelves

**Binders are the master-set tracker made physical.** The nine-pocket grid is the iconic form, and the important property is that an incomplete page *shows its holes*. Progress stops being a percentage in a UI and becomes a visible gap where a card should be. That's a far stronger pull than a checklist, and it's the same data you're already tracking (§5.6).

Layout should be the player's choice — set order, by type, by rarity, gaps left deliberately or closed up. Arrangement is most of what collectors actually do with binders, and it's pure expression with no supply cost.

**Sleeves are the cosmetic economy, and they are priced in gems.** Colours, patterns, finishes, visible behind every card in a binder. This is a good sink: it drains without touching card supply, it's pure presentation, and it can't distort the market because sleeves don't attach to value. Gems rather than Coins because sleeves compete with packs for the same production-limited budget, which makes buying one a real choice rather than a rounding error — and because §12.9 needs a non-currency reward that still feels earned.

Condition is immutable (§7.4), permanently, so sleeves never gain a protective function. Keep them cosmetic and keep them cheap.

**Shelves and cases are the slab display.** Slabs are uniform, stackable, and identical in geometry, which is exactly why a wall of them looks good. Lighting the case is worth doing properly — the whole point of the slab optics in §10.2 is that they respond to light, and a display shelf is where a hundred of them do it at once.

**Public profiles tie it together.** A binder or shelf someone else can visit is what makes curation social rather than solitary, and it's the display half of the registry idea: complete sets ranked by aggregate grade, visible as an actual shelf rather than a number.

### 10.6 Performance

The good news is that this is cheap if built correctly:

- **Slab geometry is identical for every slab** — GPU instancing makes a shelf of 200 nearly free.
- **Card faces are textures** — atlas them; a binder page is nine quads.
- **The foil shader is the only expensive part.** LOD it hard: full shader on the focused card only, simplified or baked for everything else in the scene. Nobody is inspecting the card in the back row of a shelf.

Budget the real cost in the *inspection* view — one card, full shader, high-res textures, three-plane parallax — and treat every wide view as cheap.

---

## 11. Achievements, promos and events

### 11.1 Achievements as a system

Achievements do two jobs here: they mark what someone accomplished, and they act as the **permanent record of what a player received directly from the platform** (§11.3). They are never tradeable. That non-transferability is what makes them useful as a ledger — a card can change hands, so it can't prove anything about history; an achievement can.

Set completion is the first and most obvious one.

**Set completion tiers** — worth distinguishing at least three, because they're wildly different amounts of work:

| Tier | Requirement |
|---|---|
| **Base set** | Every entry on the numbered checklist, any finish. **Promos excluded.** This is the real completion target. |
| **Master set** | Every card × every eligible finish × every pattern. **Promos excluded.** |
| **Master set with promos** | The above plus the set's promos. Explicitly the hard mode; displayed as a separate line, never as an incomplete version of the tier above. Trophy promos (§11.5) excluded. |
| **Graded master set** | Any of the above, all slabbed, scored by aggregate grade. |

**Base completion is achievable; master completion may not be.** At *N* ≈ 2,500 (§4) a specific chase printing has one or two copies in existence, so at most one or two players can ever hold the cards a master set requires. The tracker should present it as an aspiration rather than a task with a completion percentage implying it is merely distant. This matches real modern Pokémon, where almost nobody master-sets an expansion.

Two mechanics rather than one:

- **The achievement is a snapshot.** You completed it at a moment; that's recorded permanently even if you later sell the cards. Completion shouldn't mean locking assets away forever.
- **The registry rank is live.** Held sets ranked by aggregate grade, using the 1000-point score from §10.4. Sell a card and you drop off. This is the competitive layer, and it's what makes people chase a high 10 over a low 10.

Both display on the profile. The snapshot says what you did; the rank says what you still hold.

### 11.2 Promos sit outside the printing model

Promos are a **separate object class**. No sheets, no print run, no pre-shuffled permutation — none of §3 applies. They're minted directly on claim.

The rules:

- **One per account, ever, per promo.** This governs *distribution only*, not ownership. Your first copy is free; any further copies come from the market like anything else.
- **Population equals the number of claimants**, and fixes permanently when the window closes. No more are ever minted.
- **Serial is claim order**, so early claimers hold low numbers.

The commitment scheme (§3.4) doesn't apply — there's no randomisation to prove fair, since everyone receives the same card.

**This is a demand-determined scarcity model, which is a genuinely different thing from the rest of the design.** Everywhere else, supply is fixed in advance and demand discovers a price against it. Here, supply *is* demand: a promo's population is a record of how many people were present and engaged at that moment.

That produces something valuable for free. **Promo scarcity becomes a fossil record of the platform's history.** A promo from a quiet early month is permanently scarcer than one from a peak month, without anyone deciding it should be. That's precisely why real early-era promos are scarce — fewer players were around — and it gives the game genuine vintage stratification with zero admin intervention. It also means the promo timeline doubles as a growth chart anyone can read.

**Farming is partly self-limiting here.** A promo everyone claims is common and therefore near-worthless, so the payoff for alt-farming a widely-distributed promo is small. The economics defend themselves at the wide end. They don't at the narrow end: a promo with restricted eligibility is valuable *because* few hold it, which is exactly where fake accounts pay. So gate narrow promos on earned eligibility (§11.1 completion is the natural one), and leave wide ones ungated.

**What you give up** is the ability to promise a number in advance. An admin can't announce "only 5,000 will exist" — only report the final count afterwards. That's a real tradeoff against §3's pre-committed guarantees, and it's worth being explicit that promos are a deliberate carve-out from them rather than an oversight. (§11.5's trophy promos get the guarantee back, by making eligibility positional rather than open.)

**Promos are excluded from base and master set completion.** A time-limited one-per-person card inside a completion requirement means anyone who joined after that window can never complete the set except by buying a scarce card at whatever the market demands. At seven players, one person permanently locked out of a completion tier is 14% of the playerbase. Promos get their own set with their own completion track; the optional "with promos" tier exists for the hardest version (§11.1) and is labelled as such.

**Owning the card and holding the achievement are different things, and the split matters here.** A player who buys a promo on the market *does* complete the "with promos" tier — it is a collection, and collections do not care how you got there. The achievement, which is never tradeable, is what records that you were present when it dropped. Keeping these separate is what lets the market stay useful without the prestige layer becoming purchasable.

**The promo checklist is real and importable.** Black Star Promo sets are numbered checklists sitting outside the main expansions — structurally what this section describes, available as ordinary set data (§8.2). Draw both claim drops and trophy promos (§11.5) from it rather than authoring promos by hand.

**Event stamps are already catalogued.** The stamp enum from §5.5 is effectively a list of every promo distribution mechanism the real game has used — pre-release, staff, retailer exclusives, seasonal drops, championship placements, player rewards. Use it as the event design reference; the vocabulary and the assets are the same thing. (Standard §9 caveat applies, and applies most sharply here, since distributing promos is the most publication-like activity in the design.)

### 11.3 Every promo carries an achievement

Distribution grants two things: the card, and a matching achievement. The achievement is **non-tradeable, permanent, and dated**, and it is also the system of record — the one-per-person check is simply "does this account already hold the achievement?" One mechanism serves eligibility, display and audit at once.

**The achievement is only granted organically.** Received directly from a platform distribution — a drop, an event prize, a completion reward — yes. Bought on the market, traded, or gifted — you get the card and no achievement. Worth writing the definition down precisely, because it's the line the whole feature rests on: *organic means it came from the platform, not from another player.*

**This splits one object into two value axes**, which is the interesting part:

| | Tradeable | What it means |
|---|---|---|
| The card | Yes | You have it. |
| The achievement | No | You were there. |

Real collecting can't do this — a physical card doesn't remember who opened it. Here it can, and cheaply.

**The prestige layer is unfarmable even where the economic layer isn't.** Alt accounts can accumulate promo *copies*, but achievements can't be consolidated onto a main account. So the status component is structurally safe even for wide, ungated drops — which means you can be relaxed about farming on exactly the promos where §11.2 says the economics already defend themselves.

**Profiles become readable.** Achievement but no card: was there, sold it. Card but no achievement: bought in later. Both legitimate, visibly different, and neither needs explaining. This is the fossil record from §11.2 rendered per-person — a profile shows which eras someone was actually present for.

**Provenance: the full ownership chain.** Every copy records its complete ownership history — each holder, when they acquired it, and how (pack, claim, market, trade, gift).

**Visibility is scoped, and the scoping is what makes it safe:**

| Viewer | Sees |
|---|---|
| Current holder | Full chain |
| Anyone, while the copy is listed | Full chain |
| Anyone else | Nothing |

This preserves the hidden-supply property in §7.2. A fully public ledger would be enumerable — diff it against the print run and you'd have the unaccounted sealed figure exactly, which is the one number the design deliberately withholds. Holder-scoped visibility can't be enumerated without owning the copies, and market-scoped visibility only ever exposes copies that were already surfacing as public listings. You learn nothing the listing didn't already tell you.

It also lands the information where it's useful: **at the point of purchase, alongside inspection.** A buyer evaluating a raw card gets their own eyes (§6.2) plus the card's history. A copy that's been flipped four times in two months is worth a harder look — which is true of real cards too, and is a legitimate input to a skill judgment rather than a bypass of one.

**This is already the ledger you need.** The chain's first entry, with its acquisition type, is exactly what §11.3's organic check reads. Achievements and provenance are one data structure, not two.

**Naming should be opt-in.** Default to a stable pseudonym ("collector #4417"); let players opt in to being named publicly. This matters because a downstream holder listing a card would otherwise expose every previous owner without their say. Opt-in also makes being named a status move in its own right — named collectors accumulate reputations, and a card that passed through a known collection carries a pedigree premium. That's one of the strongest value multipliers in real high-end collecting, and here it emerges from a visibility flag.

Store owner IDs and resolve at display, so deleted accounts render as a pseudonym without breaking the chain.

**Unplanned benefit: it exposes wash trading.** A copy bouncing between the same two accounts is visible in its chain to anyone considering buying it. That's a crowd-sourced complement to the algorithmic defences in §7.5 — and unlike those, it can't be tuned around, because the evidence is attached to the item being sold.

**One caution: a frozen prestige ladder.** Once a window closes its achievement is permanently unobtainable, which is most of the appeal and also a way to make anyone who joined late permanently second-tier. That's fine if deliberate, but it requires a *continuous* stream of new achievements so recent arrivals always have something they can still be early for. Keep the achievement calendar running, not just the promo calendar.

### 11.4 Time-boxed events

Events are the economy's steering wheel. Every lever below adjusts supply or drains currency without touching a tuning constant:

| Event | What it does |
|---|---|
| **Promo drop** | Adds a dated collectible and a matching achievement. Population set by turnout. |
| **Grading discount window** | Drains currency hard (§7.3) and spikes population report activity. |
| **Capped reprint** | Relieves scarcity where a set has become unobtainable — using §3.6's generation marker, so first-run copies stay distinct. |
| **Set close** | Retires a set from the shop. Converts remaining sealed product into speculation. |
| **Competitions** | Scored on systems you already have. |

Competitions are worth calling out because there's no gameplay to compete at — so compete at collecting:

- Fastest to complete a named set
- Highest-graded example of a specific card (uses the 1000-point score directly)
- Best pull of the week, by population rarity
- Binder or shelf showcases, player-voted

All of these read off existing data. The scoreboard is the population report and the registry; the event is just a window and a prize.

**The one caution:** capped reprints and set closes both move prices sharply and predictably. Announce them on a schedule, or you've handed insider information to whoever sees the admin queue. Publish the event calendar.

---

### 11.5 Trophy promos: the third scarcity model

Seasonal competition in §12 awards a promo card. This is a **third distribution model**, distinct from both of the ones already in the document, and the differences are the interesting part:

| Model | Supply is set by | Announceable in advance |
|---|---|---|
| **Pack cards** (§3) | Print run, committed before launch | Yes, exactly |
| **Claim promos** (§11.2) | Turnout — supply *is* demand | No, only reportable afterwards |
| **Trophy promos** (§11.5) | Placement brackets, fixed by rule | Yes, exactly |

Trophy promos are the only promos whose population is knowable up front, which resolves the tradeoff §11.2 flags as given up. It comes back here because eligibility is *positional* rather than open: exactly one player finishes first, whether ten or ten thousand competed.

This is not an invention. Real trophy cards — awarded to tournament winners, populations in single digits — are among the most valuable Pokémon cards ever printed, and they are valuable precisely because no amount of money could obtain one at the time. That is the artifact being reproduced.

**Placement tiers, using the stamp axis.** §5.5 establishes stamps as orthogonal to finish and pattern, with placement stamps already in the reference enum. So one season produces one artwork and three printings:

| Placement | Stamp | Population per season |
|---|---|---|
| 1st | Champion | 1 |
| 2nd–8th | Finalist | 7 |
| 9th–64th | Competitor | 56 |

One promo card per person per season, and 64 recipients. The ladder gives reachable prizes at the bottom and a genuinely singular one at the top.

**The base card is a real promo, not a stamped set card.** Real Black Star Promo sets are numbered checklists that sit outside the main expansions, which is structurally exactly what §11.2 claims promos are — so the model stops being an assertion and becomes imported data (§8.2). This supersedes an earlier recommendation to stamp an ordinary set card.

What this buys:

- **Seasons cost nothing to run.** Pick a promo, generate a season stamp, mint. No commissioning, no art pipeline. Season *N* is a config row.
- **The promo checklist becomes a collectible track in its own right.** §11.2 already recommends giving promos their own completion goal separate from base and master sets; that goal is now a real, enumerable, legibly-numbered set rather than an arbitrary bucket.
- **No change to the §9 position.** Promo artwork sits in exactly the same bucket as every other card image, which is a smaller exposure than commissioning original art that imitates the property.
- **Trophies are playable units** (§12), because a promo is a real card with real HP and attacks. And they self-limit: population 1 means a champion card is permanently capped at level 1 (§12.2), so it can never anchor a merged board. A unique prize that is *usable but not dominant* is exactly the right shape.

**Let the real card's own distribution history pick its in-game role.** §11.2 notes that the stamp enum is effectively a catalogue of every promo distribution mechanism the real game has used. Apply it directly: championship, Worlds and player-reward promos become trophy promos; retailer, prerelease and seasonal promos become open claim drops. The vocabulary, the assets and the design intent are the same object, and nobody has to invent a mapping.

**The stamp carries the season, so the catalogue never depletes.** A printing is `(promo card, season stamp, placement)`, and the season component makes each one unique — so the same promo card can serve season 4 and season 40 without either population exceeding its bracket. Season stamps are generated overlays (§8.3), so this costs a config row rather than an asset. Without this, every season would consume a promo permanently and the catalogue would be a depleting resource.

Two things to plan around:

- **Filter jumbo and oversized promos.** They carry a `size` field (Appendix A) and do not fit the card frame, the binder grid (§10.5) or the slab geometry (§10.2). Either exclude them or give them their own display object; do not discover this at render time.
- **Real-world value associations will not match in-game ones.** A promo that is famous and expensive in reality may be a wide, cheap claim drop here, because in-game population comes from turnout and placement rather than from history. That mismatch is mostly harmless and occasionally interesting, but it will generate confused questions and is worth answering in the UI rather than in a forum.

**Minted, never drawn.** Trophy promos are minted on award, exactly like claim promos. They never come out of a print run, so awarding one is not a withdrawal from finite supply and does not perturb any set's population guarantees (§3).

**The card is tradeable; the achievement is not.** §11.3's split does all the work here with no extension:

| | Tradeable | Means |
|---|---|---|
| The trophy card | Yes | You hold it. |
| The placement achievement | No | You won season 4. |

So a winner can cash out at whatever the market bears, and the prestige stays with them permanently regardless. Buying a Champion card later gets you the card and visibly not the achievement (§11.3), which is exactly the reading the profile already supports. **A season win is the most unbuyable thing in the game**, and it costs nothing extra to make it so.

**Farming analysis.** §11.2 warns that narrow promos are where fake accounts pay, and a population-1 card is the narrowest possible promo. Two things defend it, and they are stronger here than for claim promos:

1. **Competing requires a funded collection per account, and then costs money per entry.** Claiming a promo is free; laddering is not. Every alt needs its own cards, bought with currency the account has to earn in the host game, against finite supply — and then pays a ranked entry fee (§12.11) for every attempt. The barrier is the entire rest of the economy, plus a recurring cost that a dormant alt cannot avoid by simply existing.
2. **Placement is zero-sum.** Alts cannot stack — twenty accounts cannot combine into a better finish, and each one that places displaces the operator's other entries. Multi-accounting buys lottery tickets in a contest, not multiples of a reward.

The residual risk is top-64 farming, where a wide net genuinely does raise the odds of placing somewhere. Watch for it in the §7.5 trade-graph detection, which already looks for exactly this shape.

**Trophy promos stay out of set completion**, including the optional "with promos" tier in §11.2. A population-1 card cannot be a completion requirement without making completion impossible for everyone but one person. They belong to their own seasonal track.

**A caution worth carrying from §11.3.** Seasonal placements are the sharpest version of the frozen prestige ladder — season 1's Champion is unobtainable forever, and there is exactly one. That is most of the appeal. It is survivable only because seasons keep running, so a new arrival is always at most six weeks from a ladder they can win. Never let the season calendar lapse.

---

## 12. The auto-battler

**This ships in v1.** It is not a deferred phase-8 item and it is not schema-optional: "play uses owned copies" (§12.9) is a foundational assumption that has to be true from the first migration.

The reason it earns v1 rather than a later slot is the collecting, not the combat. Without it, the only demand for a common is one copy for the checklist, and the bottom 80% of every print run is inert — which at *N* ≈ 2,500 means most of what anyone opens is confetti. §12.2's six-copy merge threshold gives duplicates a reason to be wanted and bulk a reason to exist, and §12.6 does the same for Trainers, which otherwise have no chase card and no collector demand at all. The collection-grade / play-grade market split (§12.9) falls out of that for free.

The costs are real and are accepted: it contradicts a v0.3 non-goal, it adds permanent balance maintenance against cards never balanced against each other, and it is a second substantial module in a host that already has nine.

An auto-battler rather than a TCG variant. Team-building in a shop phase, battles resolving automatically against other players' saved teams.

The case for this shape over a card game:

- **Async by construction.** You fight snapshots, not live opponents. No matchmaking, no concurrency requirement, no latency — which matters a lot for a collecting game whose playerbase may be small or spread across timezones.
- **Battles are spectator objects.** Nothing depends on input, so a battle is a deterministic replay: shareable, watchable, cheap to compute server-side.
- **The skill is composition, not reaction.** Which maps directly onto collecting. Your roster *is* your collection.

### 12.1 Decisions

These are settled. Everything downstream in §12 assumes them; §13 records them alongside the rest of the decision register.

| | Decision |
|---|---|
| **Pool** | Entire collection is eligible. Each run **drafts** 10 units + 6 items from it. No registration step. |
| **Draft weight** | Copies owned, **squared**. |
| **Merge thresholds** | Escalating: 3 copies → level 2, 6 copies → level 3. |
| **Merge** | Hold, never consume. Selling a backing copy downgrades the unit. |
| **Board** | 1 active + 5 bench, matching the real game. |
| **Attack timing** | Charge counters derived from energy cost, not a flat attack value. |
| **Basic Energy** | Excluded from the mode entirely. |
| **Trainers** | In, mapped onto SAP-style items by subtype (§12.6). |
| **Special Energy** | In, as an attachable item. |
| **Slabbed cards** | Cannot play, and do not count toward weight or level cap. |
| **Rewards** | No currency, no cards — with one exception, the seasonal trophy promo (§11.5, §12.9). Otherwise cosmetic sleeves, achievements and ladder rank only. |
| **Escrow** | Purchased units and items only, not the whole pool. |
| **Entry** | Ranked runs cost a **gem** fee and are capped per season. Unranked runs are free. |
| **Brackets** | *Common* and *Standard* are ranked and rotate. ***Unlimited* is unranked** — a sandbox, never a trophy season (§12.11). |

### 12.2 The collection, the run pool, and merging

Your entire collection is eligible every run. But the shop does not draw from it directly — a run **drafts a pool** from the collection at start, and the shop draws from that. The distinction is what makes merging possible at all, and the reasoning is worth writing down because it corrects an earlier version of this section.

**Merge thresholds escalate, as in the source genre: 3 copies for level 2, 6 for level 3.** Escalation is what makes depth a real commitment rather than a box ticked at three. It also produces the single best pay-to-win defence in §12:

> Six copies of a common is trivial. Six copies of a Charizard ex is prohibitive.
>
> **Chase cards realistically stay at level 1. The deepest power in the game is only available in the cheapest cards.**

That inversion is worth more than anything else in this section. It means the strongest boards are built out of bulk, and it aims a demand curve with no ceiling at exactly the population §7.4 exists to destroy — the target is now the *sixth* copy of a common, not the third.

**Why the shop can't draw from the collection directly.** Copy-count weighting alone does not survive contact with a large collection. Take a 3,000-card collection and a card you own six of. Even weighting by copies, that card is roughly six units of weight against a few thousand — under 1% per shop slot. Across a whole run of perhaps forty offers you would see it once or twice. **Level 3 would be unreachable for everyone except a player who owns almost nothing**, which inverts the intent exactly.

Sharpening the weight function does not fix this. Neither does boosting cards you have already bought. The problem is structural: you cannot draw six specific copies out of thousands in forty attempts, at any weighting.

**So the run drafts.** At run start:

| | Drafted | Weighting | Enters with |
|---|---|---|---|
| Units | 10 distinct cards | copies² | `min(copies_owned, 6)` instances |
| Items | 6 distinct Trainers | copies² | `min(copies_owned, 4)` instances |

The shop then draws from this pool without replacement; rerolled and sold cards return to it. A drafted six-of is roughly a fifth of the unit pool, so it surfaces around eight times in a run — comfortably enough to complete, and cheap enough at ₱3 a copy to actually afford.

**Squared weighting is the mathematical statement of "depth beats breadth."** Four copies is sixteen times likelier to draft than one. A player who owns one of everything drafts near-randomly from thousands of singletons and can never field above level 1; a player with committed playsets reliably drafts into them. Breadth still does something real — it gives *variance across runs* rather than noise within one.

**A drafted card brings all its copies.** This is deliberate: drafting three of your six would silently cap the unit at level 2 and the player would have no way to know why. Bringing the whole holding makes the level ceiling legible from the draft screen.

**The draft also recovers something the no-deck decision gave up.** Every run now opens on a distinct hand dealt from your collection, so runs differ even when the collection is static — which is most of what replayability needs, and it arrives without a registration step or a pre-run planning phase. It is a draft, not a deck: you did not choose it, and you play what you were given.

**Note the tension with attrition.** §7.4's vendor buyback destroys bulk; this creates standing demand for six copies of it. They pull in opposite directions on the same population. Probably healthy — buyback sets a floor, play demand sets a ceiling — but the buyback rate needs modelling against play demand rather than in isolation, and the six-copy threshold makes that pull considerably stronger than the earlier three-copy version did.

**Eligibility.** A copy is draftable if it is owned, unslabbed, and not escrowed in another run. Slabbing removes a copy from the draft weight and from the level ceiling — slab your sixth Pikachu and that unit caps at level 2 until you crack it. This is the fourth term in the crack decision (§6.4, §10.2) and the first that is a hard number rather than a judgment call.

### 12.3 Units derive from imported fields

Per §12.12's scope discipline, no per-card authoring. A unit reads only these fields, all of which arrive with the import (§8.2):

| Field | Use | Scaling |
|---|---|---|
| `hp` | Health | `hp / 10`, range ≈ 3–34 |
| attack `damage` | Attack | `damage / 10`, range ≈ 1–30 |
| attack `cost` (length) | **Charge time** | 1–5 rounds |
| `weaknesses[]` | Damage taken | Printed operator, honoured as-is |
| `resistances[]` | Damage taken | Printed operator, honoured as-is |
| `types` | Type synergies | Threshold traits at 2 / 4 / 6 |
| `stage` | Position traits | Basic favours bench, Stage 2 favours active |
| `suffix` | Bounty tier | ex/V/GX = 2, VMAX/VSTAR = 3 |
| `retreat` | Repositioning cost | Against a 2-point shop-phase budget |
| `rarity` | ₱ cost | Field on the rarity reference row (§5.2) |
| `regulationMark`, `legal` | Format eligibility | §12.8 |

**Charge is the load-bearing choice here.** Energy cost becomes a counter that fills by one per combat round; at full, the unit attacks and resets. A 1-cost 20 attacker swings every round for 2; a 4-cost 180 attacker swings roughly every fourth round for 18 and has to survive to do it. This gives burst-vs-sustain as a real axis, makes the active slot matter as a shield, and opens the best trait space in the design — pre-charging at battle start is straightforwardly energy acceleration, a genuine Pokémon archetype that would otherwise have no representation. It costs one integer of per-unit combat state.

**Weakness and resistance are the highest value-per-unit-of-work item in this section.** Near-universal, zero authoring, unmistakably Pokémon, and they turn composition into a read on the current metagame rather than a solved optimum. Build these before any authored trait.

**But they are not uniform, and honouring the variation is free.** An earlier draft assumed a flat ×2 and −3; the printed values differ by era and sometimes by card:

| Era | Weakness | Resistance |
|---|---|---|
| Original – EX | ×2 | −30 |
| Diamond & Pearl – Platinum | Additive, mostly +10 to +40, rarely +50 | −20 |
| HeartGold & SoulSilver – Sword & Shield | ×2 (operator still printed) | −20 |
| Scarlet & Violet | ×2 | −30 |

Both arrive as arrays of `{type, value}` where value is a *string* carrying its own operator, so the rule is: **parse the operator, apply it, scale additive values by the same /10 the damage figures use.** Multiplicative stays as written; `+30` becomes `+3`; `-20` becomes `-2`.

Three consequences worth having:

- **Additive weakness is a power-creep counterweight that already exists in the data.** On a 30-damage DP attack, ×2 and +30 are identical. On a 180-damage modern attack they are 360 and 210. So old cards, which carry additive weakness, are structurally *less* exposed to being blown out than modern ones — an era-flavoured defensive edge that §12.8 otherwise has to manufacture. Normalising everything to ×2 would throw this away for nothing.
- **Dual weakness applies twice.** Cards with two weakness types — mostly ex and LEGEND — take the modifier once per matching type, so a dual-weak ex can face ×4. That is a large, free risk term landing on exactly the high-rarity cards §12.5's bounty already taxes.
- **Absence is a real advantage.** Plenty of cards carry no weakness, no resistance, or neither. A unit with no printed weakness is genuinely harder to counter, and that falls out without a trait being written.

Multiple entries resolve in printed order: all weaknesses, then all resistances, then floor at 1.

**Attack selection is a shop decision.** A card with multiple attacks presents them at purchase; the player picks one and it is locked for the run. This is a single click, it is not an in-battle decision (so §12.12 holds), and it gives two-attack cards a fast-cheap / slow-big choice derived entirely from imported data.

**Level multipliers: ×1.8 at level 2, ×3.0 at level 3,** applied to both HP and attack. These are deliberately *sub-linear* against the 3-and-6-copy thresholds in §12.2 — six level-1 commons out-stat one level-3 common on raw numbers. Merging buys **slot efficiency**, and with a six-slot board you cannot field six copies of anything anyway, so it is the only route to a board that is both deep and varied. It is weak early when slots are free and decisive late when they bind. The additional incentive is that level-3 units unlock the upper tier of their type synergy, so merging is a commitment to an archetype rather than a stat upgrade.

**Traits: roughly thirty behaviours, clustered.**

| Cluster | Count | Examples |
|---|---|---|
| Type synergy | 11 | One per type, scaling at 2 / 4 / 6 units |
| Stage position | 3 | Basic bench bonus, Stage 2 active bonus |
| Charge manipulation | 5 | Pre-charge on start, accelerate on ally faint, drain enemy charge |
| Faint triggers | 5 | Scaled by suffix tier |
| Defensive | 4 | Resistance conversion, damage caps, bench protection |
| Merge-tier | 2 | Level-3-only synergy upgrades |

**Bench sniping is a free derivation.** Real cards that damage benched Pokémon map directly onto a trait that redirects past the active — the vocabulary already exists on the cards, and it is the natural counter to the artillery formation in §12.5.

### 12.4 The shop

Two tracks, drawn separately so items cannot crowd out units or vice versa.

| | Width | Contents |
|---|---|---|
| **Unit track** | 3 (rounds 1–3), 4 (4–6), 5 (7+) | Drawn from the run's drafted unit pool (§12.2) |
| **Item track** | 2 | Drawn from the run's drafted item pool |

Draws are without replacement from the drafted pool; rerolled and sold cards return to it. Widening the unit track as the run progresses is deliberate: shop noise is the main obstacle to executing a plan, and reducing it as stakes rise means late rounds reward intent rather than luck.

- **Pokémon Dollars:** `min(9 + round, 15)`. Round 1 gives ₱10, round 6 onward gives ₱15.
- **Reroll:** ₱1, unlimited.
- **Freeze:** free, persists across rounds. With a pool this large, freeze carries much more load than in SAP and should be generous.
- **Sell:** refunds cost − 1, releases escrow on the backing copies.
- **Reposition:** 2 points per shop phase, each move costing that unit's retreat cost. Zero-retreat units are fluid; heavy ones are anchors.

**Pokémon Dollars are not Coins, and the separation is structural rather than cosmetic** (§7.3). ₱ is per-round run scrip: granted freely, spent in the shop, destroyed when the run ends. If the shop spent Coins instead, the auto-battler would be granting real currency every round and would become the largest faucet in the design — a direct violation of §12.9. ₱ must never convert, carry over between runs, or be tradeable.

**₱ cost lives on the rarity reference row**, not in code — §5.2 already establishes rarity as era-scoped reference data with an ordering, and cost is one more column on it. Defaults: Common/Uncommon ₱3, Rare ₱4, Double Rare ₱6, Ultra and Illustration tiers ₱8, Hyper and Mega tiers ₱10. Items ₱3, Ace Spec ₱5.

Rarity-as-cost does something hard tier-gating would not: you can draw your Charizard ex on round one, be unable to afford it, and have to decide whether to burn a freeze slot on it for three rounds. Collection curve becomes a live constraint — an all-ex collection cannot function, an all-common collection floods the board but caps out.

### 12.5 Combat

Deterministic, server-side, replayable.

**Formation.** All units attack when charged; the default target is the enemy **active**. The active is a shield and the bench is artillery — which is what makes the single active slot mechanically meaningful rather than decorative, and what makes bench-sniping traits (§12.3) the natural counter.

**Round order**, fixed:

1. Start-of-battle triggers resolve, ordered by descending attack, ties broken by ascending board index.
2. Every unit's charge counter increments by 1.
3. All units at full charge declare simultaneously.
4. Damage applies simultaneously: `attack × level_mult`, then each weakness entry by its printed operator, then each resistance entry, floor 1 (§12.3).
5. Charge resets to 0 for units that attacked.
6. Faints resolve; faint triggers fire; bounty applies; the bench slides forward to fill the active slot.
7. Repeat from 2.

**Round cap: 30.** On cap, the side with the higher remaining fraction of starting HP wins; exact ties are draws.

**Bounty.** When a suffixed unit faints, the *opposing* side takes Prizes — an immediate distributed buff, 2 for ex/V/GX, 3 for VMAX/VSTAR. This is a direct transcription of the real prize rule and it is the mechanism by which a high-rarity board can lose *because* it is high-rarity.

**Run structure.** A ladder of battles; 3 losses eliminates; 10 wins completes. Opponents are saved final boards from completed runs, indexed by round number, backfilled with generated boards until the population supports real ones.

### 12.6 Trainers as items

The real card frame already sorts Trainers into the three categories this needs.

| Subtype | Analogue | Behaviour |
|---|---|---|
| **Item** | Honey, Meat Bone | Attach to one unit. Permanent, travels with it. |
| **Supporter** | Canned Food, Sleeping Pill | Consume immediately. Board-wide or targeted. |
| **Stadium** | *(none in SAP)* | Persists across rounds and affects **both** teams. |

**Stadium is the novel object and it comes straight from the source material.** One Stadium in play per battle, visible to your opponent, modifying their board as well as yours; on conflict the defender's holds. There is no auto-battler equivalent, and it is a genuinely distinctive mechanic obtained from a rule the cards already carry. Ace Spec Trainers are the exact analogue of a rare high-impact item, and the one-per-deck restriction is likewise already printed on the card.

**Behaviours are keyed to normalised card name, with a fallback tier.** This bends §12.3's no-authoring rule and the bend is deliberate:

- Known name → authored behaviour. Roughly 40 to start: Ultra Ball, Professor's Research, Boss's Orders, Switch, Rare Candy and the rest of the perennials. Weakness Policy is a natural early pick, since §12.3 makes weakness load-bearing and a card that cancels it already exists. Every reprint of that name inherits it automatically, across every set that has ever printed it.
- Unknown name → generic effect by subtype and rarity. A small stat buff, a cheap reroll, a minor board effect.

**Name matching is not text parsing.** It is an exact lookup on a normalised string, versioned per era, and it degrades gracefully — which is why it does not contradict §12.3. Every Trainer is playable on day one; the famous ones get authored over time, which makes "Ultra Ball now does something specific" a legitimate content patch rather than a bug fix.

Consumed Supporters return to the collection when the run ends. Nothing is destroyed, consistent with §12.1's hold principle.

**This is the largest single expansion of the demand axis the auto-battler provides** — arguably larger than what it does for common Pokémon. Outside full-art Supporters there is no Trainer chase card, so most Trainers are the definition of bulk, with no play demand and weak collector demand. This gives the whole population a job.

### 12.7 Energy, and what it costs to exclude it

Basic Energy is out. Charge (§12.3) already models energy as a mechanic, so basic Energy cards would model the same thing twice, and hundreds of copies per player would drown the copy-count weighting in §12.2.

The honest cost: **basic Energy is now the one population with neither play demand nor collector demand.** §7.4's vendor buyback is its only sink. That is probably correct — real bulk energy is genuinely worthless — but the auto-battler solves the bulk problem for commons and explicitly *not* for energy, and that should not be discovered later.

Special Energy is in, as an item. It is mechanically a Trainer-like attachment, it is uncommon-or-better, and it carries real collector value.

### 12.8 Formats and power creep

The objection to letting any card play any other is that twenty-five years of power creep makes a modern ex flatten a 1999 common. Four defences, in descending order of strength:

1. **Format brackets.** *Common* (Common and Uncommon only), *Standard* (current regulation marks), *Unlimited* (everything). The Common bracket is a legitimate competitive mode with near-zero entry cost, it is a real thing in real card games, and it is close to free to implement given `rarity` and `regulationMark` already import.
2. **Squared draft weighting and the six-copy level-3 threshold** (§12.2) mean depth beats breadth, and depth is only affordable in cheap cards.
3. **Bounty** (§12.5) taxes rarity directly, in the game's own idiom.
4. **Rotation** via `regulationMark`, which doubles as an economy lever for §11.4's event calendar.

### 12.9 Invariants

Code-level, enforced in trait derivation rather than by convention.

**Slabbed cards cannot play.** A sealed card is sealed. Grading already costs currency and inspectability (§10.2); now it costs usability and, via §12.2's level cap, a measurable amount of power. The crack decision becomes a four-way trade between certification, inspectability, playability and roster depth.

**Condition, grade and printing never affect power.** Trait derivation must not read `condition`, `grade`, `printing`, `stamp`, or `serial`. A beaten common plays identically to a gem mint one, and a Master Ball reverse plays identically to a bulk non-holo of the same card.

The printing clause is an extension to the original invariant and it matters. Together with the condition clause it makes the **collection-grade / play-grade split two-dimensional**: play demand pulls toward cheap *printings* as well as cheap conditions. That puts a genuine floor under ordinary non-holos, not just under damaged cards — and it means the cheapest available copy of a card is always the correct one to play, which is exactly what real players do.

**Pokémon Dollars never leave the run.** They are not convertible to Coins, do not carry between runs, and are destroyed at run end (§12.4).

**Rewards are never currency, and ranked entry costs it.** Cosmetic sleeves (§10.5), achievements (§11.1) and ladder rank, against a fee on every ranked run (§12.11). A currency reward here would be a faucet gated on collection size, which inverts the entire purpose of the mode — and the fee means the mode is net-negative currency for every participant, the champion included.

**One tradeable exception: the seasonal trophy promo** (§11.5), awarded to the top 64 of each season's ladder. This is a deliberate amendment to the original no-tradeable-rewards rule and it is safe for three specific reasons — it is *minted* rather than drawn, so it takes nothing from finite supply; it is *positional*, so it cannot be farmed by volume; and the season's bracket rotates (§12.11), so it cannot be reliably bought with collection size. Remove any one of those three and the exception stops being safe.

**Play uses owned copies.** A virtual pool would have no economic effect, and the orthogonal demand axis is the whole reason this section exists.

### 12.10 Escrow and supply

Escrow accrues **during** the run, at purchase, not at run start — the pool is everything you own and cannot be locked wholesale.

- Backing copies for each purchased unit (up to 3 each, 6 units) and each purchased item are escrowed on purchase.
- Escrowed copies cannot be listed, traded, graded or slabbed until the run ends.
- Selling a unit in the shop releases its copies immediately.
- A copy cannot be escrowed in two concurrent runs.

Ceiling is roughly 18 units' worth of copies plus items, comparable in magnitude to a deck lock and closing the obvious exploit of starting a run, selling the cards and keeping the board. This makes rosters a **reversible supply sink** with a natural release valve, per §7.4.

Outside a run, §12.2's hold rule still applies at team level: sell a backing copy of a saved board and the unit downgrades when that board is next fielded.

**Teams are a display surface.** A saved final board is your collection presented functionally — another curation object for §10, and the thing other players fight, which makes it public by construction.

### 12.11 Seasons

The ladder runs in **six-week seasons**, roughly eight a year, published on the §11.4 event calendar alongside everything else that moves prices.

**Scoring: the sum of your best five runs.** A run scores its win count (§12.5: 3 losses eliminates, 10 wins completes), so a perfect season is 50. Capping at five is the important part — it makes the season a test of peak play rather than of hours available, which is the difference between a ladder people can win and a ladder the unemployed win. Ties break by fewest runs taken to reach the score, then by earliest achievement of it.

**Ranked runs cost currency. Unranked runs are free.**

The split matters. A fee on every run would price out exactly the players §12.8's Common bracket exists to include — someone with a small collection and a small balance would be locked out twice over. So:

| | Cost | Ladder | Trophy eligible |
|---|---|---|---|
| **Unranked** | Free, unlimited | No | No |
| **Ranked** | Entry fee, capped per season | Yes | Yes |

The mode stays fully learnable for nothing, and the stakes live entirely in the ranked track. This is also the honest answer to server cost: unranked resolution is cheap and deterministic, and the escrow rules (§12.10) apply to both, so free runs still lock supply.

**The fee is a sink; the cap is the fairness guarantee. They are not the same lever.** Worth being blunt about this, because a fee looks like it limits entries and for a wealthy player it does not limit anything at all. With this section's best-of-five scoring, unlimited paid entries would mean wealth buys ladder position directly — more attempts, more chances at five good runs — which is precisely the failure mode §12.9's rewards invariant exists to prevent. So:

- **25 ranked entries per season.** Enough that a bad streak isn't fatal, few enough that the ladder is contested on peak play rather than on volume or balance.
- The fee then does purely economic work, and can be priced for the economy rather than compromised into a rationing device.

**The entry fee is paid in gems, priced against the pack** — 1 gem (two packs' worth) for Common, 2 for Standard. Gems rather than Coins is deliberate: it puts ranked entry in direct competition with pack purchases for the same production-limited budget, so laddering costs you supply rather than costing you nothing. It also means a dormant alt account cannot ladder for free (§11.5).

There is no Unlimited entry fee because Unlimited is not ranked (below).

**Fees are burned, never pooled.** No currency prize, no rake redistribution — same treatment as the marketplace fee (§7.3) and the grading fee (§6.4), both of which are pure sinks with non-currency returns. A prize pool would make the mode roughly currency-neutral and destroy the entire point.

Note that this holds even though the trophy has real market value. Selling a trophy moves currency between players and burns the marketplace fee on the way; it never creates any. **The auto-battler is therefore a pure currency sink under every outcome**, regardless of how the trophy prices.

**The fee is a real cost now that it is denominated in gems.** The v0.3 draft correctly downgraded it to a rate limiter, on the grounds that against the host's Coin income 25 entries a season was negligible. Pricing it in gems changes that: gems are production-limited rather than wealth-limited, so 25 Standard entries is 50 gems — roughly a week and a half of a mature account's entire output, and directly traded off against packs. It is still not the module's primary sink (§7.6 is), but it is no longer decorative, and it puts a genuine recurring cost on a dormant alt (§11.5).

**Each season fixes a bracket**, announced with the calendar — and **the rotation is between *Common* and *Standard* only. *Unlimited* is unranked and never carries a trophy.**

The reasoning is the one §12.9's rewards invariant already implies, made sharper by scale. If the Unlimited season's trophy reliably goes to the deepest collection, that season is a wealth prize with extra steps, and its Champion card carries a visibly different kind of prestige from one won in Common. With a large playerbase that is one story among many. With seven players it is one specific person winning the same season every time, and everyone knows the outcome before it starts.

So Unlimited stays as a sandbox — free, unranked, unlimited entries, the place to throw your whole collection at something — and every trophy in the cabinet means the same thing. The rotation between Common and Standard still does its other job: keeping any one collection shape from being permanently optimal, and guaranteeing that a near-zero-entry-cost season comes around regularly.

**What resets and what doesn't** — this is §11.1's snapshot-versus-live distinction applied unchanged:

| | On season end |
|---|---|
| Ladder position | Resets to zero |
| Placement achievement | Permanent, dated (§11.5) |
| Trophy card | Permanent, tradeable, minted on award |
| Escrowed copies | Released; in-flight runs are voided at the boundary and refunded |

Runs cannot straddle a season boundary. Give the last day a hard cutoff and refuse new runs inside the final hour, or the boundary becomes a scramble.

**The seasonal ladder is the mode's reason to exist for anyone who isn't already sold on it.** Without it, §12 is a sandbox with no terminal objective — which is fine for a collecting game, but it means the demand axis (§12.2) depends entirely on players choosing to play for its own sake. A dated, scarce, permanently-recorded prize is what converts that into a reason.

### 12.12 Scope discipline

Explicitly cut: energy attachment, evolution chains, status conditions, and anything requiring an in-battle decision. That is where the real game's complexity lives and none of it is needed here. **No per-card authoring** — the entire unit model derives from imported fields (§12.3), with the single deliberate exception of the Trainer name table in §12.6.

One honest caution remains. **Balance is permanent maintenance**, because real cards were never balanced against each other outside their intended formats. The trait system limits the cost by giving you thirty knobs instead of fifteen thousand, and the Trainer fallback tier (§12.6) means unauthored content is always playable, but neither eliminates it. This was accepted when the mode was pulled into v1; it is not a surprise to be discovered later.

**The tuning numbers in this section are starting values, not settled ones.** Charge rate (§12.3), the 40 authored Trainer names (§12.6), and the 10-unit / 6-item draft pool (§12.2) were all reasoned to rather than measured, and the draft pool in particular depends on the actual distribution of real collections, which will not exist until the game does. Seven players will surface the answers within a fortnight of play. Ship the values, instrument them, and move them — do not treat them as design commitments.

---

## 13. Settled decisions

The v0.3 draft carried 23 open questions. All are resolved. This section is the register — what was decided, and where the consequence lives.

### Supply and printing

| | Decision | Section |
|---|---|---|
| Sealed product out of print | **Sets sell out permanently.** Admin reprints mint a new `print_run` with its own population, visually distinguishable, announced in advance. | §3.6 |
| Which sheet defines exhaustion | **Neither.** The admin authors *N* packs; impressions derive from it; leftover tokens are destroyed. Population is `N × k × m / M`, ±1. | §3.3 |
| Slot-true or rate-true | **Slot-true, globally.** Published rates become a diagnostic; rate-fitting survives only as a layout generator. | §4 |
| Box guarantees | **Deferred.** Boxes exist as the Friday bundle; guarantees revisited once bundles are live. | §4 |
| God packs in scope | **Yes,** per-set authored rate, netted out of the chase sheet. | §3.8 |
| God pack count public | **No.** *G* is committed in the digest, never displayed. | §3.8 |
| God pack copies in population reports | **Split shown; provenance is a flag on the `Copy`,** never a printing axis, and ignored by slab fungibility. | §6.5, §7.2 |
| Provable fairness | **Cut.** Commitment kept, key never revealed, replay out of scope. | §3.4 |

### Economy

| | Decision | Section |
|---|---|---|
| Conversion cap vs endgame gate | **Neither — packs are bought with the host's existing gems.** No invented currency, no fixed rate, no cap. | §7.3 |
| Market denomination | **Coins.** Cards, marketplace fee, grading fees and buyback are all Coin-denominated. | §7.1, §7.3 |
| Pack price | **1 gem per 2 packs**, sold in pairs. | §7.3 |
| Pack cap | **4/day, global across all live sets, no rollover.** Gems roll over. | §7.3 |
| Bundle | **36 packs, 18 gems, Friday–Sunday window.** Holdable sealed. | §7.3, §3.5 |
| Marketplace fee | **5%, burned, never accumulates rake.** | §7.6 |
| Buyback destroys cards | **Yes, at a floor price**, per-card by population. Module's only Coin emission. | §7.4 |
| Buyback vs merge demand | **Dissolved.** At a floor price, play demand always outbids the vendor. | §7.4 |
| Set duration | **~1 quarter for a flagship.** *N* derived from cadence × throughput, not chosen independently. | §4 |
| API | **None.** Session-authenticated internal routes only. | §7.5 |

### Condition, grading and presentation

| | Decision | Section |
|---|---|---|
| Condition mutable | **Immutable, permanently.** Every attrition mechanic proposed punished engagement. | §7.4 |
| Render determinism | **Deterministic.** Hash-seeded flaw placement; lighting driven by the tilt interaction, not by the viewing session. | §6.2 |
| Render lossiness | Principle settled (bands separable, top band not); **the parameter is playtest-tuned.** | §6.3 |
| Vision bots | **Not a threat model.** No server-side render requirement. | §6.3, §7.5 |
| Grading queue delay | **24 hours**, scheduled near the Friday window where possible. | §6.4 |

### Collection and play

| | Decision | Section |
|---|---|---|
| Promos in master sets | **Excluded.** Separate "with promos" tier as explicit hard mode. Bought copies complete the collection; the achievement records presence. | §11.1, §11.2 |
| Auto-battler in scope | **Ships in v1.** | §12 |
| Unlimited bracket contestable | **No.** Unlimited is an unranked sandbox; trophies rotate between Common and Standard. | §12.11 |

### Deliberately left to playtest

Four numbers are recorded with their reasoning and explicitly not settled. Locking them by analysis before anyone has played would be false precision, and seven players will answer all four within a fortnight.

| | Starting value | What to watch |
|---|---|---|
| **Charge rate** (§12.3) | As specified | Whether battles feel dead in rounds where nothing fires. If so, the fix is a global charge rate, not abandoning the model. |
| **Trainer names authored** (§12.6) | 40 + generic fallback | Which names players freeze for. Ship low; the fallback tier is what makes the number safe to get wrong. |
| **Draft pool size** (§12.2) | 10 units, 6 items | Whether six-copy merges complete in a run, and whether every run plays the same three archetypes. |
| **Render lossiness** (§6.3) | First cut | Predicted grade (private tag) against returned grade. The gap is the measurement. |

### One thing to watch rather than decide

**Does the Common bracket become the real format?** §12.8's near-zero-entry-cost bracket is the pay-to-win defence. If it also turns out to be the most balanced and most played mode, the higher brackets go vestigial and a large fraction of the collection has no competitive home. That is an outcome to observe, not a decision to make in advance — and at seven players it will be obvious within a season. It would be a good problem, but it would be a problem.

---

## Appendix A: Data sources

The variant data problem is largely solved, but by the collector databases rather than the marketplace APIs. **Rates are a separate and much weaker problem** — no official pull rate has ever been published for an English booster pack, and every figure in circulation was reverse-engineered by a third party opening a few thousand packs. Nothing supplies rates as structured data; every source is prose that has to be transcribed into the schema in §4. That is the argument for the provenance-tagged rate table rather than constants.

Recommendation: **build the catalogue on TCGdex or Scrydex, take pack structure from PokéBeach, take modern rates from the TCGplayer studies, take pre-2020 rates from the Elite Fourum guide, and treat everything else as cross-check.**

#### Catalogue and variants

| Source | What it's good for | Notes |
|---|---|---|
| **TCGdex** (`tcgdex.dev`, `github.com/tcgdex/cards-database`) | **Primary, free.** Checklists, finish flags, foil patterns, print-run subtypes, stamps, errors, 14 languages. | Open source, no API key. Clone the repo rather than hammering the API. `variants_detailed` still mid-migration — see caveats. |
| **Scrydex** (`scrydex.com`) | **Primary, paid.** The pattern axis is modelled natively (`variants[]` with per-variant `prices` *and* `pop_reports`), plus a `sealed` products endpoint. | Paid only, from $29/mo, no free tier. The per-variant PSA/BGS/CGC population data is the strongest reason to consider it — see below. |
| **TCG Collector** (`tcgcollector.com`) | The most complete variant checklist in the hobby, including obscure regional printings. | **Reference only.** API access is restricted to business partners; personal projects are explicitly not approved. Browse to resolve disputes; do not build on it. |
| **pokemontcg.io** | Cross-check, TCGplayer price-type keys, English-first convenience. | Still works but flaky (~55% reliability, ~8s responses). Cache aggressively. |
| **TCGplayer / Cardmarket product listings** | De facto commercial ground truth: if a variant is sellable it has a SKU. | Poké Ball and Master Ball are handled as "separate products" outside the standard printing enum, so an external mapping layer is unavoidable. |

#### Pack structure and rates

| Source | What it's good for | Notes |
|---|---|---|
| **PokéBeach set guides** | **The only source for pack structure and per-set variant rules.** States slot counts, which slots carry which classes, and the eligibility predicate in words. | Prose, one article per set. Manual entry. Nothing else covers this at all. |
| **TCGplayer pull-rate studies** | Modern English rates. 1,200–2,000 packs per set is the current gold standard. | Published as articles, usually surfaced through PokéBeach. One per set, lagging release by weeks. |
| **ThePriceDex** (`thepricedex.com`) | Pre-joined view: per-set rate tables with per-pattern rows, plus variant pool sizes cross-tabulated by rarity. Japanese sister site at `thepricedexjp.com`. | Built on Scrydex + the TCGplayer studies. The **pool tables are the valuable part**; the pattern × rarity rate rows are derived arithmetic (see §4). No API, affiliate-funded, per-set coverage lags release. |
| **Elite Fourum rarity guide** | Pull rates for everything up to and including Sun & Moon. | Fills the era the TCGplayer studies do not touch — essential for authoring a period-accurate vintage set. |
| **PullRates.com** | Quick per-set rate tables for very recent releases. | Thinner sampling. Useful when nothing better exists yet. |
| **pokemonpricetracker.com** | Grading calibration. <cite index="70-1">Its population endpoint returns PSA, BGS, CGC and SGC population reports including gem rates — the share of submissions grading at the top</cite>, plus bulk CSV export. | The gem rate is exactly the parameter to fit §6.4's noise term against. Scrydex's per-variant pop reports are more granular if you are paying for it anyway. |

#### Assets and reference

| Source | What it's good for | Notes |
|---|---|---|
| **TCG Live** (own scraper) | **Visual assets.** Illustrations, frames, foil masks, pattern textures, symbols — plus a working foil renderer to build the condition layer on. | See §8.3 for what to capture and §9 for the licensing position. |
| **Bulbapedia** | Authority of last resort for foil pattern history and set trivia. | Prose, not structured. Use to resolve disputes, not to import. |

**Note on Scrydex population data.** Population reports attach to the *variant*, not the card. That matters for §6.4 and §6.5, because grade distributions differ meaningfully between a holo and its reverse — reverse holos are more prone to edge whitening on a dark border, and the gem rate reflects it. Fitting one noise parameter per card would blur a real effect that the data can already distinguish.

### Why TCGdex remains the free default

Scrydex models the pattern axis more cleanly and prices per variant, so if the budget exists it is the better catalogue. TCGdex is still the right free starting point, and its `variant_detailed` schema is close to a one-to-one match for the model in §5 — which is a strong signal the model is right, and means adopting its vocabulary is nearly free:

| §5 concept | TCGdex field |
|---|---|
| Finish | `type` — `normal`, `holo`, `reverse`, plus `metal` and `lenticular` |
| Pattern | `foil` — `pokeball`, `greatball`, `ultraball`, `masterball`, `gold`, `cosmos`, `galaxy`, `starlight`, `energy`, `cracked-ice`, `mirror`, `tinsel`, `league`, `player-reward`, and others |
| Print run | `subtype` — `shadowless`, `unlimited`, `1999-2000-copyright`, plus error subtypes |
| Stamps (§5.5) | `stamp` — an array, ~150 values |
| — | `size` (`standard` / `jumbo`), per-variant `languages`, and `thirdParty` marketplace IDs |

It also carries a `boosters` field on both set and card, indicating which booster products a card appears in. **This is worth attention**, because §4 currently assumes one pack template per set. Real sets ship multiple booster types drawing from different pools, and if you plan to support that, the data is already there.

### Caveats to plan around

1. **`variants_detailed` is mid-migration.** The card object still types variants as either the simple boolean form or the detailed array, and <cite index="65-1">the detailed variant field is actively in development, with known incorrect data for some recent sets and a request to report issues via Discord or GitHub</cite>. Import defensively, handle both shapes, and spot-check any set before committing a print run against it.
2. **Rarity strings need normalising.** The enum contains both `Rare Holo` and `Holo Rare` from different eras, mixes in Pokémon TCG Pocket rarities, and splits at least one rarity that is single in official listings. Map to your own vocabulary (§5.2) on import; don't consume the strings raw.
3. **Weakness and resistance values are strings with mixed semantics.** The fields are arrays of `{type, value}`, and value carries its own operator — `×2`, `+30`, `-20`, `-30` — so the same field is multiplicative on some cards and additive on others (§12.3). Three gotchas: the multiplication sign is U+00D7 and not an ASCII `x`, some derived datasets strip the operator and emit a bare `2`, and the arrays are frequently empty. Normalise to an explicit `{op, magnitude}` on import; never consume the string raw.
4. **Verify promo set coverage before committing to §11.5.** The whole promo model now reads from imported promo checklists rather than authored cards, so promo set completeness — numbering, artwork, the `size` field that flags jumbos — is on the critical path in a way ordinary expansion data is not. Spot-check it early; it is the kind of thing community catalogues cover unevenly.
5. **Check the licence before shipping.** The repo is public and community-maintained, but the licensing of the *data* is a separate question from the code, and neither changes the fact that the underlying card names and artwork are The Pokémon Company's (§9). This reinforces the earlier recommendation: keep structure and assets as separate objects.
6. **Community data has gaps.** 98 open issues and 29 open PRs at time of writing is a healthy, active project — and also a reminder that coverage of very recent sets lags. Treat a newly released set's data as provisional.

---

## Appendix B: Build order

Revised for v1 scope: the auto-battler moved forward, provable fairness removed, boxes folded into the bundle.

| Phase | Scope |
|---|---|
| 0 | **Schema.** Get the foundational assumptions right in the first migration: `Copy` is individually addressable with an owner, a lifecycle state (`raw`/`slabbed`/`sealed`/`destroyed`), mutable-but-unwritten condition columns (§7.4), and escrow. §12.9's "play uses owned copies" and §12.1's "slabbed cannot play" are schema facts, not features. |
| 1 | **Sheet engine.** Domain model, Feistel draw, pack open, god pack permutation and netting (§3.8), commitment digest (§3.4). Much of this exists — see Appendix C. No UI beyond a debug view. |
| 2 | **Admin set authoring** + sheet designer with live population and rate diagnostics (§8.1). |
| 2.5 | **Asset pipeline** — TCG Live scrape, component extraction, foil masks (§8.3). Runs in parallel; gates phase 3. |
| 3 | **Condition sub-scores, card renderer with zoom and tilt** (§6.2), collection UI, checklist tracker. 3D-native from the start (§10.1). |
| 4 | **Gem purchase flow** — daily allowance, Friday bundle, sealed pack and bundle inventory (§7.3, §3.5). This is the first phase that is playable for real. |
| 5 | **Grading service**, slabs, sub-grade premium tier, population reports (§6.4, §6.5). |
| 5.5 | **Display** — 3D slab viewer, return ceremony, binders, sleeves, shelves, public profiles (§10). |
| 6 | **Marketplace** — fixed-price listings first, then direct trades, then standing buy orders on the slabbed book, then auctions (§7.1). Ownership chain (§11.3) ships with the first listing, not later; it is the wash defence. |
| 7 | **Auto-battler** (§12) — weakness/resistance and charge first, then shop tracks, then traits, then the Trainer item layer. |
| 8 | **Achievements, promos, seasons.** Trophy promos (§11.5) need the stamp system from §5.5. |
| 9 | Economy instrumentation dashboard (§7.3), buyback, event calendar. |
| 10 | Official-set import beyond the launch pair. |

**The sheet engine is the load-bearing piece** and everything else assumes its guarantees. Build and test it first, including a test that opens an entire print run and asserts final populations match `N × k × m / M` exactly. That test exists (Appendix C) but currently asserts the wrong formula and needs rewriting.

**Launch content is two sets** (§4): one small at *N* ≈ 1,000 and one flagship at *N* ≈ 2,500. The reference implementation already builds sheets for Pitch Black (ME5), Perfect Order (ME3) and Prismatic Evolutions (PRE), so phase 1 ships against layouts that exist and already satisfy the window constraint. Pitch Black is the natural small set at roughly 115 cards.

---

## Appendix C: Reference implementation

`press-run.html` — a standalone test bench implementing §3, §4 and §5 against three real sets: Pitch Black (ME5), Perfect Order (ME3) and Prismatic Evolutions (PRE). It is not a mock. It builds real sheet layouts, permutes real cuts, maintains real cursors, and tracks real populations.

**What it validates.**

| Claim | Result |
|---|---|
| Exact final populations (§3.2) | Full run to exhaustion, 95 chase variants, zero mismatches against multiplicity × impressions. **This assertion is now wrong — see below.** |
| No intra-pack duplicates (§3.3) | Zero across 20,000 packs, from the layout window constraint alone |
| Window constraint satisfiable | Passes on all sheets across all five set/mode configurations |
| Fitted sheets reproduce published rates | Prismatic within 5.3%, Perfect Order and Pitch Black within 2.9% in rate-true mode |
| Pattern axis (§5.3) | Specific Master Ball at 1 in 1,341 against a published 1 in 1,362 |
| God pack count exact (§3.8) | Committed *G* equals opened *G* at every tested rate |
| God pack netting (§3.8) | Prismatic SIR holds at 1 in 46.6 with god packs off, at 1 in 2,000, and at 1 in 800 |
| Infeasible configs rejected (§3.8) | Prismatic at 1 in 250 refuses to commit with a reason |

**Deliberate liberties**, flagged in the tool itself: card identifiers are structural (`PBL-120`) rather than named, since the checklist import supplies names and inventing them for a real set would be misleading; a few Ultra Rares and Special Illustration Rares carry uneven multiplicity so some are genuinely short-printed, which no source records but real sheets do; Pitch Black's Rare and reverse rates are unpublished and inherited from Perfect Order; god pack recipes for the two Mega Evolution sets are authored rather than documented, and marked as such in the UI.

**What needs changing before it becomes the phase-1 implementation.**

1. **The population assertion is against the wrong formula.** It checks `m × R`, which was correct when the run continued until a sheet emptied. §3.3 now ends the run at the *N*th pack and destroys the remainder, so the correct assertion is `N × k × m / M`, tolerant of ±1 for the partial final impression. This is the load-bearing test in the whole design and it currently proves a property the design no longer has.
2. **Rate-true mode is no longer an output mode** (§4). Keep the fitter as a layout generator; remove it as a commit-time policy. The "fitted sheets reproduce published rates" row changes from a claim to a measurement.
3. **Scale is an order of magnitude off.** The bench runs 20,000 packs and full-run exhaustion; production sets are *N* ≈ 1,000–2,500. Nothing about the engine is affected, but designer defaults, preview sample sizes and the exhaustion test all need rescaling — and at production *N* the interesting output is the population table, not the rate table.
4. **Reveal and replay are cut** (§3.4), not pending. Remove the sellout key reveal. Keep the commitment digest and extend it to cover *N* and *G*.
5. **Concurrency.** The bench is single-process. Production draws must be a single guarded statement against the cursor, per Appendix D — a `SELECT` followed by an `UPDATE` is a duplicate-pack bug waiting for two simultaneous purchases.

**What it still does not cover.** Condition (§6), grading (§6.4), the marketplace (§7), bundles (§4), reprints (§3.6), and promos (§11.2).

---

## Appendix D: The host platform

The collector sim is a module inside **Polynux**, an existing Nuxt application, not a standalone product. Everything in §7 depends on facts about that host, so they are recorded here rather than left to be rediscovered.

### Stack

| | |
|---|---|
| Framework | Nuxt 4, Vue 3 |
| UI | Nuxt UI v3 — use its components and **semantic colour tokens** (`text-primary`, `bg-elevated`, `border-default`), never raw hex or Tailwind palette values |
| ORM | Drizzle, PostgreSQL |
| Auth | better-auth; server-side session via `auth.api.getSession({ headers: event.headers })` |
| Package manager | **bun, exclusively.** `bun.lock` is the only lockfile |

The module follows the house layout: routes under `server/api/<module>/`, tables prefixed per module, shared game logic in `shared/utils/gamelogic/` so it can run on both sides.

### Existing modules

Roughly ten already ship: miner, colony, hack, xeno, pirates, shapezz, pathwarden, firewall, and a set of casino games (blackjack, limbo, dice, wheel and others), plus a bank with interest and loans, a chat, a leaderboard and an AI assistant.

**This matters for what the collector sim should be.** The host already has nine ways to spend an evening. What it does not have is a player-to-player market in scarce, unique, permanently finite objects. Where a design choice would make this module more like the others, it is usually the wrong choice.

### Currency

| Column | Type | Notes |
|---|---|---|
| `user.balance` | `numeric(19,4)` | **Coins.** Amounts are passed as *strings* throughout, matching the column |
| `user.gems` | `integer` | **Gems.** No fractions — this is why packs are sold in pairs (§7.3) |
| `user.rake` | `numeric(19,4)` | Accumulated rakeback credit |
| `user.rakebackUnlocked` | `boolean` | |

`server/utils/balance.ts` provides `credit`, `debit`, `getBalance`, `getHistory`, `creditGems`, `debitGems` and `accumulateRake`. Every one writes a row to `transactions` with an optional `category` tag — use it (`cards:pack`, `cards:market-fee`, `cards:grading`, `cards:buyback`) and §7.3's instrumentation is most of the way built already.

`debit` throws a 400 on insufficient funds; do not pre-check. All of them accept an optional trailing `tx`, and **inside a transaction holding a row lock you must pass it**, or the write goes out on a second pool connection and deadlocks against your own lock.

**`RAKEBACK_RATE` is 1% of wagered volume, returned to a locked balance.** The marketplace fee must never call `accumulateRake` (§7.6). The pattern is idiomatic in this codebase and will be reached for by reflex.

### The gem exchange — already built

This is the mechanism §7.3 rests on, and it exists.

- `gem_orders` — side, price in **Coins per gem**, quantity, filled, status. Max 100 open orders per user.
- `gem_trades` — one row per executed match; doubles as the price history.
- Matching is fully serialised under a transaction-scoped advisory lock (`pg_advisory_xact_lock`), so a fill can never race a cancel or another fill. **This is the model to copy for the card marketplace's matching engine.**
- `getGemGuidePrice()` returns a volume-weighted average over the last *N* trades, **excluding self-trades** — a player filling their own offer is wash volume at an arbitrary price. That exclusion is precedent worth noting: the host already reasoned through the same problem §7.5 faces.
- Launch anchor price is 300 Coins per gem. There is **no fee** on the exchange, so §7.6's 5% has no in-repo precedent to match.

The guide price already feeds lootbox economics and leaderboard wealth. Adding pack purchases makes it load-bearing for a third system — worth knowing before tuning anything against it.

### Gem production

| Source | Rate |
|---|---|
| Miner gem factory | +0.5/day per level → **10.5/day** at L20 |
| Colony gem snail | hard cap **3/day** |
| Hack ops | occasional lump rewards |

A developed account produces roughly **13–15 gems/day**; an early one 2–3. §7.3's pack pricing is set against these figures.

### Concurrency doctrine — non-negotiable

The house rule, and the collector sim violates it in more places than most modules would:

> **A `SELECT` to check followed by an `UPDATE` to apply is always a bug.** Under READ COMMITTED, *n* concurrent requests all read the same pre-state, all pass the check, and all apply. This has been exploited in this codebase before — ten parallel claims paid out ten times.

Two acceptable patterns:

- **Claim-then-reward.** Flip a flag with a conditional `UPDATE ... WHERE ... AND flag = false RETURNING`, and only pay out if a row came back.
- **Lock-then-read.** `SELECT ... FOR UPDATE` inside a transaction, read the row *inside* the lock, and pass that `tx` to every write.

**Never compare-and-swap on a `timestamp` column.** Postgres stores microseconds; Drizzle hands back a JS `Date` holding milliseconds, so an equality guard against a `defaultNow()` value matches zero rows and fails closed forever.

Where this bites in this design:

| Surface | Guard |
|---|---|
| Sheet cursor (§3.3) | `UPDATE sheets SET cursor = cursor + k WHERE id = ? AND cursor + k <= limit RETURNING cursor`. No row back means no pack |
| Daily pack allowance (§7.3) | Conditional update on the allowance row; the mutation is the guard, not a count query |
| Friday bundle claim (§7.3) | Claim-then-reward on a per-window flag. One claim per window, enforced by the flip |
| Marketplace purchase (§7.1) | Conditional `DELETE ... RETURNING` on the listing; credit the seller only if a row came back |
| Escrow (§12.10) | Conditional update asserting the copy is not already escrowed |
| Promo claim (§11.2) | The achievement row *is* the one-per-account guard — insert it under a unique constraint and let the constraint do the work |

### Randomness

`shared/utils/random.ts` provides `randomFloat`, `randomInt`, `randomPick`, `randomChance`, backed by a CSPRNG. **`Math.random()` is forbidden for anything deciding an outcome** — it is xorshift128+ with state shared across every request the process serves.

Two notes specific to this module:

- **`sheet_key` generation** uses this, once, at set creation.
- **The draw itself does not.** §3.3's Feistel is deterministic by design — the permutation is fixed at creation and the cursor selects into it. Reaching for the RNG at draw time would silently destroy the finite-supply guarantee. This is a place where the house rule points the wrong way if applied without thinking.

Condition sub-scores (§6.1) are rolled once at copy creation and use the CSPRNG. Flaw *placement* (§6.2) is hash-derived, not random.

### Client conventions

- `useAuth()` exposes a reactive `user`; call `fetchSession()` after any mutation touching balance or gems.
- `formatNumber(value, compact?)` — use it everywhere balances or gem counts are displayed.
- `user.balance` is a numeric string; parse before comparing.

### What is not there

**No public API.** Routes are session-authenticated internal endpoints (§7.5). Anyone in the group can script against their own session with a cookie, which is a social question rather than a technical control.

**No fee infrastructure on the existing exchange**, no escrow primitives, and no scheduled-job runner in evidence — the 24-hour grading queue (§6.4) and the Friday window (§7.3) both need one, and it is worth checking whether the host has a scheduler before assuming.
