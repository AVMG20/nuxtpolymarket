# Pathwarden visual QA

Use these checks for every terrain, road, building, weapon, enemy, and ambient-animation change.

## Required capture states

Capture the canvas at 1600×1050 in:

1. Fresh planning state, across at least four randomized road layouts.
2. A tower-placement state with one tower on each side of the keep.
3. Two combat frames at least 750 ms apart.
4. Frontier selection after an expansion.
5. Idle state with patrol, worker, or peddler actors visible.
6. Expanded-map state after panning to each available camera bound.
7. Wave state with one living enemy from every active mist exit.
8. A complete ten-wave run with ordinary pointer input for building, frontier
   choices, relics, and wave calls. Capture planning and combat milestones at
   waves 1, 3/4, 5, 7, and 10.

Inspect the full canvas at original resolution rather than relying on thumbnails.

## Geometry invariants

- Run with visual guides enabled before every clean capture. The cyan tile anchor,
  amber ground contact, violet weapon pivot, and red muzzle marker must agree with
  the rendered geometry at original resolution.
- The complete room plan is immutable after initialization. Revealing a room may
  change selection state only; room footprints, road links, terrain features,
  and connection geometry must retain the same plan hash.
- The main twelve-room route must expose compact, readable room transitions and
  include both T-junction and crossroads grammar. Large empty connector spans
  or repeated straight-only expansion sequences fail visual inspection.
- The diagnostic state must report `roadValidation.valid: true`; visual inspection
  cannot override a failed graph invariant.
- A road is one continuous graph. Internal nodes and junctions cannot show end caps, doubled borders, translucent overlaps, pinches, or exposed grass wedges.
- Planned roads must move outward on every cell, have a planned parent, never
  overlap, and never run immediately beside an unrelated road. Reject hairpins,
  U-turns, isolated stubs, and any plan with fewer than seven sections.
- Every planned exit endpoint owns a one-tile construction-clearance ring.
  Building, dragging, and procedural scenery must all reject those cells, so an
  exit cannot be boxed in before its road is revealed.
- Rounded road caps appear only where a road enters the void. The fade begins after the final revealed road point and ends inside mist.
- Every persistent unchosen exit continues to a mist boundary after later terrain reveals.
- Roads cannot enter a tower tile, decoration tile, or the keep's visual clearance zone.
- Revealed terrain has one continuous top surface. Hidden-neighbour elevation must never create a slope, wedge, or floating face.
- Terrain decorations have no embedded square terrain pedestal and cannot overlap any reserved road.

## Object anchoring and occlusion

- A building's ground contact point is the center of its tile.
- A tall sprite may only own pointer input across the lower 58% of its rendered
  height. Decorative overhang must never steal a click from an apparently empty
  neighboring tile.
- Roof weapons remain attached to their mount through a complete rotation and recoil cycle.
- Weapon direction, projectile origin, and target direction agree in the isometric screen plane.
- Mortar shots begin at the red muzzle marker, rise above their straight
  origin-to-target line, reach a visible apex, and land at the target. A raised
  barrel paired with a flat or downward-only projectile path fails inspection.
- Painter order is determined by ground contact: north-west objects pass behind the keep and south-east objects pass in front.
- The keep road meets the center of the gate and no other road enters the keep silhouette.
- The keep uses screen-space construction clearance matching its visible
  silhouette. It must prevent overlap without
  needlessly consuming a square block of otherwise visible terrain.
- Placement rules must be inferable from the board: revealed empty grass is
  buildable; roads, scenery, the castle silhouette, occupied cells, and visible
  cyan frontier approaches are not. Invisible future plans never block a click.
- Actors remain on visible roads or terrain and fade at the gate or mist; they never stand outside the playable silhouette.
- Every active mist exit receives enemies during a wave, and every enemy route terminates at the castle gate.
- Edge scrolling must preserve enough revealed terrain in frame to orient the player; the map cannot be panned entirely into empty void.
- Tile hover, placement, dragging, projectiles, and debug coordinates must remain aligned after horizontal and vertical camera movement.
- An expansion marker must activate on the first click at its rendered position, including after camera movement. Path mode shows only the pulsing marker; it must not also draw the normal terrain-hover diamond.
- Mandatory frontier choices are brought into the viewport automatically after
  a wave, so progression never depends on guessing that the map must be panned.
- Selection details live outside the canvas and cannot cover or intercept board
  input.
- Construction crews use navigated routes that prefer roads, avoid towers and scenery, and stop on an open tile adjacent to their target.
- Ambient actors participate in ground-depth painter ordering and cannot appear painted over a building that is spatially in front of them.

## Rejection rule

Reject the visual pass if any artifact is noticeable at normal canvas size, even when gameplay remains functional. Procedural features pass only after several randomized layouts have been inspected.

## Gameplay sanity invariants

- A ten-wave run must remain finishable without bridge-only shortcuts.
- Building costs shown in the arsenal must match the amount deducted. Repeated
  copies become progressively more expensive, fusion preserves both buildings'
  investment, and dismantling refunds exactly half of that investment.
- A player who buys one or two useful defenses per round should retain choices
  without ending with thousands of irrelevant Aether.
- Wave announcements may orient the player but cannot cover the battlefield or
  hide the first attack exchange.
- Permanent terminal roads remain permanent spawn mouths after the seven planned
  expansions are exhausted. Wave intelligence, rendered fog mouths, and
  observed enemy `exitKey` values must describe the same set.
- Fixed-position checkpoint and flawless callouts use screen coordinates; camera
  panning must never clip or drag them across buildings.
- Repeated construction inflation is lifetime-per-run. Fusion, movement, and
  dismantling cannot reset the next-copy price.
- Relics have bounded ranks and exhausted or currently useless relics are not
  offered.
