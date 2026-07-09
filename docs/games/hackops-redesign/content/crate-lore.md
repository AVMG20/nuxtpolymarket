# Black Market — Contact & Crate Lore

For `black-market.html` (§6.4) and `crate-opening.html` (§6.5). Every
recruit tier and crate tier gets a **seller persona** RELAY introduces in
third person (matching the user's brief: *"a junkie found this crate... you
can buy it if you want"*) — the player never talks to the seller directly,
RELAY is always the intermediary, consistent with §3's single-narrator rule.

Odds/costs quoted here are the real values from `hack-config.ts` — restate,
never invent new ones.

For ElevenLabs generation (model, stability, tag legend), see the "TTS
generation notes" section in `voice-lines.md` — it covers this file too.

---

## Recruit tiers ("Contacts")

### Script Pull — $12,000
*Weights: Ghost 60% · Operative 35% · Specialist 5%*

**Contact:** an anonymous forum handle, `>_ghostwire`, posts "available for
work" threads on three different hacker forums under three different names.
Nobody's sure if it's one person or a bot farm.

**RELAY intro:** "Forum talent. Cheap, plentiful, mostly rookies — but
rookies still show up. Every specialist on your roster was a rookie once.
Probably not the way to bet your whole operation, but a fine way to build
one."

**On purchase confirm:** "Posting the job. Give it a minute."

### Dark Web Hire — $200,000
*Weights: Operative 50% · Specialist 38% · Elite 10% · Phantom 2%*

**Contact:** a vetting service that operates through three layers of
escrow and a reputation system nobody's ever seen the backend of. They call
themselves **The Registry**. Nobody knows if that's one person or an
organization.

**RELAY intro:** "The Registry doesn't deal in rookies. Everyone on their
books has done this before, for someone, somewhere. Costs more because
you're not gambling on potential — you're paying for a track record."

**On purchase confirm:** "Registry's running the vetting now. They're
thorough. That's the point."

### Ghost Recruit — $3,500,000
*Weights: Specialist 36% · Elite 44% · Phantom 20%*

**Contact:** no name, no handle, no forum post. RELAY makes one call, on a
line that gets replaced after every use, to someone RELAY refers to only as
**the old man**. Nobody else on your crew has ever heard that voice.

**RELAY intro:** "[quiet] I'm calling in a favor I've been saving. Whoever
comes back from this isn't auditioning — they're already the best in the
business, and they know it. Don't waste them on the easy jobs."

**On purchase confirm:** "Made the call. Now we wait... and we don't ask
what it cost me."

---

## Item crates ("Dead Drops")

### Junk Cache — $5,000
*Weights: Ghost 65% · Operative 30% · Specialist 5%*

**Seller:** a junkie named **Marsh**, found the case in a storage unit he
was supposed to be clearing out, has no idea what half of it does, wants
enough for his next fix and doesn't care what "half of it" means.

**RELAY intro:** "Marsh found this in a storage unit and has no idea what
he's holding. Might be nothing. Might be something nobody's noticed yet.
That's the whole pitch on a Junk Cache — you're buying the maybe."

**On purchase confirm:** "Paying Marsh before he changes his mind. Or finds
someone else."

### Standard Crate — $40,000
*Weights: Operative 55% · Specialist 38% · Elite 5% · Phantom 2%*

**Seller:** **Denny's Surplus**, a fence who runs an actual storefront (a
legitimate pawn shop, technically) as cover for moving gear that fell off
various trucks. Reliable, boring, always has stock.

**RELAY intro:** "Denny doesn't deal in mysteries. What's in the crate is
what he says is in the crate, roughly — decent gear, no big surprises
either way. Predictable is worth something."

**On purchase confirm:** "Denny's got it wrapped and ready. He always does."

### Premium Stash — $300,000
*Weights: Specialist 55% · Elite 38% · Phantom 7%*

**Seller:** a retired operator who goes by **Cutter**, cleared out a
storage cache before going legit and quietly liquidating one crate at a
time so it doesn't look like what it is.

**RELAY intro:** "Cutter used to be one of us, a long time ago. This is
their retirement fund, sold off a piece at a time. Whatever's still in
their cache is field-grade — they never held onto anything that wasn't."

**On purchase confirm:** "Cutter said this is the last one for a while.
Might want to take it."

### Ghost Cache — $2,000,000
*Weights: Elite 65% · Phantom 35%*

**Seller:** unknown. The listing appears once, unsigned, on a board that
gets wiped every 24 hours, priced in a way that makes clear the seller
doesn't need the money — they need it gone.

**RELAY intro:** "I don't know who's selling this and I stopped asking
after the second one. Whoever it is doesn't need cash — they need this off
their hands, fast, quiet. Everything I've seen come out of a Ghost Cache
has been worth exactly what it should be worth. Draw your own conclusions."

**On purchase confirm:** "Funds are moving. However this crate got here,
it's yours now."

---

## Shared reveal-cinematic barks (rarity stamp, reused across recruits + crates)

Identical five lines to the recruit-reveal barks in `agent-bios.md` §2 —
**intentional reuse**, not a duplication bug: rarity is rarity whether it's
an agent or a piece of gear, and reusing the same five VO clips for every
reveal in the game (agent pulls, crates) keeps the total VO line count for
the entire reveal system at exactly 5 instead of 5 × N sources.

| Rarity | Bark |
|---|---|
| Ghost | "Rookie. They'll do." *(agents)* / "Junk, mostly. Mostly." *(items — see note)* |
| Operative | "Solid. I've built jobs around worse." |
| Specialist | "Now we're talking." |
| Elite | "...Huh. Didn't expect that out of this one." |
| Phantom | "Don't ask what they used to do before us. I didn't, and I still don't sleep great." *(items reuse the Operative-and-up lines verbatim — only Ghost needs an item-specific variant since "they'll do" doesn't read naturally for an inanimate object)* |

**Asset filenames:** `voice/bark-rarity-ghost-agent.mp3`,
`voice/bark-rarity-ghost-item.mp3`, `voice/bark-rarity-operative.mp3`,
`voice/bark-rarity-specialist.mp3`, `voice/bark-rarity-elite.mp3`,
`voice/bark-rarity-phantom.mp3` — 6 files total cover every reveal in the
game (5 agent/shared + 1 item-specific Ghost variant).

**Don't play every one of these on every roll.** Bulk-opening sessions
(~30 rolls at a time) make a bark on literally every pull fatiguing fast,
especially Ghost/Operative since those fire most often. See `PLAN.md`
§5.5 for the throttling design (always play Elite/Phantom in full; throttle
Ghost/Operative/Specialist to roughly every 3–5th roll after the first;
Quick Open always skips it) — this affects implementation/playback logic,
not the lines themselves, so no change needed to the barks above.
