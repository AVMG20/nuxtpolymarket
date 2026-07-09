# Agent Bios & Recruit-Reveal Barks

Agents are procedurally generated (`generateAgentDef` in `hack-config.ts`):
random codename from a 24-name pool, random class, rarity-driven trait
count. There is no per-agent authored backstory today, and with an unbounded
number of possible agents across every player, **we should not try to hand-
write a unique bio per agent** — instead, this file defines a *template
system* that composes a short bio from class + rarity + trait data already
on the agent, so every agent feels individually written without needing
bespoke content per codename.

## 1. Bio composition system

A bio is one sentence, assembled at agent-generation time (or lazily on
first view) from three parts:

`[Class opener] + [Rarity modifier clause] + [Trait-flavored closer]`

### Class openers (pick fixed per class — these are the class's identity)

| Class | Opener |
|---|---|
| Infiltrator | "Gets in before anyone knows there's a door." |
| Cryptographer | "Sees the pattern in the noise faster than the system that hid it." |
| Social Engineer | "Doesn't hack the network — hacks the person holding the badge." |
| Bruteforce | "Doesn't finesse a lock. Removes it." |

### Rarity modifier clauses (pick fixed per rarity — sets the "how good")

| Rarity | Clause |
|---|---|
| Ghost | "Green, but hungry." |
| Operative | "Field-tested, no complaints on file." |
| Specialist | "The kind of resume that gets flagged, then buried." |
| Elite | "Three agencies have a file open. None of them have a face." |
| Phantom | "Doesn't officially exist. Neither do the people who've tried to stop them." |

### Trait-flavored closers (pick the one matching the agent's *highest-value*
rolled trait type — gives each agent a bio line that reflects what actually
makes them good, not just flavor text disconnected from stats)

| Trait type | Closer |
|---|---|
| `gem_chance` | "Has a nose for the job that pays out in more than cash." |
| `speed_percent` | "In and out before the coffee's cold." |
| `loot_percent` | "Never leaves a job with less than what's on the table." |
| `xp_boost` | "Learns faster than the last op should've allowed." |
| `power_flat` / `power_percent` | "Overqualified for half the jobs on the board, and it shows." |
| `gem_bonus` | "Somehow always finds the safe behind the safe." |

**Full bio example** (Specialist Cryptographer with a dominant `loot_percent`
trait): *"Sees the pattern in the noise faster than the system that hid it.
The kind of resume that gets flagged, then buried. Never leaves a job with
less than what's on the table."*

This system needs zero new database fields — it's pure presentation logic
computed from `agent.class`, `agent.rarity`, and `agent.traits` that already
exist on every `hackAgents` row.

## 2. Recruit-reveal barks (RELAY, one per rarity, reused across all 3 pull tiers)

Plays during the Black Market reveal cinematic (§6.5) the instant the
rarity stamp lands, before the agent card animates in. Same five lines
reused for every recruit source (Script Pull / Dark Web Hire / Ghost
Recruit) — rarity is rarity regardless of which contact found them.

| Rarity | Bark |
|---|---|
| Ghost | "Rookie. They'll do." |
| Operative | "Solid. I've built jobs around worse." |
| Specialist | "Now we're talking." |
| Elite | "...Huh. Didn't expect that out of this one." |
| Phantom | "Don't ask what they used to do before us. I didn't, and I still don't sleep great." |

## 3. Class flavor (for tooltips / wiki / loadout screen headers)

Reference copy for anywhere a class needs a one-line description beyond the
existing passive-bonus text:

- **Infiltrator** — "Slips past physical and digital perimeters alike. Passive: +10% operation speed."
- **Cryptographer** — "Breaks what's supposed to be unbreakable, given enough time. Passive: +6% loot."
- **Social Engineer** — "The weakest link in any security system is always a person. Passive: +1% gem chance."
- **Bruteforce** — "Subtlety is somebody else's problem. Passive: +15 power."

## 4. Portrait direction (see `content/image-prompts.md` for full prompt set)

Per open question #1 in `PLAN.md` §9: recommend a **template + recolor**
approach — one masked/silhouette portrait per class (4 total), then a
rarity-driven treatment layered on top (color grade + accent glow matching
the rarity ladder: zinc → green → sky → amber → rose) rather than 4 × N
unique portraits. Keeps ~15 agents per player visually consistent and is
producible today with 4 base generations instead of an unbounded set.
