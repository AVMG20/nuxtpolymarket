# Dead Front — design and build contract

A co-op (1–4 players) round-based zombies FPS in three.js, set in 1917 France.
Server-authoritative simulation over a websocket, original code and art (all
procedural: no external models, textures or audio files). **No coins or gems
are paid out**; progression is weapon unlocks, weapon levels/attachments and
perk research only.

Route: `/dead-front` (client-only). Category prefix: `dead-front`.
Code prefix: `Df` / `df` / `DF_`.

## The game

- **Lobby / party**: one socket per tab. A player sees the open lobbies (the
  site has ~10 players, so no private lobbies, no matchmaking): create one,
  join one, ready up, host starts. Solo = create and start alone. A lobby that
  is playing shows its round in the list but can't be joined.
- **Loadout (pre-game)**: start weapon (any *unlocked* `startable` weapon) and
  attachments per weapon (unlocked by weapon level). Weapons unlock
  permanently by being *found* in a match: bought off a wall, taken from the
  mystery box or claimed from the easter egg. Everyone starts with the M1911.
- **Perk research**: pick one perk to research. Every match played adds XP to
  it (`dfPerkXpFromMatch`). Research levels 1–6 each unlock one modifier
  (6 per perk). Per perk the player selects up to **2** unlocked modifiers;
  they apply whenever that perk is bought in a match. A researched perk maxes
  in ~3–4 matches; players play 10–20 matches total.
- **Points**: the classic 10-point system (`DF_POINTS`): +10 per non-lethal
  hit, kill totals 60 body / 100 head / 130 knife, +10 per board repaired,
  start with 500.
- **Rounds**: zombie count and health scale per round (`dfZombieBaseHealth`).
  Four enemy types phase in: Shambler (r1), Ghoul (r5, sprinter), Ironclad
  Brute (r8, armoured helmet, heavy), Bloater (r12, ranged spit, toxic death
  cloud). Max 24 alive. 10 s intermission.
- **Downs**: a downed player gets last stand with their pistol; teammates hold
  to revive (3 s). Bleed-out → dead, respawns next round with the start
  weapon. Everyone down/dead → game over and the end screen.
- **Map "Sainte-Croix"** (~84 m across, voxel art): five zones in a ring
  around a block of gutted houses: the Square (start), Farmyard, Chapel (PaP
  in the chancel), Cemetery (power in the crypt, the pedestal) and the
  Ramparts (generator in the bailey, a wall walk at y = 3 reached by two wide
  stairs). 4 buyable doors close the ring, 12 boarded windows, wall-buys, 6
  perk machines, 3 box spots, power switch. Power powers perks + PaP. The
  layout is authored on a 0.5 m voxel grid (`shared/utils/dead-front/map-world.ts`)
  and compiled in `map.ts` to greedy-merged collision boxes and a nav graph;
  the client greedy-meshes the same grid (`app/utils/dead-front/voxel/`).
- **Pack-a-Punch**: 3 tiers (5000 then 2500 each). Each tier renames the
  weapon, raises damage/mag/reserve and changes the camo glow. The M1911 at
  tier 1+ becomes twin grenade-launcher pistols.
- **Mystery box**: 950, rolls a box weapon incl. the **X-Ray** (brass ray
  pistol firing green bolts with splash). Moves after some rolls.
- **Wunderweapon** (easter egg only, guided by the HUD): restore power →
  collect 3 Tesla fuses → install them in the Arc Generator → kill zombies
  near it to charge it → claim the **wunderweapon** (chain-lightning arc
  rifle) from the pedestal. Steps in `DF_EGG_STEPS`; the HUD shows the step
  text and a waypoint.
- **Perks** (cap 4): Ironhide (health), Quickhand (reload), Twinfire (fire
  rate), Second Wind (revive, self-revive solo), Fleetfoot (move/sprint),
  Steady Eye (aim/headshots). Effects only through `DfPlayerEffects`.
- **Power-ups** (drops on kill): max ammo, double points, insta-kill, nuke,
  carpenter.

## Netcode

- Client-authoritative movement at 20 Hz (`in`), server clamps speed/teleports
  and collides against the map.
- Shots: client runs the shared hit test (`dfZombieHitTest` + `dfRaycast`
  occlusion) and claims hits; the server validates against its own zombie
  positions (lenient tolerance for latency), fire rate (token bucket on rpm),
  magazine and range, then computes damage/points itself from
  `dfWeaponStats` + effects. Projectile weapons (grenades, PaP pistol, X-Ray
  bolts) and the wunderweapon arc are simulated by the server.
- Snapshots at 20 Hz (`DfSnapshot`) with events; clients interpolate remote
  entities `DF_INTERP_DELAY_MS` behind.

## Files and ownership

Contracts (written at kickoff; additive changes only, coordinate through the
owner):

| File | Owner |
| --- | --- |
| `shared/utils/dead-front/types.ts` | orchestrator (frozen; additive only) |
| `shared/utils/dead-front/protocol.ts`, `constants.ts`, `enemies.ts` | server agent |
| `shared/utils/dead-front/weapons.ts` | weapons agent |
| `shared/utils/dead-front/perks.ts`, `progression.ts` | perks agent |
| `shared/utils/dead-front/map.ts`, `physics.ts` | map agent |
| `app/utils/dead-front/context.ts` | engine agent |

Agents:

1. **server** — `server/api/dead-front/ws.ts`, `server/utils/dead-front/**`
   (hub/lobbies, match loop, zombie AI + nav, waves, points, interactions,
   box, PaP, perks purchase, power-ups, downs/revive, easter egg, shot
   validation, projectiles). Calls `applyDfMatchResult` /
   `getDfProfile` from the perks agent at start/end.
2. **weapons** — `shared/utils/dead-front/weapons.ts`,
   `app/utils/dead-front/weapons/**`: weapon + attachment + PaP data,
   procedural 1900s viewmodels (ADS, sway, bob, recoil, reload/inspect/raise
   animations, muzzle flash, shell ejection), world weapon models, PaP camo,
   projectile visuals, weapon sounds.
3. **perks** — `perks.ts`, `progression.ts`, `server/utils/dead-front-profile.ts` (`getDfProfile`, `applyDfMatchResult`),
   `server/api/dead-front/*.{get,post}.ts` (REST), `app/pages/dead-front.vue`,
   `app/components/dead-front/menu/**` (main menu, lobby, loadout/armory,
   perk research, end screen).
4. **map** — `map.ts`, `physics.ts`, `app/utils/dead-front/world/**`: map
   layout and collision, environment rendering (lighting, fog, materials,
   props), interactable visuals (doors, boards, box, PaP, perk machines,
   power, egg parts), zombie models + procedural animation + gore/death FX,
   world/zombie sounds.
5. **engine** — `context.ts`, `app/utils/dead-front/engine/**`,
   `app/utils/dead-front/net.ts`, `app/components/dead-front/game/**`:
   renderer + post, loop, input + pointer lock, player controller, client
   shooting/hit claims, interpolation, remote player avatars, particle FX
   system (`DfFx`), audio manager (`DfAudio`), HUD (points, round, ammo,
   perks, prompts, hitmarkers, damage, downed, objective guide), interaction
   prompts.

The orchestrator wires the site registration (nav, search, home card,
analytics category, route rule) and the changelog.

## Page flow (contract between perks agent and engine agent)

- `app/pages/dead-front.vue` (perks agent) creates one `DfNet`
  (`app/utils/dead-front/net.ts`, engine agent) on mount, `connect()`s and
  shows the menus (lobby list, party, loadout, research, armory).
- On `{ t: 'start' }` it mounts
  `app/components/dead-front/game/DfGameView.client.vue` (engine agent,
  imported explicitly) with `net`, `start` and `profile` props. The game view
  subscribes to `snap` itself and emits `leave` from its pause menu (the page
  then sends `{ t: 'leave' }`).
- On `{ t: 'end' }` the page unmounts the game view and shows the end screen
  (round, scoreboard, `progress`), then refetches the profile.

## Client event routing

The engine forwards every `DfEvent` in a snapshot to all three views; each
view only reacts to its own kinds so nothing is drawn twice:

| Events | Handled by |
| --- | --- |
| `hit`, `kill`, `zhit` gore, `gas` (bloater cloud) | zombie view (map agent) |
| `door`, `plank`, `box`, `pap` (machine), `power`, `fuse`, `soul`, `egg`, `perk` (machine jingle) | world view (map agent) |
| `explode`, `arc` | projectile view (weapons agent) |
| `shot` (remote tracer + sound), `points`, `round`, `roundEnd`, `down`, `revived`, `bleedout`, `respawn`, `powerup`, `buy`, `chat`, hitmarkers, damage feedback | engine (engine agent) |

The squad feed (top right of the HUD: downs, revives, doors, power) is built
by `DfGameView` from the snapshot events with `dfHudFeedLine` (`engine/hud.ts`).
In development, `/dead-front?hud` (or `?hud=down|dead|board|round`) shows the
HUD over mock state for checking hard-to-reach states.

Sounds: the viewmodel plays the local player's weapon sounds itself (2D,
timed to its animations). For remote shots the engine plays
`dfShotSoundName(weapon, pap)` (exported from `weapons/index.ts`) at the
shooter. World and zombie views play their own spatial sounds.

Mixing is the audio engine's job (`engine/audio.ts`), so callers can play
freely: every name maps to a category bus (zombie vocal / foley, own and
remote weapons, world, UI, music, ambience) with a voice cap, distance cull
and per-name retrigger interval. Zombie vocals are globally limited (3 at
once, spaced out; groans only fill gaps), own shots and stingers duck the
horde and the ambience, and the master runs through a limiter. The horde
tension bed follows `audio.setTension(alive / 18)`. In dev,
`window.__dfAudio.log(1)` prints live voice counts every second.

## Wall-buys and the box

Wall-buys on the map: `kar98k`, `mp18`, `m1897`, `thompson` (the weapons
agent sets `wallCost`/`ammoCost` for exactly these). Box only: `c96`, `bar`,
`lewis`, `xray` (plus the wall weapons). `m1911` is the default start weapon;
`wunder` comes only from the easter egg.

## Zombie dimensions

Zombie models are built to the sizes in `DF_ENEMIES` (`height`, `radius`,
`headY`, `headR`) so the shared hit test matches what players see.

## Zombie behaviour and specials

- Hunting zombies steer (eased heading, sideways avoidance of neighbours) and
  about a third swing wide on a flank, so a horde surrounds instead of
  stacking. Stuck zombies try nav detours and are recycled only out of sight.
- Swipes commit at the windup: a step back or aside makes them miss.
- Ghouls leap (`DF_GHOUL_LUNGE`) and brutes charge (`DF_BRUTE_CHARGE`) along
  a line locked when the windup ends. During the windup the snapshot sets
  `DfZombieSnap.tell` (`'lunge'` / `'charge'`, anim `attack`); the dash itself
  is anim `sprint`; a brute is winded (`stagger`) afterwards.
- Bloater spit is aimed where the player stood at release (no leading).
- Own hits flinch locally: the engine sends the zombie view a predicted `hit`
  event when it fires and skips the server's echo for that zombie.

## Balance

`test/dead-front/balance.spec.ts` plays bot squads (1, 2, 4 players) for ten
rounds on the real map and prints points earned against costs per round
(`bunx vitest run test/dead-front/balance --reporter=verbose --silent=false`).
