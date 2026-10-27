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
  is playing shows its round in the list but can't be joined. A member whose
  socket drops keeps their place for `DF_LOBBY_GRACE_MS` (shown as
  reconnecting; the leader can start without them, and while the host is
  away the next member leads). A server restart loses the
  hub: a client that comes back to `{ lobby: null }` after a drop sends
  `{ t: 'rejoin', id, host }`, which rebuilds the lobby under its old id and
  gives the old host the lead back. A match in progress is lost with the
  restart and the client returns to the lobby.
- **Loadout (pre-game)**: attachments per weapon (unlocked by weapon level).
  There is no start weapon to pick: everyone starts, respawns and goes into
  last stand with the M1911 (`DfLoadout.startWeapon` is always `m1911`; one
  stored from before is ignored, and the loadout endpoint takes attachments
  only). Weapons unlock permanently by being *found* in a match: bought off a
  wall, taken from the mystery box or claimed from the easter egg.
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
- **Downs**: a downed player gets last stand with their pistol (the M1911 if
  they carry none); teammates hold to revive (3 s). Bleed-out → dead, respawns
  next round with the M1911. Everyone down/dead → game over and the end screen.
- **Map "Sainte-Croix"** (~84 m across, voxel art): five zones in a ring
  around a block of gutted houses: the Square (start), Farmyard, Chapel (PaP
  in the chancel), Cemetery (power in the crypt, the pedestal) and the
  Ramparts (generator in the bailey, a wall walk at y = 3 reached by two wide
  stairs). 4 buyable doors close the ring, 12 boarded windows, wall-buys, 6
  perk machines, 3 box spots, power switch, 2 electric traps, 2 workbenches. Power powers
  perks, PaP and the traps. The
  layout is authored on a 0.5 m voxel grid (`shared/utils/dead-front/map-world.ts`)
  and compiled in `map.ts` to greedy-merged collision boxes and a nav graph;
  the client greedy-meshes the same grid (`app/utils/dead-front/voxel/`).
- **Pack-a-Punch**: 3 tiers (5,000 / 15,000 / 30,000). Each tier renames the
  weapon, raises damage/mag/reserve and changes the camo glow (a bright band
  sweeps down the gun and the edges take a tier-coloured sheen,
  `weapons/materials.ts`). The M1911 at
  tier 1+ becomes twin grenade-launcher pistols.
- **Mystery box**: 950, rolls a box weapon incl. the **X-Ray** (brass ray
  pistol firing green bolts with splash). Never starts in the start zone;
  every roll has a flat 10% chance (`DF_BOX_MOVE_CHANCE`) to end with the box
  moving to another spot instead (the roll is refunded, the squad feed says
  so).
- **Wunderweapon** (easter egg only, guided by the HUD): restore power →
  collect 3 Tesla fuses → install them in the Arc Generator → kill zombies
  near it to charge it → throw the 3 lightning-rod switches before the clock
  runs out (60 s solo, 45 s co-op from the first throw; a timeout resets them
  with `rod` events, `on: false`, and the squad tries again) → claim the
  **wunderweapon** (chain-lightning arc
  rifle) from the pedestal. Its first target is the zombie the client claims,
  else the one the ray takes (`dfArcAim`, `combat.ts`: the closest point of the
  body's axis, a ~13° cone, and point blank, within `DF_ARC_POINT_BLANK` of the
  body, any zombie in front). Steps in `DF_EGG_STEPS`; the HUD shows the step
  text and a waypoint.
- **Electric traps** (`shared/utils/dead-front/map-traps.ts`, rules in
  `specials.ts`): a lever beside the Churchyard Passage and the Cemetery Gate.
  1000 points with the power on fries every zombie in the passage for 25 s
  (50 points each to the buyer; players only get stung), then 60 s cooldown.
- **Perks** (cap 4): Ironhide (health), Quickhand (reload), Twinfire (fire
  rate), Second Wind (revive, self-revive solo), Fleetfoot (move/sprint),
  Steady Eye (aim/headshots). Effects only through `DfPlayerEffects`.
- **Gas rounds** (`specials.ts`): every few rounds a smaller, faster pack of
  gas-masked ghouls; the client rolls mustard fog over `world.special.pockets`
  and the player coughs standing in it (`dfGasDepth`). It never hurts.
- **Crawlers**: a leg shot can take a zombie's legs (`dfCrawlChance`); it
  drops onto its stumps and drags itself on its arms, with the low
  `crawlHitTest` hitbox.
- **Power-ups** (drops on kill): max ammo, double points, insta-kill, nuke,
  carpenter.
- **Salvage, the workbench, rarity, killstreaks and round challenges**: see
  "Salvage and the workbench" below.

## Netcode

Players are trusted friends, so the local player's actions are
client-authoritative and feel instant; the server keeps only sanity bounds.

- Movement: the client reports its position at 20 Hz (`in`). The server takes
  it whenever the body fits there and the move is within a generous speed
  budget; it only slides a move that ends inside geometry and snaps the client
  back (`tp`) when that leaves it more than 1.5 m off, or on a teleport-sized
  jump. The client eases a divergence over 1.5 m and never rubber-bands.
- Shots: the client runs the shared hit test and claims hits with zone and
  distance. The server checks only sanity (the ray passes within a few metres
  of its zombie, inside the weapon's range; fire rate within a lenient token
  bucket) and computes damage/points from `dfWeaponStats` + effects
  (`shared/utils/dead-front/combat.ts`, shared with the client).
- Prediction: the client applies the same damage rules to the newest
  snapshot health (`hp` is sent to 3 decimals) minus its own unconfirmed
  damage. A lethal hit is claimed with `kill: true`; the zombie drops on that
  frame (hidden from interpolation, death played locally) and the server's
  kill echo is skipped. The server honours a kill claim that leaves a sliver
  (`dfKillClaimHonoured`), so predicted kills agree; one the server refuses is
  undone after a round trip (`DfZombieView.unkill`). Each `fire` / `melee`
  carries a `shot` id and the shooter's `points` event echoes it: predicted
  points pop at once and the echo only shows a difference.
- Ammo, reload and swap are client-driven: `fire` carries the magazine after
  the shot and `{ t: 'reload', mag }` reports a finished reload. The server
  moves rounds between reserve and magazine to match (never creating ammo).
- Buys: doors, perks, wall-buys, the box and Pack-a-Punch take the points off
  and play the buy sound at once; a bought door opens and stops blocking at
  once. The server's `buy` event settles it, a missing one rolls it back.
- Projectile weapons (grenades, PaP pistol, X-Ray bolts) and the wunderweapon
  arc are simulated by the server. The `explode` event of an X-Ray bolt or a
  PaP shell carries its `tier`, so the blast is drawn in the right colour even
  when the bolt was never seen in a snapshot (point blank).
- Snapshots at 20 Hz (`DfSnapshot`) with events. Remote players interpolate
  `DF_INTERP_DELAY_MS` behind (adaptive to jitter). Zombies and view events run
  on a shorter delay (`DfSnapBuffer.zombieDelay`, about one tick): past the
  newest snapshot zombies dead-reckon along `DfZombieSnap.vel` (omitted when
  zero) for up to `DF_MAX_ZOMBIE_EXTRAPOLATE`, and `DfZombieSmoother` blends
  corrections in (at most 2.5 m/s) and springs the height separately.
- Weak links (production: 40-90 ms round trip, regular 300 ms spikes; see
  `test/dead-front/netcode-lag.spec.ts`): the clock offset is the earliest
  arrival over the last second, so a spike and the stale burst it releases
  never move it, and the render clock slews toward it (5%, 20% when far off)
  instead of stepping. Lateness beyond the jitter margin is a spike, kept
  apart (`DfSnapBuffer.spike`, fading over ~50 s); snapshots landing together
  count once. Remote players widen their delay to ride spikes out (up to
  `DF_MAX_PLAYER_DELAY_MS`); zombies keep a short delay and dead-reckon through
  them. Delays change at most 10% / 5% of real time (`dfEaseDelay`). The ping is
  the median of the last 5 (1 s apart), so one caught in a spike is ignored.
- Predictions settle on the snapshot `ack`, not a timeout: each one remembers
  the next input seq, and a snapshot acking it has the server's answer (one
  ordered socket, messages handled as they land), so a late echo is never
  taken for a refusal (`dfPredictionSettled`; 3 s fallback). The same guards
  the magazine against snapshots from before the last shot or reload.
- Server tick loop: fixed 50 ms steps on the wall clock, catching up to 0.6 s
  of host stall (4 steps and one snapshot per callback), so a stall doesn't
  shift the snapshot clock. A peer whose frames Bun drops, or with 8 MB queued,
  is disconnected and resyncs through the reconnect grace.
- Stairs: the server sends a zombie's shown height (`viewY`), a ramp over the
  steps (`dfRampHeight`) eased at walking pace instead of the physics'
  instant step-up. The camera rides the same kind of ramp through a critically
  damped spring (`DfPlayerController.viewFloor`).
- Lag: every `in` carries the client's `rtt`. A zombie swipe whose windup ends
  waits `rtt + 50 ms` (capped at 0.3 s) before it lands, so a step back made on
  the player's screen has reached the server; if their reports have stalled
  (older than 0.15 s, a spike) it holds up to 0.45 s more for fresh ones. A player whose movement reports
  stopped arriving for `DF_STALE_INPUT` (a lag spike, up to 3 s) can't be hit
  by zombies (not again within 10 s of their last stall), and a solo match
  holds still until their reports resume (`DfMatchSim.soloStalled`; a
  reconnected client isn't stalled before its first report).
- Solo pause: losing pointer lock (the pause menu, alt-tab) sends
  `{ t: 'pause', paused }`; the match stops stepping and sending snapshots
  until resumed (ignored in co-op, cleared on reconnect).
- Input: mouse look is raw (no smoothing) and applied the frame it arrives. A
  trigger pull fires on the `mousedown` event itself (`DfInput.onPress`): the
  hit test, prediction and `fire` message leave at once, the next frame only
  draws them. The loop paces motion with the rAF timestamp.
- Gun feel (CoD rules): ADS and sprint, whichever was pressed last wins while
  both are held; firing or reloading drops a sprint (with the class's
  sprint-out before the shot); a fresh sprint press, a swap or the knife
  cancels a reload, keeping the magazine once it is seated (the last fifth,
  `DF_RELOAD_SEATED`) and reporting it with `{ t: 'reload', mag }`.
- Slide (`DF_SLIDE`, `engine/player.ts`): crouch (C) in a sprint on the ground
  launches a short slide (x1.22 speed, capped at 9.6 m/s, inside the server's
  movement budget) on the crouched body; it coasts on friction, steers a
  little, keeps the sprint FOV and leans the view. Jumping out of it (or
  crouching again) ends it with the momentum carried for a moment, and a
  sprint held to the end stands straight back into the sprint. The gun can
  fire throughout.
- Recoil patterns: per class (`DF_RECOIL`) with per-weapon overrides
  (`DF_RECOIL_ID`): the Chauchat climbs and pulls right, the Lewis drifts
  left, the Webley bucks straight up, the flamethrower only trembles.
- Viewmodel momentum: the gun leans into strafes, trails jumps and dips
  harder on hard landings, swings a figure-eight in a sprint and cants over
  in a slide; I inspects the weapon (any action cancels it). Swaps are
  CoD-quick (0.4 s pistols to 0.72 s LMGs, before Quickhand).
- Shaders: the engine compiles every program at spawn (`warmUp`: both scenes,
  every weapon model plain and packed, one of each projectile) into the
  composer's linear target, so the first flash, explosion or camo never
  hitches.
- Dev: `window.__df.prof(seconds)` profiles `frame()` (CPU work per section,
  GPU time via EXT_disjoint_timer_query, frame gaps, programs compiled
  meanwhile).
- Dev: `?lag=80,30` or `window.__df.lag(80, 30)` adds 80 ms to the round trip
  plus up to 30 ms jitter per message; `window.__df.netStats()` shows the
  delays and pending predictions.

## Coaching and clarity

- First-match hints (`engine/hints.ts`, `hud.hint`): "Hold F at a broken
  window to rebuild it", "Press V to knife", "Buy a weapon off the wall",
  "Open doors with points", "Find the power", "Perk machines need the
  power", each once per browser (`localStorage` `df-hints-v1`), one at a time
  with a gap, taken down as soon as the player does the thing. A downed
  teammate is always called out ("Hold F next to Bea to revive"). The
  arsenal adds "Salvage builds gear at a workbench", "Press F at the
  workbench to craft", "Hold Q to place your gear" and "Hold X to call in
  the …" (facts from `DfArsenalClient.facts`).
- Hit points: every own hit floats its points ("+10", kills "+60" / "+100" /
  "+130") up off the zombie where it was hit (`hud.hitPops`, positioned per
  frame through `--df-hp{i}-x/y/on`), besides the classic popups at the score.
- In-match chat: T or Enter opens a box over the chat feed (`DfInput.typing`
  keeps the keys out of the game), Enter sends `{ t: 'chat' }`.
- `hud.ammoHint` under the crosshair: "Press R to reload", "Low ammo", "No
  ammo".
- Prompts say why a buy fails ("Chapel Nave · Need 250 more points",
  "Requires power").
- Last zombies: when nothing is left to spawn and 3 or fewer remain,
  `hud.lastZombies` counts them, `DfZombieView.highlight(ids)` makes them easy
  to spot, and `hud.markers` (with downed teammates) are placed every frame
  through `--df-mk{i}-x/y/on/ang` like the objective waypoint. From round 2 the
  last two walkers break into a run so a round never stalls on a straggler.

## Salvage and the workbench

Rules in `shared/utils/dead-front/salvage.ts` (salvage, recipes, sentry,
decoy, challenges), `killstreaks.ts` (rewards, strike plans, the launcher) and
`rarity.ts` (tiers, the box curve, upgrade kits, bench upgrade costs); the
server state in `server/utils/dead-front/salvage.ts` (`DfArsenal`, driven by
hooks in `sim.ts`: kill, down, round start/end, step, the hunt's lure check,
a wall-buy or box use, the snapshot). Every grant is claim-then-reward: a drop leaves the list
before it pays, a craft or upgrade takes its salvage before it hands anything
over, a reward is popped before it fires, a kit leaves the ground (or the
box) before it applies.

- **Salvage is per player.** A kill drops scrap (some chance) and now and then
  a rare part for the killer only (kills by gear and support: their owner;
  traps: the nearest soldier). Brutes always drop a pile, bloaters usually.
  The chance is set per round so a solo horde drops about 6 scrap a round
  whatever its size (`dfSalvageChance`, more per extra player); a craft every
  two or three rounds. Only the owner sees their drops and can walk over them
  (the client takes it at once and plays the pickup; the server's `salvage`
  event settles it). Pools, drops and pickup events travel in the receiving
  player's private slice `DfSnapshot.mine` (appended per recipient by
  `match.ts`), folded into `world.arsenal` and `events` on arrival by
  `dfMergeArsenalMine`, so nothing leaks to teammates. A Maxim silencer on the
  killing weapon raises the drop chances by a quarter (`attachment.salvage`,
  `dfSalvageBonus`) instead of the old headshot bonus.
- **Workbenches** (`map-benches.ts`, collision in `map-world.ts`): one against
  the Square's north wall, one in the Ramparts bailey. The prompt shows the
  selected item: **tap F** for the next, **hold F** (0.6 s) to make it; the
  list (`DfHudBench`) shows every item, its cost and why it can't be made.
  The list, against about 6 scrap a round solo:
  - Lewis Sentry (6 scrap, Q to place within 4 m): 60 s, 240 rounds, guns
    down the nearest zombie it can see in 22 m, 40 points a kill to its
    owner, clawed apart by zombies standing on it; one per player.
  - Gramophone (5, Q to throw within 12 m): zombies within 22 m dance to it
    for 9 s (`DfArsenal.lure`, ahead of the hunt), then it blows (5.5 m).
  - Field Kit (10 + 1 part): a self-revive 3 s after going down.
  - Bomber Run (16 + 1 part) and Granatwerfer (12): support, held with the
    killstreak rewards (up to three) and used with X.
  - Upgrade the weapon in hand one rarity tier (6 / 12 + 1 part / 20 + 2
    parts). The request carries the tier it is at (`from`, an integer CAS)
    and the weapon id the client sees there; a weapon in the Pack-a-Punch,
    the wunderweapon and the lent launcher are refused, and the list says
    why.
- **Rarity** (Cold War style, `rarity.ts`): Common, Rare (green), Epic
  (purple), Legendary (orange), +0 / 25 / 55 / 100% damage through
  `dfWeaponStats(id, pap, attachments, rarity)` (so prediction agrees);
  `DfHeldWeapon.rarity`, kept through Pack-a-Punch (also when the machine
  hands it back itself) and swaps, any weapon but the wunderweapon and the
  lent launcher. Wall-buys are common. The box rolls a tier
  (`dfBoxRarityWeights`: mostly common through round 5, no commons and a
  quarter legendary by round 20), shown on offer (`DfBoxState.rarity`, a glint
  in its colour), in the prompt, the ammo plate and the squad feed.
- **Upgrade kits**: a box roll may offer a kit instead (`dfBoxKitChance` 4%
  rising to 12%, better tiers later; `DfBoxState.kit`). Taking it raises the
  held weapon to its tier, or, when that weapon is already as good, sets it
  down in front of you for 2 minutes (`world.arsenal.kits`, blinking for the
  last 15 s); anyone can take it onto a weapon below its tier (F, "Already
  Epic" otherwise).
- **Killstreak rewards**: kills without going down (traps, gear and support
  don't count) earn the Artillery Barrage (15: eight shells round the mark),
  the Granatwerfer (25), the Zeppelin Raid (35: a bomb run along your line of
  sight) and the Bomber Run (50), then the count starts over. Up to three
  held (crafted support shares the list); **hold X** (or 4) to mark where you
  look, release to call in the newest. The server plans every impact
  (`dfPlanStrike`), sends it in the `strike` event and resolves the damage at
  those times; support never hurts a player.
  - **Bomber Run**: a Gotha flies over the mark, rows of bombs walk across it,
    then everything within 11 m dies at once (`DfStrikeHit.all`: no cover,
    brutes too), 50 points a kill to the caller.
  - **Granatwerfer** (`DF_LAUNCHER`, weapon `granatwerfer`, `temporary` in
    `weapons.ts`, kept out of `DF_WEAPON_IDS`): X puts it in place of the
    weapon in hand for 45 s or 12 shells (4 in the drum): heavy `mortar`
    shells that burst 6.5 m wide on impact, no self-damage, no weapon XP. The
    weapon it stood in for comes back exactly as it was (the same object:
    slot, ammo, rarity, Pack-a-Punch, attachments) when time or shells run
    out, on going down (before last stand) or on using a wall-buy or the box.
    The Pack-a-Punch refuses it; it can't be upgraded or take a kit.
- **Round challenges**: from round 2 (not in the gas) each round deals one
  (headshot kills, knife kills, explosive kills, the brute, kills by gear and
  support); meeting it gives everyone 4 scrap, a part and 250 points. Shown
  under the objective tracker.
- Controls: F at a bench (tap / hold), Q (hold to aim, release to place), X or
  4 (hold to mark, release to call in; the Granatwerfer comes out on the
  press), F at a kit on the ground.
- Dev: `{ t: 'dev', op: { k: 'arsenal', what: 'salvage' | 'streak' | 'rewards', n } }`.

## Pack-a-Punch

Tiers cost `DF_COSTS.pap` (5,000, 15,000, 30,000; `dfPapCost`). A weapon in
the machine keeps its slot reserved (`DfHeldWeapon.away`), so slots never
shift. Taking it puts it back in that slot; if the offer runs out the machine
returns it there automatically with full ammo (`papReturn` event, HUD feed
line). The offer waits for an owner who bled out or dropped. New weapons go
before the wunderweapon, which always rides last.

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
| `door`, `plank`, `box`, `pap` (machine), `power`, `fuse`, `rod`, `soul`, `egg`, `perk` (machine jingle) | world view (map agent) |
| `explode`, `arc` | projectile view (weapons agent) |
| `craft` (bench), `salvage`, `deploy`, `sentry`, `decoy`, `kitDrop`, `strike` (the show: flare, whistles, Zeppelin, Gotha, the carpet) | world view parts `interact/workbench.ts`, `salvage.ts`, `sentry.ts`, `kits.ts`, `strikes.ts` |
| `reward`, `strike` and `challenge` callouts, `launcher`, `rarity`, `kitDrop` notices | engine (`engine/arsenal.ts`) |
| `shot` (remote tracer + sound), `points`, `round`, `roundEnd`, `down`, `revived`, `bleedout`, `respawn`, `powerup`, `buy`, `chat`, hitmarkers, damage feedback | engine (engine agent) |

The squad feed (top right of the HUD: downs, revives, doors, power) is built
by `DfGameView` from the snapshot events with `dfHudFeedLine` (`engine/hud.ts`;
the arsenal's lines, a weapon's rarity in its colour, come from
`dfArsenalFeedLine` in `engine/arsenal-prompt.ts`).
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
agent sets `wallCost`/`ammoCost` for exactly these). Box only: `c96`, `ppsh`,
`bar`, `lewis`, `xray` and the five box finds below (plus the wall weapons).
`m1911` is everyone's start weapon; `wunder` comes only from the easter egg.
None of the box weapons is `startable`. Odds per weapon are `dfBoxWeight`
(the X-Ray about one roll in seventeen, the flamethrower a little more often).

The box finds, each with its own job:

| Id | Weapon | Role |
| --- | --- | --- |
| `webley` | Webley Mk VI (pistol) | Hand cannon: six heavy .455 rounds, a slow cycle; the top-break action tips open, spills the brass and takes a speedloader. The cylinder turns a chamber per shot. |
| `sawnoff` | Coach Gun (shotgun) | The biggest single trigger pull in the game, two shells, the shortest reach; both barrels break open and reload together. Brenneke slugs trade the pattern for one huge penetrating ball. |
| `win1895` | Winchester 1895 (rifle) | Lever action: much faster follow-ups than the Kar98k for a little less punch; the lever is worked between shots. |
| `chauchat` | Chauchat (LMG) | Slow, hammering 8 mm in a 20-round half-moon; hits harder and goes through more than the Lewis, climbs and pulls right. |
| `flammen` | Wex Flammenwerfer (special) | Flamethrower (`DfWeaponDef.flame`): a hitscan fan of short rays (`pellets`) that each burn through several zombies (`penetration`) with steep falloff past 5 m. Drawn as a jet of fire (`fx` preset `flame`) and a lit pilot burner, no tracers, impacts or brass; a pressure-bottle reload. No attachments. |

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

## World presentation

- **Power**: the surge spreads out from the switch (`dfPowerDelay`, ~26 m/s):
  lamps, perk machines and the press stutter on as it reaches them.
- **Perk machines** (`world/interact/perks.ts`): each shows its perk's bottle
  (the same silhouettes as the HUD sprite, `world/perk-bottles.ts`) on a lit
  sign and on top; chasing marquee bulbs, steam, and a bottle that drops into
  the tray on purchase. Machines and the press add virtual fixtures to the
  pooled lights (`world/lights.ts`).
- **Mystery box** (`world/interact/box.ts`): a camera-facing column of light
  over every spot that widens with distance, motes, a light spill from the
  open crate. Box spots: one in the start zone plus one each in the farm,
  cemetery and ramparts. Moving: it rattles, lifts off glowing and bursts
  into bits; at the new spot the beam strikes down and the crate drops in.
- **Lightning rods** (`world/interact/rods.ts`, `map.egg.rods`): three masts
  with knife switches (one on the rampart walk). They glow and tick during the
  `rods` step, crackle with sky bolts when thrown, and when all three are live
  arcs leap to the generator and on to the pedestal.
- **Electric traps** (`world/interact/traps.ts`, `map.traps`): a slate switch
  panel with a knife switch and a status lamp (dark without power, green
  ready, red cooling down, flashing while live), coils on the wall faces
  either side of the passage joined by a wire overhead. Live, the wire glows,
  arcs leap between the coils, a pooled light stutters over the passage and
  each kill takes a bolt from the nearest coil. Sounds: `DF_SPECIAL_SND.trap*`.
- **Workbenches** (`world/interact/workbench.ts`): a trestle bench with a vice,
  tools and scrap, an oil lamp (a map light), and a slate board chalked with
  the five craftables; a brass lamp on the board burns green while your
  salvage pays for something. A craft swings the hammer three times, with
  sparks and a ring.
- **Salvage** (`world/salvage.ts`): rusty scrap heaps and brass rare parts
  with a blue tube; they pop out, bob, turn and blink before rusting away.
- **Gear** (`world/sentry.ts`): the Lewis sentry on its tripod swings onto its
  target, flashes, draws a tracer per shot and turns its pan; a lamp blinks
  red when it runs low, it smokes when clawed. The gramophone's record turns
  and its horn throbs to a looping waltz, faster and flashing red before it
  blows.
- **Upgrade kits** (`world/kits.ts`, also in the box): a tool chest banded in
  its rarity colour.
- **Support** (`world/strikes.ts`): a red smoke flare on the barrage's mark and
  a falling whistle ahead of each shell; a grey Zeppelin droning over, bombs
  falling from the gondola; a Gotha bomber with two pusher engines droning
  over low, its bombs whistling down in rows and the whole circle going up in
  one carpet (explosions, scorches, smoke, a heavy shake). Blasts are the
  projectile view's `explode` events; the Granatwerfer's `mortar` shells are
  drawn by the projectile view, its model is in `weapons/models.ts`. Sounds: `DF_ARSENAL_SND` (`engine/arsenal-sounds.ts`), mixed by
  category in `engine/audio.ts`.
- **Atmosphere** (`world/atmosphere.ts`): ground mist masked to open ground
  (roofed cells from the voxel grid stay clear), drifting ash and embers
  around the camera. A new round bleeds the sky red for a few seconds; shell
  flashes on the horizon warm the scene.
- **Zombies**: outfits per type (`dfZombieOutfitCount`): kepi, Adrian, Brodie
  and Stahlhelm infantry and a villager for shamblers, a bandaged ghoul, a
  gas-hooded bloater, plus a per-zombie tint. Corpses slide along the shot and
  topple that way; explosive gibs throw whole limbs that tumble and bleed.
