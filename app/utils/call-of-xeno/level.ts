// Call of Xeno — static scene construction.
//
// Turns the pure map description into three.js objects: floors, ceilings,
// walls, the catwalk and its ramps, lighting, doors and every interactable
// prop. Kept out of the component so the game loop file stays about gameplay.

import * as THREE from 'three'
import {
    CALL_OF_XENO_REGIONS,
    CALL_OF_XENO_WALLS,
    CALL_OF_XENO_CRATES,
    CALL_OF_XENO_PLATFORMS,
    CALL_OF_XENO_RAMPS,
    CALL_OF_XENO_DOORS,
    CALL_OF_XENO_INTERACTABLES,
    CALL_OF_XENO_ROOM_THEMES,
    CALL_OF_XENO_ATRIUM_HEIGHT,
    CALL_OF_XENO_CATWALK_Y,
    type CallOfXenoBox,
    type CallOfXenoInteractable
} from '#shared/utils/gamelogic/call-of-xeno-map'
import {
    CALL_OF_XENO_WEAPONS,
    CALL_OF_XENO_PERKS,
    CALL_OF_XENO_BOX_COST
} from '#shared/utils/gamelogic/call-of-xeno'
import { makeFloorTexture, makeWallTexture, makeCeilingTexture } from './textures'
import {
    buildCrate,
    buildCeilingLight,
    buildDoorFrame,
    buildRailing,
    buildWallBuy,
    buildPerkMachine,
    buildPackAPunch,
    buildPowerLever,
    buildMysteryBox,
    type PropModel,
    type PowerLeverModel,
    type MysteryBoxModel
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

/** Region a box belongs to, by where its centre sits. */
function regionOf(box: CallOfXenoBox) {
    const cx = (box.minX + box.maxX) / 2
    const cz = (box.minZ + box.maxZ) / 2
    for (const region of CALL_OF_XENO_REGIONS) {
        const b = region.bounds
        if (cx >= b.minX - 0.6 && cx <= b.maxX + 0.6 && cz >= b.minZ - 0.6 && cz <= b.maxZ + 0.6) return region
    }
    return CALL_OF_XENO_REGIONS[0]!
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

    // Floors and ceilings, one slab per region at that region's height.
    for (const region of CALL_OF_XENO_REGIONS) {
        scene.add(boxMesh(region.bounds, 0.2, -0.1, floorMats[region.theme]!))
        scene.add(boxMesh(region.bounds, 0.2, region.ceiling + 0.1, ceilMats[region.theme]!))
    }

    for (const wall of CALL_OF_XENO_WALLS) {
        const region = regionOf(wall.box)
        scene.add(boxMesh(wall.box, wall.height, wall.baseY + wall.height / 2, wallMats[region.theme]!))
    }

    for (const crate of CALL_OF_XENO_CRATES) {
        const region = regionOf(crate.box)
        const theme = CALL_OF_XENO_ROOM_THEMES[region.theme]!
        const group = buildCrate(
            crate.box.maxX - crate.box.minX,
            crate.height,
            crate.box.maxZ - crate.box.minZ,
            theme.accent
        )
        group.position.set(
            (crate.box.minX + crate.box.maxX) / 2,
            crate.baseY,
            (crate.box.minZ + crate.box.maxZ) / 2
        )
        scene.add(group)
    }

    // The catwalk deck, its underside trusses and a rail along each open edge.
    const deckMat = new THREE.MeshLambertMaterial({ color: 0x3d434e })
    const trussMat = new THREE.MeshLambertMaterial({ color: 0x272b33 })
    const railColor = CALL_OF_XENO_ROOM_THEMES[1]!.accent

    for (const platform of CALL_OF_XENO_PLATFORMS) {
        scene.add(boxMesh(platform.box, platform.thickness, platform.y - platform.thickness / 2, deckMat))

        const width = platform.box.maxX - platform.box.minX
        const depth = platform.box.maxZ - platform.box.minZ
        const along = width > depth ? 'x' : 'z'
        const length = along === 'x' ? width : depth

        // Support struts down to the floor every few metres.
        for (let i = 0.5; i < length; i += 4) {
            const x = along === 'x' ? platform.box.minX + i : (platform.box.minX + platform.box.maxX) / 2
            const z = along === 'x' ? (platform.box.minZ + platform.box.maxZ) / 2 : platform.box.minZ + i
            const strut = new THREE.Mesh(
                new THREE.BoxGeometry(0.16, platform.y, 0.16),
                trussMat
            )
            strut.position.set(x, platform.y / 2, z)
            scene.add(strut)
        }

        // Rail on the edge that faces the open middle of the hall.
        const rail = buildRailing(length, railColor)
        if (along === 'x') {
            rail.position.set((platform.box.minX + platform.box.maxX) / 2, platform.y, platform.box.maxZ - 0.1)
        } else {
            rail.rotation.y = Math.PI / 2
            const innerX = platform.box.minX < 30 ? platform.box.maxX - 0.1 : platform.box.minX + 0.1
            rail.position.set(innerX, platform.y, (platform.box.minZ + platform.box.maxZ) / 2)
        }
        scene.add(rail)
    }

    // Ramps: a slab rotated to the slope, with a hazard nose at the bottom.
    for (const ramp of CALL_OF_XENO_RAMPS) {
        const run = Math.abs(ramp.highAt - ramp.lowAt)
        const rise = ramp.highY - ramp.lowY
        const length = Math.hypot(run, rise)
        const angle = Math.atan2(rise, run)
        const width = ramp.axis === 'x'
            ? ramp.box.maxZ - ramp.box.minZ
            : ramp.box.maxX - ramp.box.minX

        const slab = new THREE.Mesh(new THREE.BoxGeometry(length, 0.22, width), deckMat)
        slab.position.set(
            (ramp.box.minX + ramp.box.maxX) / 2,
            (ramp.lowY + ramp.highY) / 2 - 0.11,
            (ramp.box.minZ + ramp.box.maxZ) / 2
        )
        if (ramp.axis === 'x') {
            slab.rotation.z = ramp.highAt > ramp.lowAt ? angle : -angle
        } else {
            slab.rotation.x = ramp.highAt > ramp.lowAt ? -angle : angle
        }
        scene.add(slab)

        const nose = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.06, width),
            new THREE.MeshBasicMaterial({ color: 0xffb020 })
        )
        nose.position.set(ramp.axis === 'x' ? ramp.lowAt : (ramp.box.minX + ramp.box.maxX) / 2, ramp.lowY + 0.14, (ramp.box.minZ + ramp.box.maxZ) / 2)
        scene.add(nose)
    }

    // Lighting: strip fixtures spaced along each region.
    const lights: RoomLight[] = []
    for (const region of CALL_OF_XENO_REGIONS) {
        const theme = CALL_OF_XENO_ROOM_THEMES[region.theme]!
        const width = region.bounds.maxX - region.bounds.minX
        const depth = region.bounds.maxZ - region.bounds.minZ
        const along = width >= depth ? 'x' : 'z'
        const span = along === 'x' ? width : depth
        const count = Math.max(1, Math.round(span / 11))
        const lit = region.id === 1 ? 46 : 34

        for (let i = 0; i < count; i++) {
            const t = (i + 0.5) / count
            const x = along === 'x' ? region.bounds.minX + span * t : (region.bounds.minX + region.bounds.maxX) / 2
            const z = along === 'x' ? (region.bounds.minZ + region.bounds.maxZ) / 2 : region.bounds.minZ + span * t
            const fixture = buildCeilingLight(theme.lightColor, region.ceiling)
            fixture.position.set(x, 0, z)
            if (along === 'z') fixture.rotation.y = Math.PI / 2
            scene.add(fixture)

            const light = new THREE.PointLight(theme.lightColor, lit, region.id === 1 ? 40 : 30, 1.5)
            light.position.set(x, region.ceiling - 0.4, z)
            scene.add(light)
            lights.push({ light, tube: fixture.children[1] as THREE.Mesh, region: region.id, lit })
        }
    }
    scene.add(new THREE.AmbientLight(0x2a3038, 1.4))
    scene.add(new THREE.HemisphereLight(0x556070, 0x14161b, 0.7))

    // Doors and their frames.
    const doors = new Map<string, THREE.Group>()
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x54402c })

    const makeDoor = (id: string) => {
        const door = CALL_OF_XENO_DOORS.find(d => d.id === id)!
        const group = new THREE.Group()
        const width = door.box.maxX - door.box.minX
        const depth = door.box.maxZ - door.box.minZ
        const height = CALL_OF_XENO_ATRIUM_HEIGHT
        group.add(boxMesh(door.box, height, height / 2, doorMat))

        const spanX = width > depth
        for (let i = 0; i < 4; i++) {
            const bar = new THREE.Mesh(
                new THREE.BoxGeometry(spanX ? width * 0.9 : 1.2, 0.16, spanX ? 1.2 : depth * 0.9),
                new THREE.MeshBasicMaterial({ color: i % 2 ? 0xd8a02a : 0x2b2b2b })
            )
            bar.position.set(
                (door.box.minX + door.box.maxX) / 2,
                0.6 + i * 0.85,
                (door.box.minZ + door.box.maxZ) / 2
            )
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

        for (const offset of [-1.6, 1.6]) {
            const frame = buildDoorFrame(Math.max(4, opening), region.ceiling, theme.accent)
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

    // Interactable props.
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

    // A lit sign over the catwalk so the high ground advertises itself.
    const marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.3, 0.3),
        new THREE.MeshBasicMaterial({ color: CALL_OF_XENO_ROOM_THEMES[1]!.accent })
    )
    marker.position.set(34, CALL_OF_XENO_CATWALK_Y + 1.6, 10)
    marker.rotation.set(0.6, 0.6, 0)
    scene.add(marker)

    return { lights, doors, props, powerLever, mysteryBox, textures, makeDoor }
}
