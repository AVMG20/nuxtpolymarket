// Call of Xeno — static scene construction.
//
// Turns the pure map description into three.js objects: the shell and its
// boarded windows, the dirt outside, floors and ceilings for both storeys, the
// stairs, lighting, doors and every interactable prop. Kept out of the
// component so the game loop file stays about gameplay.
//
// The look is deliberately drab — concrete, plaster and painted steel lit by
// tungsten. The only saturated colour in the level belongs to props the player
// has to be able to spot: perks, the Pack-a-Punch, the box and power-ups.

import * as THREE from 'three'
import {
    CALL_OF_XENO_REGIONS,
    CALL_OF_XENO_WALLS,
    CALL_OF_XENO_SHELL_WALLS,
    CALL_OF_XENO_CRATES,
    CALL_OF_XENO_PLATFORMS,
    CALL_OF_XENO_RAMPS,
    CALL_OF_XENO_DOORS,
    CALL_OF_XENO_INTERACTABLES,
    CALL_OF_XENO_DECOR,
    CALL_OF_XENO_ROOM_THEMES,
    CALL_OF_XENO_WINDOWS,
    CALL_OF_XENO_WINDOW_BOARDS,
    CALL_OF_XENO_WINDOW_SILL,
    CALL_OF_XENO_WINDOW_HEAD,
    CALL_OF_XENO_WINDOW_WIDTH,
    CALL_OF_XENO_EXTERIOR,
    CALL_OF_XENO_SHELL,
    CALL_OF_XENO_ATRIUM_HEIGHT,
    CALL_OF_XENO_WALL_HEIGHT,
    CALL_OF_XENO_UPPER_Y,
    type CallOfXenoBox,
    type CallOfXenoInteractable
} from '#shared/utils/gamelogic/call-of-xeno-map'
import {
    CALL_OF_XENO_WEAPONS,
    CALL_OF_XENO_PERKS,
    CALL_OF_XENO_BOX_COST
} from '#shared/utils/gamelogic/call-of-xeno'
import {
    makeFloorTexture,
    makeWallTexture,
    makeCeilingTexture,
    makeHazardTexture,
    makeMetalTexture,
    makePlankTexture,
    makeDirtTexture
} from './textures'
import {
    buildCrate,
    buildBarrier,
    buildBarrel,
    buildPillar,
    buildMachine,
    buildContainer,
    buildTruck,
    buildPipesRun,
    buildCeilingLight,
    buildDoorFrame,
    buildRailing,
    buildWindow,
    buildStairs,
    buildWallBuy,
    buildPerkMachine,
    buildPackAPunch,
    buildPowerLever,
    buildMysteryBox,
    type PropModel,
    type PowerLeverModel,
    type MysteryBoxModel,
    type WindowModel
} from './models'

export interface RoomLight {
    light: THREE.PointLight
    tube: THREE.Mesh
    region: number
    /** Intensity when the power is on. */
    lit: number
}

export interface LevelHandles {
    lights: RoomLight[]
    doors: Map<string, THREE.Group>
    props: Map<string, PropModel>
    /** One entry per window, keyed by window id. */
    windows: Map<string, WindowModel>
    powerLever: PowerLeverModel
    mysteryBox: MysteryBoxModel
    textures: THREE.Texture[]
    /** Rebuilds a door that a previous run had bought open. */
    makeDoor(id: string): THREE.Group
}

function boxMesh(box: CallOfXenoBox, height: number, y: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(box.maxX - box.minX, height, box.maxZ - box.minZ),
        material
    )
    mesh.position.set((box.minX + box.maxX) / 2, y, (box.minZ + box.maxZ) / 2)
    return mesh
}

/** Region a solid belongs to, by where its centre sits and how high it starts. */
function regionOf(box: CallOfXenoBox, baseY = 0) {
    const cx = (box.minX + box.maxX) / 2
    const cz = (box.minZ + box.maxZ) / 2
    let best = CALL_OF_XENO_REGIONS[0]!
    let bestFloor = -Infinity
    for (const region of CALL_OF_XENO_REGIONS) {
        const b = region.bounds
        if (cx < b.minX - 0.6 || cx > b.maxX + 0.6 || cz < b.minZ - 0.6 || cz > b.maxZ + 0.6) continue
        if (region.floorY > baseY + 0.5) continue
        if (region.floorY <= bestFloor) continue
        bestFloor = region.floorY
        best = region
    }
    return best
}

export function buildLevel(scene: THREE.Scene): LevelHandles {
    const textures: THREE.Texture[] = []
    const track = <T extends THREE.Texture>(texture: T) => {
        textures.push(texture)
        return texture
    }

    const wallMats = CALL_OF_XENO_ROOM_THEMES.map(theme =>
        new THREE.MeshLambertMaterial({ map: track(makeWallTexture(theme.wall[0], theme.wall[1], theme.wall[2])) })
    )
    const floorMats = CALL_OF_XENO_ROOM_THEMES.map(theme =>
        new THREE.MeshLambertMaterial({ map: track(makeFloorTexture(theme.floor[0], theme.floor[1], theme.floor[2])) })
    )
    const ceilMats = CALL_OF_XENO_ROOM_THEMES.map(theme =>
        new THREE.MeshLambertMaterial({ map: track(makeCeilingTexture(theme.ceiling[0], theme.ceiling[1])) })
    )
    const metalTex = track(makeMetalTexture())
    const metalMat = new THREE.MeshLambertMaterial({ map: metalTex })
    const plankTex = track(makePlankTexture())
    const hazardTex = track(makeHazardTexture())

    // ---------------------------------------------------------------------
    // Outside
    // ---------------------------------------------------------------------

    // A dirt apron under the whole map so the enemies queueing at the windows
    // have ground to stand on, plus a low ridge on the horizon so the world
    // does not end in a flat plane against the fog.
    const dirtMat = new THREE.MeshLambertMaterial({ map: track(makeDirtTexture()) })
    scene.add(boxMesh(CALL_OF_XENO_EXTERIOR, 0.5, -0.33, dirtMat))

    const rubbleMat = new THREE.MeshLambertMaterial({ color: 0x33302a })
    for (let i = 0; i < 90; i++) {
        // Deterministic scatter — the same debris field every run.
        const angle = (i / 90) * Math.PI * 2 + (i % 7) * 0.31
        const radius = 34 + (i % 11) * 3.4
        let x = 29 + Math.cos(angle) * radius
        let z = 24 + Math.sin(angle) * radius * 0.86
        // The ring is elliptical and the building rectangular, so a fair few
        // angles would drop a rock inside the shell — a walk-through box in
        // the middle of a room. Anything aimed at the footprint gets pushed
        // out to the apron ring around it.
        const dx = x - 29
        const dz = z - 24
        const push = Math.max(
            31.5 / Math.max(0.001, Math.abs(dx)),
            25.5 / Math.max(0.001, Math.abs(dz))
        )
        if (push > 1) {
            x = 29 + dx * push
            z = 24 + dz * push
        }
        const size = 0.6 + (i % 5) * 0.5
        const rock = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.5, size * 0.8), rubbleMat)
        rock.position.set(x, size * 0.2, z)
        rock.rotation.y = i * 0.7
        scene.add(rock)
    }

    // ---------------------------------------------------------------------
    // Floors and ceilings, one slab per region at that region's storey.
    // ---------------------------------------------------------------------

    for (const region of CALL_OF_XENO_REGIONS) {
        // The Catwalk slab stops a hair short of z = 22: the top stair tread
        // lands exactly on the deck's walking plane, and two coplanar top
        // faces flicker against each other at the head of every flight.
        const bounds = region.id === 9
            ? { ...region.bounds, maxZ: region.bounds.maxZ - 0.04 }
            : region.bounds
        scene.add(boxMesh(bounds, 0.2, region.floorY - 0.1, floorMats[region.theme]!))
        if (region.capped) {
            scene.add(boxMesh(region.bounds, 0.2, region.ceiling + 0.1, ceilMats[region.theme]!))
        }
    }

    // The second-floor deck. Its underside is what the Barracks and the Mess
    // see as their ceiling, so it is skinned in the ceiling material. It is
    // drawn a shade short of the walking surface: the region floors above it
    // end exactly at that plane, and two coincident top faces would z-fight
    // across the whole storey.
    for (const platform of CALL_OF_XENO_PLATFORMS) {
        const visual = platform.thickness - 0.05
        scene.add(boxMesh(platform.box, visual, platform.y - 0.05 - visual / 2, ceilMats[1]!))
    }

    // ---------------------------------------------------------------------
    // Structures and walls
    // ---------------------------------------------------------------------

    const decorBoxes = new Set(CALL_OF_XENO_DECOR.map(d => d.box))
    for (const decor of CALL_OF_XENO_DECOR) {
        const cx = (decor.box.minX + decor.box.maxX) / 2
        const cz = (decor.box.minZ + decor.box.maxZ) / 2
        const width = decor.box.maxX - decor.box.minX
        const depth = decor.box.maxZ - decor.box.minZ
        const accent = CALL_OF_XENO_ROOM_THEMES[decor.theme]!.accent

        let group: THREE.Group
        if (decor.kind === 'machine') group = buildMachine(width, decor.height, depth, accent)
        else if (decor.kind === 'container') group = buildContainer(width, decor.height, depth, 0x4d5148)
        else if (decor.kind === 'truck') group = buildTruck(width, decor.height, depth, 0x565b51)
        else group = buildPillar(decor.height, accent)

        group.position.set(cx, 0, cz)
        scene.add(group)
    }

    const shellBoxes = new Set(CALL_OF_XENO_SHELL_WALLS.map(w => w.box))
    // The outer shell is one material everywhere — it is the same building
    // from the inside of every room.
    const shellMat = wallMats[1]!
    for (const wall of CALL_OF_XENO_WALLS) {
        if (decorBoxes.has(wall.box)) continue
        const material = shellBoxes.has(wall.box) ? shellMat : wallMats[regionOf(wall.box, wall.baseY).theme]!
        scene.add(boxMesh(wall.box, wall.height, wall.baseY + wall.height / 2, material))
    }

    // ---------------------------------------------------------------------
    // Windows
    // ---------------------------------------------------------------------

    const windows = new Map<string, WindowModel>()
    for (const window of CALL_OF_XENO_WINDOWS) {
        const model = buildWindow(
            CALL_OF_XENO_WINDOW_WIDTH,
            CALL_OF_XENO_WINDOW_SILL,
            CALL_OF_XENO_WINDOW_HEAD,
            CALL_OF_XENO_WINDOW_BOARDS,
            plankTex
        )
        model.group.position.set(window.centre.x, 0, window.centre.z)
        model.group.rotation.y = window.facing
        scene.add(model.group)
        windows.set(window.id, model)
    }

    // ---------------------------------------------------------------------
    // Cover
    // ---------------------------------------------------------------------

    CALL_OF_XENO_CRATES.forEach((crate, index) => {
        const region = regionOf(crate.box, crate.baseY)
        const theme = CALL_OF_XENO_ROOM_THEMES[region.theme]!
        const width = crate.box.maxX - crate.box.minX
        const depth = crate.box.maxZ - crate.box.minZ
        const cx = (crate.box.minX + crate.box.maxX) / 2
        const cz = (crate.box.minZ + crate.box.maxZ) / 2

        const group = crate.height <= 1.15
            ? buildBarrier(width, crate.height, depth, theme.accent, hazardTex)
            : buildCrate(width, crate.height, depth, theme.accent)
        group.position.set(cx, crate.baseY, cz)
        scene.add(group)

        if (index % 3 === 1) {
            const barrel = buildBarrel(0x4a4b42)
            barrel.position.set(cx + width / 2 - 0.34, crate.baseY, cz - depth / 2 + 0.34)
            barrel.rotation.y = index * 1.7
            scene.add(barrel)
        }
    })

    // Faded lane paint at the openings between rooms. Worn floor stencilling,
    // not lit strips — it should read as something that was painted on once.
    const paintMat = new THREE.MeshLambertMaterial({ color: 0x7a6a3c, transparent: true, opacity: 0.28 })
    const mkPaint = (minX: number, maxX: number, minZ: number, maxZ: number, y = 0) => {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, 0.02, maxZ - minZ), paintMat)
        strip.position.set((minX + maxX) / 2, y + 0.01, (minZ + maxZ) / 2)
        scene.add(strip)
    }
    for (const door of CALL_OF_XENO_DOORS) {
        const spansX = (door.box.maxX - door.box.minX) > (door.box.maxZ - door.box.minZ)
        if (spansX) mkPaint(door.box.minX, door.box.maxX, door.prompt.z - 1.6, door.prompt.z + 1.6)
        else mkPaint(door.prompt.x - 1.6, door.prompt.x + 1.6, door.box.minZ, door.box.maxZ)
    }
    mkPaint(45, 49, 16.4, 19.6)
    mkPaint(45, 49, 32.4, 35.6)
    mkPaint(16.4, 19.6, 40, 44)

    // Pipe runs along the tall rooms, in the same dull steel as everything else.
    const atriumPipes = buildPipesRun(16, CALL_OF_XENO_ROOM_THEMES[1]!.accent)
    atriumPipes.rotation.y = Math.PI / 2
    atriumPipes.position.set(0.35, 6.4, 26)
    scene.add(atriumPipes)

    const garagePipes = buildPipesRun(20, CALL_OF_XENO_ROOM_THEMES[1]!.accent)
    garagePipes.position.set(47, 6.6, 17.6)
    scene.add(garagePipes)

    const reactorPipes = buildPipesRun(18, CALL_OF_XENO_ROOM_THEMES[2]!.accent)
    reactorPipes.position.set(38, 6.6, 47.6)
    scene.add(reactorPipes)

    const workshopPipes = buildPipesRun(12, CALL_OF_XENO_ROOM_THEMES[2]!.accent)
    workshopPipes.rotation.y = Math.PI / 2
    workshopPipes.position.set(57.6, 3.1, 26)
    scene.add(workshopPipes)

    // Roof trusses over the two tall halls.
    const trussMat = new THREE.MeshLambertMaterial({ color: 0x35362f })
    for (const [minX, maxX, minZ, maxZ, count] of [[0, 36, 22, 34, 4], [36, 58, 0, 18, 5], [18, 58, 34, 48, 6]] as const) {
        for (let i = 0; i < count; i++) {
            const t = (i + 0.5) / count
            const beam = new THREE.Mesh(
                new THREE.BoxGeometry(maxX - minX, 0.3, 0.34),
                trussMat
            )
            beam.position.set((minX + maxX) / 2, CALL_OF_XENO_ATRIUM_HEIGHT - 0.35, minZ + (maxZ - minZ) * t)
            scene.add(beam)
        }
    }

    // ---------------------------------------------------------------------
    // Second floor: deck edge, rails and the two stairs out of the Atrium
    // ---------------------------------------------------------------------

    const railColor = CALL_OF_XENO_ROOM_THEMES[1]!.accent
    for (const [from, to] of [[5.5, 29.5], [34.5, 36]] as const) {
        const rail = buildRailing(to - from, railColor)
        rail.position.set((from + to) / 2, CALL_OF_XENO_UPPER_Y, 22)
        scene.add(rail)
        // Edge beam under the deck, so the catwalk has a visible thickness.
        // Sits clear of both the deck surface and the slab so no face of it
        // lands in the same plane as the floor above.
        const edge = new THREE.Mesh(new THREE.BoxGeometry(to - from, 0.4, 0.34), trussMat)
        edge.position.set((from + to) / 2, CALL_OF_XENO_UPPER_Y - 0.5, 22.1)
        scene.add(edge)
    }

    for (const ramp of CALL_OF_XENO_RAMPS) {
        const run = Math.abs(ramp.highAt - ramp.lowAt)
        const rise = ramp.highY - ramp.lowY
        const width = ramp.axis === 'x'
            ? ramp.box.maxZ - ramp.box.minZ
            : ramp.box.maxX - ramp.box.minX

        const stairs = buildStairs(width, run, rise, ramp.steps, metalTex)
        // The builder climbs along +Z, so a flight that climbs toward smaller
        // coordinates is turned to face the other way.
        const climbsPositive = ramp.highAt > ramp.lowAt
        stairs.rotation.y = ramp.axis === 'x'
            ? (climbsPositive ? -Math.PI / 2 : Math.PI / 2)
            : (climbsPositive ? 0 : Math.PI)
        stairs.position.set(
            ramp.axis === 'x' ? ramp.lowAt : (ramp.box.minX + ramp.box.maxX) / 2,
            ramp.lowY,
            ramp.axis === 'x' ? (ramp.box.minZ + ramp.box.maxZ) / 2 : ramp.lowAt
        )
        scene.add(stairs)

        // Rails up both sides of the flight. The rail is built along its own
        // X, so the pitch has to be applied inside a group that has already
        // been turned to face along the flight — doing both on one object
        // would compose the Euler angles in the wrong order.
        for (const sx of [-1, 1]) {
            const rail = buildRailing(Math.hypot(run, rise), railColor)
            rail.rotation.z = climbsPositive ? -Math.atan2(rise, run) : Math.atan2(rise, run)
            const pivot = new THREE.Group()
            pivot.add(rail)
            pivot.rotation.y = ramp.axis === 'x' ? 0 : Math.PI / 2
            pivot.position.set(
                (ramp.box.minX + ramp.box.maxX) / 2 + (ramp.axis === 'z' ? sx * (width / 2 - 0.1) : 0),
                (ramp.lowY + ramp.highY) / 2,
                (ramp.box.minZ + ramp.box.maxZ) / 2 + (ramp.axis === 'x' ? sx * (width / 2 - 0.1) : 0)
            )
            scene.add(pivot)
        }
    }

    // ---------------------------------------------------------------------
    // Lighting
    // ---------------------------------------------------------------------

    const lights: RoomLight[] = []
    for (const region of CALL_OF_XENO_REGIONS) {
        const theme = CALL_OF_XENO_ROOM_THEMES[region.theme]!
        const width = region.bounds.maxX - region.bounds.minX
        const depth = region.bounds.maxZ - region.bounds.minZ
        const along = width >= depth ? 'x' : 'z'
        const span = along === 'x' ? width : depth
        // Spaced wide on purpose: a shorter gap looks even but costs a point
        // light per fixture, and every one of them is in every material's loop.
        const count = Math.max(1, Math.round(span / 12))
        const tall = region.ceiling - region.floorY >= CALL_OF_XENO_ATRIUM_HEIGHT - 0.1
        const lit = tall ? 58 : 44
        // A hanging fixture sits below the ceiling of the tall halls so the
        // pool of light lands on the floor rather than on the trusses.
        const at = tall ? region.floorY + CALL_OF_XENO_WALL_HEIGHT + 1.2 : region.ceiling

        for (let i = 0; i < count; i++) {
            const t = (i + 0.5) / count
            const x = along === 'x' ? region.bounds.minX + span * t : (region.bounds.minX + region.bounds.maxX) / 2
            const z = along === 'x' ? (region.bounds.minZ + region.bounds.maxZ) / 2 : region.bounds.minZ + span * t
            const fixture = buildCeilingLight(theme.lightColor, at)
            fixture.position.set(x, 0, z)
            if (along === 'z') fixture.rotation.y = Math.PI / 2
            scene.add(fixture)

            const light = new THREE.PointLight(theme.lightColor, lit, tall ? 36 : 28, 1.5)
            light.position.set(x, at - 0.4, z)
            scene.add(light)
            lights.push({ light, tube: fixture.children[1] as THREE.Mesh, region: region.id, lit })
        }
    }
    scene.add(new THREE.AmbientLight(0x3a3e42, 1.8))
    scene.add(new THREE.HemisphereLight(0x6d7176, 0x1d1e20, 0.95))
    // Overcast moonlight. One directional costs far less than lighting the
    // apron with a lamp per window, and it is what picks a body queueing at a
    // barricade out of the dark before it starts on the boards.
    const moon = new THREE.DirectionalLight(0x9aa4b6, 1.1)
    moon.position.set(-40, 60, -30)
    scene.add(moon)

    // ---------------------------------------------------------------------
    // Doors
    // ---------------------------------------------------------------------

    const doors = new Map<string, THREE.Group>()
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x4a4034 })

    const makeDoor = (id: string) => {
        const door = CALL_OF_XENO_DOORS.find(d => d.id === id)!
        const group = new THREE.Group()
        const width = door.box.maxX - door.box.minX
        const depth = door.box.maxZ - door.box.minZ
        const height = CALL_OF_XENO_WALL_HEIGHT
        // A shutter that fills the whole opening, thickened so it does not
        // z-fight the thin door footprint the collision uses.
        const leaf = new THREE.Mesh(
            new THREE.BoxGeometry(Math.max(width, 0.4), height, Math.max(depth, 0.4)),
            doorMat
        )
        leaf.position.set(
            (door.box.minX + door.box.maxX) / 2,
            height / 2,
            (door.box.minZ + door.box.maxZ) / 2
        )
        group.add(leaf)

        // Planks nailed across it, the same timber as the window boards.
        const spanX = width > depth
        const plankMat = new THREE.MeshLambertMaterial({ map: plankTex })
        for (let i = 0; i < 4; i++) {
            const bar = new THREE.Mesh(
                new THREE.BoxGeometry(spanX ? width * 1.02 : 0.5, 0.22, spanX ? 0.5 : depth * 1.02),
                plankMat
            )
            bar.position.set(
                (door.box.minX + door.box.maxX) / 2,
                0.7 + i * 0.92,
                (door.box.minZ + door.box.maxZ) / 2
            )
            bar.rotation.y = 0
            bar.rotation[spanX ? 'z' : 'x'] = (i % 2 ? 1 : -1) * 0.03
            group.add(bar)
        }
        doors.set(id, group)
        return group
    }

    for (const door of CALL_OF_XENO_DOORS) {
        const region = regionOf(door.box)
        const theme = CALL_OF_XENO_ROOM_THEMES[region.theme]!
        const spansX = (door.box.maxX - door.box.minX) > (door.box.maxZ - door.box.minZ)
        const opening = spansX ? door.box.maxX - door.box.minX : door.box.maxZ - door.box.minZ

        for (const offset of [-0.45, 0.45]) {
            const frame = buildDoorFrame(opening + 0.6, CALL_OF_XENO_WALL_HEIGHT, theme.accent)
            if (spansX) {
                frame.position.set(door.prompt.x, 0, door.prompt.z + offset)
            } else {
                frame.rotation.y = Math.PI / 2
                frame.position.set(door.prompt.x + offset, 0, door.prompt.z)
            }
            scene.add(frame)
        }
        scene.add(makeDoor(door.id))
    }

    // ---------------------------------------------------------------------
    // Interactable props
    // ---------------------------------------------------------------------

    const props = new Map<string, PropModel>()
    let powerLever!: PowerLeverModel
    let mysteryBox!: MysteryBoxModel

    const buildProp = (item: CallOfXenoInteractable): PropModel => {
        if (item.kind === 'wallbuy') return buildWallBuy(CALL_OF_XENO_WEAPONS[item.weapon!])
        if (item.kind === 'perk') return buildPerkMachine(CALL_OF_XENO_PERKS[item.perk!])
        if (item.kind === 'papunch') return buildPackAPunch()
        if (item.kind === 'mysterybox') {
            mysteryBox = buildMysteryBox(CALL_OF_XENO_BOX_COST)
            return mysteryBox
        }
        powerLever = buildPowerLever()
        return powerLever
    }

    for (const item of CALL_OF_XENO_INTERACTABLES) {
        const prop = buildProp(item)
        prop.group.position.set(item.x, item.y + (item.kind === 'wallbuy' ? 1.45 : 0), item.z)
        prop.group.rotation.y = item.facing
        props.set(item.id, prop)
        scene.add(prop.group)
    }

    // The Pack-a-Punch sits on a poured plinth rather than inside a reactor,
    // so the walkable floor round it matches what the collision actually is.
    const pap = CALL_OF_XENO_INTERACTABLES.find(i => i.kind === 'papunch')
    if (pap) {
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(4, 0.24, 2.6), metalMat)
        plinth.position.set(pap.x, 0.12, pap.z)
        scene.add(plinth)
    }

    // Keep the shell honest: nothing should be visible past it.
    const roof = boxMesh(CALL_OF_XENO_SHELL, 0.4, CALL_OF_XENO_ATRIUM_HEIGHT + 0.5, ceilMats[1]!)
    scene.add(roof)

    return { lights, doors, props, windows, powerLever, mysteryBox, textures, makeDoor }
}
