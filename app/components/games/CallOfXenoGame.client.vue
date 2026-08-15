<template>
    <div class="relative h-screen w-full select-none overflow-hidden bg-black">
        <div ref="viewport" class="absolute inset-0" />

        <!-- Floating damage numbers, projected from world space each frame. -->
        <div class="pointer-events-none absolute inset-0 overflow-hidden">
            <div
                v-for="popup in popups"
                :key="popup.id"
                class="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-mono font-bold tabular-nums drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]"
                :style="{
                    left: popup.left + 'px',
                    top: popup.top + 'px',
                    opacity: popup.opacity,
                    color: popup.color,
                    fontSize: popup.size + 'px'
                }"
            >{{ popup.text }}</div>
        </div>

        <!-- Damage vignette plus a permanent soft edge darkening. -->
        <div class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 180px 40px rgba(0,0,0,0.75)" />
        <div
            class="pointer-events-none absolute inset-0 transition-opacity duration-150"
            :style="{ opacity: hurtOpacity, boxShadow: 'inset 0 0 200px 70px rgba(190,10,10,0.9)' }"
        />
        <div
            v-if="lowHealth"
            class="pointer-events-none absolute inset-0 animate-pulse"
            style="box-shadow: inset 0 0 260px 90px rgba(140,0,0,0.55)"
        />

        <!-- Crosshair. Opens up with recoil, turns red on a hit. -->
        <div v-if="phase === 'playing' && locked" class="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div class="relative size-16">
                <span
                    v-for="(rot, i) in [0, 90, 180, 270]"
                    :key="i"
                    class="absolute left-1/2 top-1/2 h-2.5 w-0.5 origin-center rounded-full transition-colors"
                    :class="hitMarker > 0 ? 'bg-red-400' : 'bg-white/80'"
                    :style="{ transform: `rotate(${rot}deg) translateY(${-crossGap}px) translateX(-50%)` }"
                />
                <span class="absolute left-1/2 top-1/2 size-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />
                <span
                    v-if="hitMarker > 0"
                    class="absolute inset-0 flex items-center justify-center text-lg font-bold"
                    :class="lastHitHead ? 'text-amber-300' : 'text-red-400'"
                    :style="{ opacity: hitMarker / 0.18 }"
                >✕</span>
            </div>
        </div>

        <!-- HUD -->
        <div v-if="phase !== 'menu'" class="pointer-events-none absolute inset-0 p-6 font-mono text-white">
            <div class="absolute left-6 top-6 w-56">
                <div class="flex items-end gap-2">
                    <span class="text-4xl font-bold leading-none tabular-nums" :class="lowHealth ? 'text-red-500' : 'text-white'">
                        {{ Math.ceil(health) }}
                    </span>
                    <span class="pb-1 text-sm text-white/40">/ {{ maxHealth }}</span>
                </div>
                <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                        class="h-full rounded-full transition-[width] duration-100"
                        :class="lowHealth ? 'bg-red-500' : 'bg-emerald-400'"
                        :style="{ width: (health / maxHealth * 100) + '%' }"
                    />
                </div>
                <div class="mt-1 text-[10px] uppercase tracking-[0.25em] text-white/35">Vitals</div>
            </div>

            <div class="absolute right-6 top-6 text-right">
                <div class="text-4xl font-bold leading-none tabular-nums text-amber-300">
                    {{ points.toLocaleString() }}
                </div>
                <div class="text-[10px] uppercase tracking-[0.25em] text-white/35">Points</div>
                <div class="mt-4 text-2xl font-bold leading-none text-red-500">ROUND {{ round }}</div>
                <div class="mt-0.5 flex items-center justify-end gap-1.5 text-[10px] uppercase tracking-[0.2em] text-white/35">
                    <span>{{ zombiesLeft }} left</span>
                    <span class="inline-block size-1.5 rounded-full" :class="zombiesLeft > 0 ? 'bg-red-500' : 'bg-white/20'" />
                </div>
            </div>

            <div class="absolute bottom-6 right-6 text-right">
                <div class="text-base font-bold uppercase tracking-wider" :class="weaponPapped ? 'text-fuchsia-400' : 'text-white/90'">
                    {{ weaponName }}
                </div>
                <div class="text-3xl font-bold leading-none tabular-nums">
                    <span :class="magAmmo === 0 ? 'text-red-500' : 'text-white'">{{ magAmmo }}</span>
                    <span class="text-lg text-white/40"> / {{ reserveAmmo }}</span>
                </div>
                <div class="mt-1 h-1 w-40 overflow-hidden rounded-full bg-white/10">
                    <div class="h-full rounded-full bg-amber-300/80" :style="{ width: magFraction + '%' }" />
                </div>
                <div v-if="reloading" class="mt-1 text-[10px] uppercase tracking-[0.2em] text-amber-300">Reloading</div>
                <div v-else-if="magAmmo === 0 && reserveAmmo === 0" class="mt-1 text-[10px] uppercase tracking-[0.2em] text-red-400">No ammo</div>
                <div v-if="stowedName" class="mt-2 text-[10px] uppercase tracking-[0.2em] text-white/35">[Q] {{ stowedName }}</div>
            </div>

            <div class="absolute bottom-6 left-6 flex gap-2">
                <div
                    v-for="perk in ownedPerks"
                    :key="perk.id"
                    class="flex size-12 items-center justify-center rounded-full border-2 text-[10px] font-bold uppercase shadow-lg"
                    :style="{ borderColor: perkCss(perk.color), color: perkCss(perk.color), background: perkCss(perk.color) + '22' }"
                >
                    {{ perkShort(perk.id) }}
                </div>
            </div>

            <div
                v-if="prompt"
                class="absolute left-1/2 top-[60%] -translate-x-1/2 rounded border px-4 py-2 text-center text-sm backdrop-blur-sm"
                :class="promptAffordable ? 'border-white/20 bg-black/60 text-white' : 'border-red-500/40 bg-red-950/50 text-red-300'"
            >
                {{ prompt }}
            </div>

            <Transition
                enter-active-class="transition duration-300"
                enter-from-class="opacity-0 scale-90"
                leave-active-class="transition duration-500"
                leave-to-class="opacity-0"
            >
                <div v-if="banner" class="absolute left-1/2 top-[22%] -translate-x-1/2 text-center">
                    <div class="text-5xl font-bold uppercase tracking-[0.2em] text-red-600 drop-shadow-[0_3px_8px_rgba(0,0,0,0.9)]">
                        {{ banner }}
                    </div>
                    <div v-if="subBanner" class="mt-1 text-sm uppercase tracking-[0.3em] text-white/50">{{ subBanner }}</div>
                </div>
            </Transition>

            <div v-if="!powerOn" class="absolute left-1/2 top-6 -translate-x-1/2 text-[10px] uppercase tracking-[0.3em] text-white/30">
                Power offline
            </div>

            <button
                class="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 rounded px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/30 hover:text-white/70"
                @click="toggleMute"
            >
                {{ muted ? 'Sound off [M]' : 'Sound on [M]' }}
            </button>
        </div>

        <!-- Start / pause / death -->
        <div
            v-if="phase === 'menu' || phase === 'over' || (phase === 'playing' && !locked)"
            class="absolute inset-0 flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
        >
            <div class="w-full max-w-xl rounded-xl border border-default bg-elevated p-8 text-center shadow-2xl">
                <template v-if="phase === 'menu'">
                    <div class="text-[10px] uppercase tracking-[0.4em] text-muted">Survival</div>
                    <h1 class="mt-1 text-5xl font-bold tracking-tight text-primary">Call of Xeno</h1>
                    <p class="mt-2 text-muted">Three sealed rooms. Buy your way deeper, turn the power on, survive.</p>
                </template>
                <template v-else-if="phase === 'over'">
                    <h1 class="text-5xl font-bold text-red-500">You Died</h1>
                    <p class="mt-2 text-muted">Round {{ round }} · {{ points.toLocaleString() }} points · {{ kills }} kills</p>
                    <p v-if="round > bestRound" class="mt-1 text-sm text-primary">New best round</p>
                </template>
                <template v-else>
                    <h1 class="text-4xl font-bold text-primary">Paused</h1>
                    <p class="mt-2 text-muted">Round {{ round }} · {{ points.toLocaleString() }} points</p>
                </template>

                <div class="mx-auto mt-7 grid max-w-sm grid-cols-2 gap-x-6 gap-y-1.5 text-left text-sm text-muted">
                    <div><span class="font-mono text-highlighted">WASD</span> move</div>
                    <div><span class="font-mono text-highlighted">Mouse</span> look</div>
                    <div><span class="font-mono text-highlighted">Shift</span> sprint</div>
                    <div><span class="font-mono text-highlighted">LMB</span> fire</div>
                    <div><span class="font-mono text-highlighted">R</span> reload</div>
                    <div><span class="font-mono text-highlighted">Q</span> swap weapon</div>
                    <div><span class="font-mono text-highlighted">F</span> buy / interact</div>
                    <div><span class="font-mono text-highlighted">Esc</span> pause</div>
                </div>

                <UButton size="xl" class="mt-8" @click="phase === 'over' ? restart() : begin()">
                    {{ phase === 'menu' ? 'Drop In' : phase === 'over' ? 'Try Again' : 'Resume' }}
                </UButton>
                <p class="mt-3 text-xs text-muted">Your mouse is captured while playing. Esc gives it back.</p>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import {
    CALL_OF_XENO_WEAPONS,
    CALL_OF_XENO_PERKS,
    CALL_OF_XENO_BASE_HEALTH,
    CALL_OF_XENO_JUGGERNOG_HEALTH,
    CALL_OF_XENO_REGEN_DELAY,
    CALL_OF_XENO_REGEN_RATE,
    CALL_OF_XENO_HIT_POINTS,
    CALL_OF_XENO_KILL_POINTS,
    CALL_OF_XENO_STARTING_POINTS,
    CALL_OF_XENO_PACK_A_PUNCH_COST,
    packAPunch,
    ammoCost,
    zombieHealth,
    zombieCount,
    zombieSpeed,
    zombieSpawnInterval,
    zombieDamage,
    type CallOfXenoPerk,
    type CallOfXenoPerkId,
    type CallOfXenoWeapon,
    type CallOfXenoWeaponId
} from '#shared/utils/gamelogic/call-of-xeno'
import {
    CALL_OF_XENO_WALLS,
    CALL_OF_XENO_WALL_HEIGHT,
    CALL_OF_XENO_ROOMS,
    CALL_OF_XENO_ROOM_THEMES,
    CALL_OF_XENO_CRATES,
    CALL_OF_XENO_DOORS,
    CALL_OF_XENO_INTERACTABLES,
    CALL_OF_XENO_PLAYER_START,
    collisionSolids,
    rayBlockDistance,
    roomAt,
    reachableRooms,
    resolveCircle,
    zombieTarget,
    type CallOfXenoBox,
    type CallOfXenoInteractable,
    type CallOfXenoSolid
} from '#shared/utils/gamelogic/call-of-xeno-map'
import { randomFloat, randomPick } from '#shared/utils/random'
import { CallOfXenoAudio } from '~/utils/call-of-xeno/sounds'
import { CallOfXenoEffects } from '~/utils/call-of-xeno/effects'
import {
    makeFloorTexture,
    makeWallTexture,
    makeCeilingTexture,
    makeFlashTexture
} from '~/utils/call-of-xeno/textures'
import {
    buildZombie,
    flashZombie,
    buildWeaponModel,
    buildCrate,
    buildCeilingLight,
    buildDoorFrame,
    buildWallBuy,
    buildPerkMachine,
    buildPackAPunch,
    buildPowerLever,
    type ZombieModel,
    type PropModel
} from '~/utils/call-of-xeno/models'

// ---------------------------------------------------------------------------
// HUD state
// ---------------------------------------------------------------------------

const viewport = ref<HTMLDivElement | null>(null)
const phase = ref<'menu' | 'playing' | 'over'>('menu')
const locked = ref(false)
const health = ref(CALL_OF_XENO_BASE_HEALTH)
const maxHealth = ref(CALL_OF_XENO_BASE_HEALTH)
const points = ref(CALL_OF_XENO_STARTING_POINTS)
const round = ref(1)
const bestRound = ref(1)
const kills = ref(0)
const zombiesLeft = ref(0)
const weaponName = ref(CALL_OF_XENO_WEAPONS.m1911.name)
const weaponPapped = ref(false)
const stowedName = ref('')
const magAmmo = ref(0)
const reserveAmmo = ref(0)
const magFraction = ref(100)
const reloading = ref(false)
const prompt = ref('')
const promptAffordable = ref(true)
const banner = ref('')
const subBanner = ref('')
const powerOn = ref(false)
const hitMarker = ref(0)
const lastHitHead = ref(false)
const hurtOpacity = ref(0)
const crossGap = ref(8)
const muted = ref(false)
const ownedPerks = shallowRef<CallOfXenoPerk[]>([])

interface ScreenPopup {
    id: number
    left: number
    top: number
    opacity: number
    color: string
    size: number
    text: string
}
const popups = shallowRef<ScreenPopup[]>([])

const lowHealth = computed(() => health.value / maxHealth.value < 0.34)

function perkCss(color: number) {
    return '#' + color.toString(16).padStart(6, '0')
}

function perkShort(id: CallOfXenoPerkId) {
    return { juggernog: 'JUG', speedcola: 'SPD', doubletap: '2TAP', quickrevive: 'REV' }[id]
}

// ---------------------------------------------------------------------------
// Simulation types and tuning
// ---------------------------------------------------------------------------

interface WeaponSlot {
    base: CallOfXenoWeaponId
    def: CallOfXenoWeapon
    papped: boolean
    mag: number
    reserve: number
}

interface Zombie {
    model: ZombieModel
    x: number
    z: number
    health: number
    maxHealth: number
    speed: number
    attackCooldown: number
    flash: number
    phase: number
    groanIn: number
}

interface Corpse {
    model: ZombieModel
    life: number
    fall: number
    spin: number
}

interface WorldPopup {
    id: number
    x: number
    y: number
    z: number
    vy: number
    life: number
    maxLife: number
    text: string
    color: string
    size: number
}

const PLAYER_RADIUS = 0.35
const PLAYER_EYE = 1.68
const ZOMBIE_RADIUS = 0.45
const ZOMBIE_BODY_Y = 1.12
const ZOMBIE_BODY_R = 0.56
const ZOMBIE_HEAD_Y = 1.73
const ZOMBIE_HEAD_R = 0.3
const MAX_ALIVE = 24
const WALK_SPEED = 4.4
const SPRINT_SPEED = 6.9
const INTERACT_RANGE = 2.8
const ROUND_BREAK = 6

// ---------------------------------------------------------------------------
// three.js objects
// ---------------------------------------------------------------------------

let renderer: THREE.WebGLRenderer | null = null
let scene!: THREE.Scene
let camera!: THREE.PerspectiveCamera
let effects!: CallOfXenoEffects
const audio = new CallOfXenoAudio()

let roomLights: THREE.PointLight[] = []
let lightTubes: THREE.Mesh[] = []
let doorGroups = new Map<string, THREE.Group>()
let propModels = new Map<string, PropModel>()
let powerHandle: THREE.Mesh | null = null

let weaponRoot!: THREE.Group
let weaponModel: THREE.Group | null = null
let muzzleFlash!: THREE.Sprite
let muzzleLight!: THREE.PointLight
let flashTexture!: THREE.Texture
let levelTextures: THREE.Texture[] = []

let frameHandle = 0
let disposed = false

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------

const keys = new Set<string>()
let px = CALL_OF_XENO_PLAYER_START.x
let pz = CALL_OF_XENO_PLAYER_START.z
let yaw = 0
let pitch = 0
let bob = 0
let swayX = 0
let swayY = 0
let shake = 0
let recoilPitch = 0
let hp = CALL_OF_XENO_BASE_HEALTH
let hpMax = CALL_OF_XENO_BASE_HEALTH
let sinceDamage = 99
let score = CALL_OF_XENO_STARTING_POINTS
let killCount = 0
let currentRound = 1
let spawnQueue = 0
let spawnTimer = 0
let breakTimer = 0
let inBreak = false
let bannerTimer = 0
let powered = false
let firing = false
let fireTimer = 0
let reloadTimer = 0
let reloadTotal = 0
let recoil = 0
let bloom = 0
let markerTimer = 0
let swapTimer = 0
let slots: WeaponSlot[] = []
let activeSlot = 0
let popupId = 0

const perks = new Set<CallOfXenoPerkId>()
const openDoors = new Set<string>()
const zombies: Zombie[] = []
const corpses: Corpse[] = []
const worldPopups: WorldPopup[] = []
let solids: CallOfXenoSolid[] = []
let moveBoxes: CallOfXenoBox[] = []
let focused: { kind: 'door' | 'interactable', id: string } | null = null

function makeSlot(id: CallOfXenoWeaponId, papped = false): WeaponSlot {
    const base = CALL_OF_XENO_WEAPONS[id]
    const def = papped ? packAPunch(base) : base
    return { base: id, def, papped, mag: def.magSize, reserve: def.reserveAmmo }
}

function active(): WeaponSlot {
    return slots[activeSlot]!
}

function fireDelayOf(slot: WeaponSlot) {
    return perks.has('doubletap') ? slot.def.fireDelay * 0.75 : slot.def.fireDelay
}

function damageOf(slot: WeaponSlot) {
    return perks.has('doubletap') ? slot.def.damage * 1.5 : slot.def.damage
}

function reloadTimeOf(slot: WeaponSlot) {
    return perks.has('speedcola') ? slot.def.reloadTime * 0.5 : slot.def.reloadTime
}

function shootSound(slot: WeaponSlot) {
    switch (slot.base) {
        case 'm1911': return 'shoot-pistol' as const
        case 'trench': return 'shoot-shotgun' as const
        case 'mp40': return 'shoot-smg' as const
        case 'ak74': return 'shoot-rifle' as const
        case 'rpk': return 'shoot-lmg' as const
        case 'xenoray': return 'shoot-wonder' as const
    }
}

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

function boxMesh(box: CallOfXenoBox, height: number, y: number, material: THREE.Material) {
    const geo = new THREE.BoxGeometry(box.maxX - box.minX, height, box.maxZ - box.minZ)
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.set((box.minX + box.maxX) / 2, y, (box.minZ + box.maxZ) / 2)
    return mesh
}

/** Which room a box mostly sits in, so it can take that room's palette. */
function themeFor(x: number) {
    if (x < 22) return 0
    if (x < 46) return 1
    return 2
}

function buildLevel() {
    const track = (texture: THREE.Texture) => {
        levelTextures.push(texture)
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

    for (const wall of CALL_OF_XENO_WALLS) {
        const theme = themeFor((wall.minX + wall.maxX) / 2)
        scene.add(boxMesh(wall, CALL_OF_XENO_WALL_HEIGHT, CALL_OF_XENO_WALL_HEIGHT / 2, wallMats[theme]!))
    }

    const slabs: { box: CallOfXenoBox, theme: number }[] = [
        ...CALL_OF_XENO_ROOMS.map(r => ({ box: r.bounds, theme: r.id })),
        { box: { minX: 20, maxX: 24, minZ: 8, maxZ: 12 }, theme: 0 },
        { box: { minX: 44, maxX: 48, minZ: 8, maxZ: 12 }, theme: 2 }
    ]
    for (const slab of slabs) {
        scene.add(boxMesh(slab.box, 0.2, -0.1, floorMats[slab.theme]!))
        scene.add(boxMesh(slab.box, 0.2, CALL_OF_XENO_WALL_HEIGHT + 0.1, ceilMats[slab.theme]!))
    }

    for (const crate of CALL_OF_XENO_CRATES) {
        const theme = CALL_OF_XENO_ROOM_THEMES[themeFor((crate.box.minX + crate.box.maxX) / 2)]!
        const group = buildCrate(
            crate.box.maxX - crate.box.minX,
            crate.height,
            crate.box.maxZ - crate.box.minZ,
            theme.accent
        )
        group.position.set((crate.box.minX + crate.box.maxX) / 2, 0, (crate.box.minZ + crate.box.maxZ) / 2)
        scene.add(group)
    }

    // Ceiling strip lights: two per room, one per corridor.
    roomLights = []
    lightTubes = []
    for (const room of CALL_OF_XENO_ROOMS) {
        const theme = CALL_OF_XENO_ROOM_THEMES[room.id]!
        const cz = (room.bounds.minZ + room.bounds.maxZ) / 2
        const cx = (room.bounds.minX + room.bounds.maxX) / 2
        for (const offset of [-5.5, 5.5]) {
            const fixture = buildCeilingLight(theme.lightColor, CALL_OF_XENO_WALL_HEIGHT)
            fixture.position.set(cx + offset, 0, cz)
            scene.add(fixture)
            lightTubes.push(fixture.children[1] as THREE.Mesh)

            const light = new THREE.PointLight(theme.lightColor, room.id === 2 ? 3 : 38, 32, 1.5)
            light.position.set(cx + offset, CALL_OF_XENO_WALL_HEIGHT - 0.4, cz)
            scene.add(light)
            roomLights.push(light)
        }
    }
    scene.add(new THREE.AmbientLight(0x2a3038, 1.5))
    scene.add(new THREE.HemisphereLight(0x556070, 0x14161b, 0.7))

    // Door frames around every opening, then the buyable barriers themselves.
    for (const door of CALL_OF_XENO_DOORS) {
        const theme = CALL_OF_XENO_ROOM_THEMES[themeFor(door.box.minX)]!
        for (const x of [door.box.minX - 1.6, door.box.maxX + 1.6]) {
            const frame = buildDoorFrame(4, CALL_OF_XENO_WALL_HEIGHT, theme.accent)
            frame.position.set(x, 0, door.prompt.z)
            frame.rotation.y = Math.PI / 2
            scene.add(frame)
        }
        scene.add(buildDoorMesh(door.id))
    }

    for (const item of CALL_OF_XENO_INTERACTABLES) {
        const prop = buildProp(item)
        prop.group.position.set(item.x, item.kind === 'wallbuy' ? 1.45 : 0, item.z)
        prop.group.rotation.y = item.facing
        propModels.set(item.id, prop)
        scene.add(prop.group)
    }
}

function buildDoorMesh(id: string) {
    const door = CALL_OF_XENO_DOORS.find(d => d.id === id)!
    const group = new THREE.Group()
    const panel = boxMesh(door.box, CALL_OF_XENO_WALL_HEIGHT - 0.2, (CALL_OF_XENO_WALL_HEIGHT - 0.2) / 2, new THREE.MeshLambertMaterial({ color: 0x54402c }))
    group.add(panel)

    // Chevron hazard bars so a locked door reads as locked at a glance.
    for (let i = 0; i < 4; i++) {
        const bar = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.16, 3.4),
            new THREE.MeshBasicMaterial({ color: i % 2 ? 0xd8a02a : 0x2b2b2b })
        )
        bar.position.set((door.box.minX + door.box.maxX) / 2, 0.6 + i * 0.85, (door.box.minZ + door.box.maxZ) / 2)
        bar.rotation.x = 0.18
        group.add(bar)
    }
    doorGroups.set(id, group)
    return group
}

function buildProp(item: CallOfXenoInteractable): PropModel {
    if (item.kind === 'wallbuy') return buildWallBuy(CALL_OF_XENO_WEAPONS[item.weapon!], item.needsPower)
    if (item.kind === 'perk') return buildPerkMachine(CALL_OF_XENO_PERKS[item.perk!])
    if (item.kind === 'papunch') return buildPackAPunch()
    const lever = buildPowerLever()
    powerHandle = lever.handle
    return lever
}

function rebuildCollision() {
    solids = collisionSolids(openDoors)
    moveBoxes = solids.map(s => s.box)
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function updatePlayer(dt: number) {
    let fx = 0
    let fz = 0
    if (keys.has('keyw')) fz += 1
    if (keys.has('keys')) fz -= 1
    if (keys.has('keyd')) fx += 1
    if (keys.has('keya')) fx -= 1

    let moving = false
    let speed = 0
    if (fx !== 0 || fz !== 0) {
        moving = true
        const len = Math.hypot(fx, fz)
        fx /= len
        fz /= len
        const sin = Math.sin(yaw)
        const cos = Math.cos(yaw)
        const dirX = -sin * fz + cos * fx
        const dirZ = -cos * fz - sin * fx
        speed = keys.has('shiftleft') || keys.has('shiftright') ? SPRINT_SPEED : WALK_SPEED
        px += dirX * speed * dt
        pz += dirZ * speed * dt
    }

    const solved = resolveCircle(px, pz, PLAYER_RADIUS, moveBoxes)
    px = solved.x
    pz = solved.z

    // Head bob while moving, settling back to centre when still.
    bob += dt * speed * 1.6
    const bobAmount = moving ? Math.min(0.055, speed * 0.008) : 0
    const bobY = Math.sin(bob * 2) * bobAmount
    const bobX = Math.cos(bob) * bobAmount * 0.6

    shake = Math.max(0, shake - dt * 4)
    recoilPitch = Math.max(0, recoilPitch - dt * 3.2)

    camera.position.set(
        px + bobX + (Math.random() - 0.5) * shake * 0.4,
        PLAYER_EYE + bobY + (Math.random() - 0.5) * shake * 0.4,
        pz
    )
    camera.rotation.set(pitch + recoilPitch, yaw, Math.sin(bob) * 0.006)

    sinceDamage += dt
    const delay = perks.has('quickrevive') ? CALL_OF_XENO_REGEN_DELAY * 0.5 : CALL_OF_XENO_REGEN_DELAY
    const rate = perks.has('quickrevive') ? CALL_OF_XENO_REGEN_RATE * 2 : CALL_OF_XENO_REGEN_RATE
    if (sinceDamage > delay && hp < hpMax) hp = Math.min(hpMax, hp + rate * dt)
}

/** Weapon view model: idle sway, walk bob, recoil kick, reload dip, swap dip. */
function updateViewModel(dt: number) {
    swayX += ((keys.has('keya') ? 0.03 : keys.has('keyd') ? -0.03 : 0) - swayX) * Math.min(1, dt * 6)
    swayY += ((keys.has('keyw') ? -0.012 : keys.has('keys') ? 0.012 : 0) - swayY) * Math.min(1, dt * 6)

    recoil = Math.max(0, recoil - dt * 7)
    const reloadPhase = reloadTotal > 0 ? 1 - Math.abs(reloadTimer / reloadTotal - 0.5) * 2 : 0
    const swapPhase = swapTimer > 0 ? Math.min(1, swapTimer / 0.18) : 0
    const dip = reloadPhase * 0.22 + swapPhase * 0.3

    weaponRoot.position.set(
        0.3 + swayX + Math.cos(bob) * 0.012,
        -0.24 + swayY - dip + Math.sin(bob * 2) * 0.01 + recoil * 0.02,
        -0.55 + recoil * 0.1
    )
    weaponRoot.rotation.set(
        recoil * 0.28 + reloadPhase * 0.5 + swapPhase * 0.7,
        swayX * 2,
        reloadPhase * 0.35
    )

    muzzleFlash.material.opacity = Math.max(0, muzzleFlash.material.opacity - dt * 22)
    muzzleFlash.visible = muzzleFlash.material.opacity > 0.01
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 60)
}

function equipModel() {
    if (weaponModel) {
        weaponRoot.remove(weaponModel)
        disposeObject(weaponModel)
    }
    const slot = active()
    weaponModel = buildWeaponModel(slot.base, slot.papped)
    weaponRoot.add(weaponModel)
    swapTimer = 0.18
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------

const rayOrigin = new THREE.Vector3()
const rayDir = new THREE.Vector3()
const pelletDir = new THREE.Vector3()
const impactPoint = new THREE.Vector3()
const impactNormal = new THREE.Vector3()
const muzzleWorld = new THREE.Vector3()
const rightVector = new THREE.Vector3()

function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number) {
    const mx = ox - cx
    const my = oy - cy
    const mz = oz - cz
    const b = mx * dx + my * dy + mz * dz
    const c = mx * mx + my * my + mz * mz - r * r
    if (c > 0 && b > 0) return -1
    const disc = b * b - c
    if (disc < 0) return -1
    const t = -b - Math.sqrt(disc)
    return t < 0 ? 0 : t
}

function shoot() {
    const slot = active()
    if (reloadTimer > 0 || swapTimer > 0) return
    if (slot.mag <= 0) {
        if (slot.reserve > 0) startReload()
        else audio.play('dry-fire')
        return
    }

    slot.mag--
    fireTimer = fireDelayOf(slot)
    recoil = 1
    bloom = Math.min(1, bloom + 0.34)
    shake = Math.min(0.09, shake + (slot.base === 'trench' || slot.base === 'rpk' ? 0.05 : 0.025))
    recoilPitch += slot.def.spread * 0.6 + 0.012
    audio.play(shootSound(slot))

    muzzleFlash.material.opacity = 1
    muzzleFlash.scale.setScalar(slot.base === 'trench' ? 0.5 : 0.32)
    muzzleFlash.material.rotation = Math.random() * Math.PI * 2
    muzzleLight.intensity = slot.base === 'xenoray' ? 12 : 9
    muzzleLight.color.setHex(slot.base === 'xenoray' ? 0x44ffcc : 0xffbb55)

    muzzleFlash.getWorldPosition(muzzleWorld)
    rightVector.set(1, 0, 0).applyQuaternion(camera.quaternion)
    effects.ejectCasing(muzzleWorld, rightVector)

    const damage = damageOf(slot)
    camera.getWorldPosition(rayOrigin)
    camera.getWorldDirection(rayDir)

    const scored = new Set<Zombie>()

    for (let pellet = 0; pellet < slot.def.pellets; pellet++) {
        pelletDir.copy(rayDir)
        const spread = slot.def.spread * (0.55 + bloom * 0.85)
        if (spread > 0) {
            const angle = randomFloat() * Math.PI * 2
            const radius = Math.sqrt(randomFloat()) * spread
            pelletDir.x += Math.cos(angle) * radius
            pelletDir.y += Math.sin(angle) * radius
            pelletDir.z += (randomFloat() - 0.5) * radius
            pelletDir.normalize()
        }

        const block = rayBlockDistance(
            rayOrigin.x, rayOrigin.y, rayOrigin.z,
            pelletDir.x, pelletDir.y, pelletDir.z,
            solids, slot.def.range
        )
        const maxDist = Math.min(slot.def.range, block.distance)

        const hits: { zombie: Zombie, t: number, head: boolean }[] = []
        for (const zombie of zombies) {
            const body = raySphere(
                rayOrigin.x, rayOrigin.y, rayOrigin.z, pelletDir.x, pelletDir.y, pelletDir.z,
                zombie.x, ZOMBIE_BODY_Y, zombie.z, ZOMBIE_BODY_R
            )
            const head = raySphere(
                rayOrigin.x, rayOrigin.y, rayOrigin.z, pelletDir.x, pelletDir.y, pelletDir.z,
                zombie.x, ZOMBIE_HEAD_Y, zombie.z, ZOMBIE_HEAD_R
            )
            const isHead = head >= 0 && (body < 0 || head <= body)
            const t = isHead ? head : body
            if (t < 0 || t > maxDist) continue
            hits.push({ zombie, t, head: isHead })
        }
        hits.sort((a, b) => a.t - b.t)
        const landed = hits.slice(0, slot.def.penetration)

        for (const hit of landed) {
            impactPoint.copy(pelletDir).multiplyScalar(hit.t).add(rayOrigin)
            effects.bloodBurst(impactPoint, pelletDir, hit.head ? 2 : 1.2)
            applyHit(hit.zombie, hit.head ? damage * 1.5 : damage, hit.head, scored, impactPoint)
        }

        // The tracer stops at whatever the pellet actually reached.
        const endDist = landed.length >= slot.def.penetration && landed.length > 0
            ? landed[landed.length - 1]!.t
            : maxDist
        impactPoint.copy(pelletDir).multiplyScalar(endDist).add(rayOrigin)

        if (endDist >= block.distance - 0.001 && block.distance < slot.def.range) {
            impactNormal.set(block.nx, block.ny, block.nz)
            effects.wallImpact(impactPoint, impactNormal)
        }

        if (pellet < 3) {
            muzzleFlash.getWorldPosition(muzzleWorld)
            if (slot.base === 'xenoray') {
                effects.tracer(muzzleWorld, impactPoint, 0x44ffcc, 0.05, 0.16)
                effects.energyBurst(impactPoint, 0x44ffcc)
            } else {
                effects.tracer(muzzleWorld, impactPoint, slot.papped ? 0xff88ee : 0xffd27a, 0.014, 0.06)
            }
        }
    }

    if (slot.mag === 0) startReload()
}

function applyHit(zombie: Zombie, damage: number, head: boolean, scored: Set<Zombie>, at: THREE.Vector3) {
    zombie.health -= damage
    zombie.flash = 0.1
    markerTimer = 0.18
    lastHitHead.value = head

    if (!scored.has(zombie)) {
        scored.add(zombie)
        score += CALL_OF_XENO_HIT_POINTS
        audio.play(head ? 'headshot' : 'hit')
    }

    if (zombie.health <= 0) {
        const award = head ? 100 : CALL_OF_XENO_KILL_POINTS
        score += award
        killCount++
        spawnPopup(zombie.x, 1.6, zombie.z, `+${award}`, head ? '#fbbf24' : '#f8fafc', head ? 26 : 22)
        killZombie(zombie)
        audio.play('kill')
        return
    }

    spawnPopup(at.x, at.y, at.z, String(Math.round(damage)), head ? '#fbbf24' : '#fca5a5', head ? 22 : 17)
}

function spawnPopup(x: number, y: number, z: number, text: string, color: string, size: number) {
    if (worldPopups.length > 26) worldPopups.shift()
    worldPopups.push({
        id: popupId++,
        x: x + (Math.random() - 0.5) * 0.3,
        y,
        z: z + (Math.random() - 0.5) * 0.3,
        vy: 1.1,
        life: 0.85,
        maxLife: 0.85,
        text,
        color,
        size
    })
}

function startReload() {
    const slot = active()
    if (slot.reserve <= 0 || slot.mag >= slot.def.magSize || reloadTimer > 0 || swapTimer > 0) return
    reloadTotal = reloadTimeOf(slot)
    reloadTimer = reloadTotal
    audio.play('reload-start')
}

function finishReload() {
    const slot = active()
    const need = slot.def.magSize - slot.mag
    const take = Math.min(need, slot.reserve)
    slot.mag += take
    slot.reserve -= take
    reloadTotal = 0
    audio.play('reload-end')
}

// ---------------------------------------------------------------------------
// Zombies
// ---------------------------------------------------------------------------

function spawnZombie() {
    const rooms = reachableRooms(roomAt(px, pz), openDoors)
    const candidates = CALL_OF_XENO_ROOMS
        .filter(r => rooms.includes(r.id))
        .flatMap(r => r.spawns)
        .filter(s => Math.hypot(s.x - px, s.z - pz) > 6)
    const spot = candidates.length > 0 ? randomPick(candidates) : { x: CALL_OF_XENO_PLAYER_START.x, z: 2 }

    const model = buildZombie()
    model.group.position.set(spot.x, 0, spot.z)
    scene.add(model.group)

    const health = zombieHealth(currentRound)
    zombies.push({
        model,
        x: spot.x,
        z: spot.z,
        health,
        maxHealth: health,
        speed: zombieSpeed(currentRound) * (0.85 + randomFloat() * 0.3),
        attackCooldown: 0,
        flash: 0,
        phase: randomFloat() * Math.PI * 2,
        groanIn: 1 + randomFloat() * 6
    })
}

function killZombie(zombie: Zombie) {
    const index = zombies.indexOf(zombie)
    if (index === -1) return
    zombies.splice(index, 1)

    impactPoint.set(zombie.x, 0, zombie.z)
    effects.deathBurst(impactPoint)

    flashZombie(zombie.model, false)
    for (const material of [zombie.model.skin, zombie.model.clothes]) {
        material.transparent = true
    }
    corpses.push({
        model: zombie.model,
        life: 2.6,
        fall: 0,
        spin: (randomFloat() - 0.5) * 1.4
    })
}

function removeZombieModel(model: ZombieModel) {
    scene.remove(model.group)
    disposeObject(model.group)
}

function updateZombies(dt: number) {
    const damage = zombieDamage(currentRound)

    for (const zombie of zombies) {
        const target = zombieTarget(zombie.x, zombie.z, px, pz)
        const dx = target.x - zombie.x
        const dz = target.z - zombie.z
        const dist = Math.hypot(dx, dz)
        const toPlayer = Math.hypot(px - zombie.x, pz - zombie.z)

        let moved = 0
        if (dist > 0.05 && toPlayer > 1.1) {
            zombie.x += (dx / dist) * zombie.speed * dt
            zombie.z += (dz / dist) * zombie.speed * dt
            moved = zombie.speed
        }

        const solved = resolveCircle(zombie.x, zombie.z, ZOMBIE_RADIUS, moveBoxes)
        zombie.x = solved.x
        zombie.z = solved.z

        zombie.attackCooldown -= dt
        if (toPlayer < 1.55 && zombie.attackCooldown <= 0) {
            zombie.attackCooldown = 1
            hp -= damage
            sinceDamage = 0
            shake = Math.min(0.16, shake + 0.12)
            audio.play('zombie-attack')
            audio.play('hurt')
        }

        zombie.groanIn -= dt
        if (zombie.groanIn <= 0) {
            zombie.groanIn = 4 + randomFloat() * 8
            if (toPlayer < 22) audio.play('zombie-groan')
        }

        if (zombie.flash > 0) {
            zombie.flash -= dt
            flashZombie(zombie.model, zombie.flash > 0)
        }

        // Walk cycle: opposed leg swing, arms lagging a quarter phase behind.
        zombie.phase += dt * (2.2 + moved * 0.8)
        const swing = Math.sin(zombie.phase) * 0.55
        zombie.model.legL.rotation.x = swing
        zombie.model.legR.rotation.x = -swing
        zombie.model.armL.rotation.x = -0.55 + Math.sin(zombie.phase + 1.6) * 0.16
        zombie.model.armR.rotation.x = -0.55 - Math.sin(zombie.phase + 1.6) * 0.16
        zombie.model.head.rotation.z = Math.sin(zombie.phase * 0.5) * 0.12

        zombie.model.group.position.set(zombie.x, Math.abs(Math.sin(zombie.phase)) * 0.045, zombie.z)
        zombie.model.group.rotation.y = Math.atan2(px - zombie.x, pz - zombie.z)
        zombie.model.group.rotation.z = Math.sin(zombie.phase) * 0.05
    }

    // Soft separation so a pack does not fuse into one body.
    for (let i = 0; i < zombies.length; i++) {
        for (let j = i + 1; j < zombies.length; j++) {
            const a = zombies[i]!
            const b = zombies[j]!
            const dx = b.x - a.x
            const dz = b.z - a.z
            const d = Math.hypot(dx, dz)
            if (d > 0.9 || d < 1e-4) continue
            const push = (0.9 - d) / 2
            a.x -= (dx / d) * push
            a.z -= (dz / d) * push
            b.x += (dx / d) * push
            b.z += (dz / d) * push
        }
    }

    for (let i = corpses.length - 1; i >= 0; i--) {
        const corpse = corpses[i]!
        corpse.life -= dt
        corpse.fall = Math.min(1, corpse.fall + dt * 3.4)
        const eased = corpse.fall * corpse.fall * (3 - 2 * corpse.fall)
        corpse.model.group.rotation.x = eased * Math.PI * 0.5
        corpse.model.group.rotation.z += corpse.spin * dt * (1 - eased)
        corpse.model.group.position.y = -eased * 0.25
        const fade = Math.min(1, corpse.life / 0.9)
        corpse.model.skin.opacity = fade
        corpse.model.clothes.opacity = fade
        if (corpse.life <= 0) {
            removeZombieModel(corpse.model)
            corpses.splice(i, 1)
        }
    }
}

function updateRound(dt: number) {
    if (inBreak) {
        breakTimer -= dt
        if (breakTimer <= 0) {
            inBreak = false
            currentRound++
            spawnQueue = zombieCount(currentRound)
            spawnTimer = 0
            bannerTimer = 2.2
            banner.value = `Round ${currentRound}`
            subBanner.value = `${spawnQueue} contacts`
            audio.play('round-start')
        }
        return
    }

    if (spawnQueue > 0) {
        spawnTimer -= dt
        if (spawnTimer <= 0 && zombies.length < MAX_ALIVE) {
            spawnZombie()
            spawnQueue--
            spawnTimer = zombieSpawnInterval(currentRound)
        }
    } else if (zombies.length === 0) {
        inBreak = true
        breakTimer = ROUND_BREAK
    }
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function updatePrompt() {
    focused = null
    let text = ''
    let affordable = true
    let best = INTERACT_RANGE

    for (const door of CALL_OF_XENO_DOORS) {
        if (openDoors.has(door.id)) continue
        const d = Math.hypot(door.prompt.x - px, door.prompt.z - pz)
        if (d > best) continue
        best = d
        focused = { kind: 'door', id: door.id }
        text = `[F] Open Door — ${door.cost}`
        affordable = score >= door.cost
    }

    for (const item of CALL_OF_XENO_INTERACTABLES) {
        const d = Math.hypot(item.x - px, item.z - pz)
        if (d > best) continue

        if (item.kind === 'power') {
            if (powered) continue
            best = d
            focused = { kind: 'interactable', id: item.id }
            text = '[F] Throw Power Switch'
            affordable = true
            continue
        }

        if (item.needsPower && !powered) {
            best = d
            focused = null
            text = 'Needs power'
            affordable = false
            continue
        }

        if (item.kind === 'wallbuy') {
            const weapon = CALL_OF_XENO_WEAPONS[item.weapon!]
            const owned = slots.find(s => s.base === weapon.id)
            const cost = owned ? ammoCost(weapon) : weapon.cost
            best = d
            if (owned && owned.reserve >= owned.def.reserveAmmo) {
                focused = null
                text = `${weapon.name} — ammo full`
                affordable = true
                continue
            }
            focused = { kind: 'interactable', id: item.id }
            text = owned ? `[F] ${weapon.name} Ammo — ${cost}` : `[F] Buy ${weapon.name} — ${cost}`
            affordable = score >= cost
        } else if (item.kind === 'perk') {
            const perk = CALL_OF_XENO_PERKS[item.perk!]
            best = d
            if (perks.has(perk.id)) {
                focused = null
                text = `${perk.name} — active`
                affordable = true
                continue
            }
            focused = { kind: 'interactable', id: item.id }
            text = `[F] ${perk.name} — ${perk.cost}`
            affordable = score >= perk.cost
        } else if (item.kind === 'papunch') {
            best = d
            if (active().papped) {
                focused = null
                text = `${active().def.name} already upgraded`
                affordable = true
                continue
            }
            focused = { kind: 'interactable', id: item.id }
            text = `[F] Pack-a-Punch — ${CALL_OF_XENO_PACK_A_PUNCH_COST}`
            affordable = score >= CALL_OF_XENO_PACK_A_PUNCH_COST
        }
    }

    prompt.value = text
    promptAffordable.value = affordable
}

function spend(cost: number) {
    if (score < cost) {
        audio.play('deny')
        return false
    }
    score -= cost
    spawnPopup(px, PLAYER_EYE + 0.4, pz, `-${cost}`, '#fca5a5', 18)
    return true
}

function interact() {
    if (!focused) {
        if (prompt.value) audio.play('deny')
        return
    }

    if (focused.kind === 'door') {
        const door = CALL_OF_XENO_DOORS.find(d => d.id === focused!.id)!
        if (!spend(door.cost)) return
        openDoors.add(door.id)
        const group = doorGroups.get(door.id)
        if (group) {
            scene.remove(group)
            disposeObject(group)
            doorGroups.delete(door.id)
        }
        rebuildCollision()
        audio.play('door')
        return
    }

    const item = CALL_OF_XENO_INTERACTABLES.find(i => i.id === focused!.id)!
    if (item.needsPower && !powered) return

    if (item.kind === 'power') {
        powered = true
        powerOn.value = true
        for (const light of roomLights) if (light.intensity < 10) light.intensity = 38
        for (const entry of CALL_OF_XENO_INTERACTABLES) {
            if (!entry.needsPower) continue
            const prop = propModels.get(entry.id)
            if (!prop) continue
            for (const material of prop.glow) {
                if (entry.kind === 'papunch') material.color.setHex(0xa855f7)
                else if (entry.perk) material.color.setHex(CALL_OF_XENO_PERKS[entry.perk].color)
            }
            if (prop.light) prop.light.intensity = entry.kind === 'papunch' ? 6 : 3
        }
        const leverProp = propModels.get('power')
        if (leverProp) for (const material of leverProp.glow) material.color.setHex(0x33ff66)
        if (powerHandle) powerHandle.rotation.x = -0.9
        bannerTimer = 2.5
        banner.value = 'Power On'
        subBanner.value = 'Perks and Pack-a-Punch online'
        audio.play('power')
        return
    }

    if (item.kind === 'wallbuy') {
        const weapon = CALL_OF_XENO_WEAPONS[item.weapon!]
        const owned = slots.find(s => s.base === weapon.id)
        if (owned) {
            if (owned.reserve >= owned.def.reserveAmmo) return
            if (!spend(ammoCost(weapon))) return
            owned.reserve = owned.def.reserveAmmo
            audio.play('buy')
            return
        }
        if (!spend(weapon.cost)) return
        const slot = makeSlot(weapon.id)
        if (slots.length < 2) {
            slots.push(slot)
            activeSlot = slots.length - 1
        } else {
            slots[activeSlot] = slot
        }
        reloadTimer = 0
        reloadTotal = 0
        equipModel()
        audio.play('buy')
        return
    }

    if (item.kind === 'perk') {
        const perk = CALL_OF_XENO_PERKS[item.perk!]
        if (perks.has(perk.id) || !spend(perk.cost)) return
        perks.add(perk.id)
        if (perk.id === 'juggernog') {
            hpMax = CALL_OF_XENO_JUGGERNOG_HEALTH
            hp = hpMax
        }
        ownedPerks.value = [...perks].map(id => CALL_OF_XENO_PERKS[id])
        bannerTimer = 1.8
        banner.value = perk.name
        subBanner.value = perk.description
        audio.play('perk')
        return
    }

    if (item.kind === 'papunch') {
        const slot = active()
        if (slot.papped || !spend(CALL_OF_XENO_PACK_A_PUNCH_COST)) return
        slots[activeSlot] = makeSlot(slot.base, true)
        reloadTimer = 0
        reloadTotal = 0
        equipModel()
        bannerTimer = 2
        banner.value = slots[activeSlot]!.def.name
        subBanner.value = 'Upgraded'
        audio.play('papunch')
    }
}

function swapWeapon() {
    if (slots.length < 2 || swapTimer > 0) return
    activeSlot = activeSlot === 0 ? 1 : 0
    reloadTimer = 0
    reloadTotal = 0
    equipModel()
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

const projected = new THREE.Vector3()

function updatePopups(dt: number) {
    if (worldPopups.length === 0) {
        if (popups.value.length > 0) popups.value = []
        return
    }
    const width = renderer!.domElement.clientWidth
    const height = renderer!.domElement.clientHeight
    const next: ScreenPopup[] = []

    for (let i = worldPopups.length - 1; i >= 0; i--) {
        const popup = worldPopups[i]!
        popup.life -= dt
        if (popup.life <= 0) {
            worldPopups.splice(i, 1)
            continue
        }
        popup.y += popup.vy * dt
        popup.vy -= dt * 0.9

        projected.set(popup.x, popup.y, popup.z).project(camera)
        if (projected.z > 1) continue
        const t = popup.life / popup.maxLife
        next.push({
            id: popup.id,
            left: (projected.x * 0.5 + 0.5) * width,
            top: (-projected.y * 0.5 + 0.5) * height,
            opacity: Math.min(1, t * 1.8),
            color: popup.color,
            size: popup.size * (0.75 + t * 0.25),
            text: popup.text
        })
    }
    popups.value = next
}

function syncHud() {
    const slot = active()
    health.value = Math.max(0, hp)
    maxHealth.value = hpMax
    points.value = score
    round.value = currentRound
    kills.value = killCount
    zombiesLeft.value = zombies.length + spawnQueue
    weaponName.value = slot.def.name
    weaponPapped.value = slot.papped
    magAmmo.value = slot.mag
    reserveAmmo.value = slot.reserve
    magFraction.value = (slot.mag / slot.def.magSize) * 100
    reloading.value = reloadTimer > 0
    stowedName.value = slots.length > 1 ? slots[activeSlot === 0 ? 1 : 0]!.def.name : ''
    hitMarker.value = markerTimer
    hurtOpacity.value = Math.max(0, 1 - hp / (hpMax * 0.62))
    crossGap.value = 7 + bloom * 16 + (keys.has('shiftleft') ? 6 : 0)
}

function update(dt: number) {
    updatePlayer(dt)
    updateViewModel(dt)
    updateZombies(dt)
    updateRound(dt)
    updatePrompt()
    updatePopups(dt)
    effects.update(dt)

    if (reloadTimer > 0) {
        reloadTimer -= dt
        if (reloadTimer <= 0) { reloadTimer = 0; finishReload() }
    }
    swapTimer = Math.max(0, swapTimer - dt)

    fireTimer -= dt
    if (firing && fireTimer <= 0 && reloadTimer <= 0 && swapTimer <= 0) {
        shoot()
        if (!active().def.automatic) firing = false
    }

    bloom = Math.max(0, bloom - dt * 1.6)
    markerTimer = Math.max(0, markerTimer - dt)

    // Light tubes flicker faintly so the rooms are not perfectly static.
    const flicker = 0.88 + Math.sin(performance.now() * 0.004) * 0.06 + Math.random() * 0.06
    for (const tube of lightTubes) {
        (tube.material as THREE.MeshBasicMaterial).opacity = flicker
    }

    if (bannerTimer > 0) {
        bannerTimer -= dt
        if (bannerTimer <= 0 && !inBreak) { banner.value = ''; subBanner.value = '' }
    } else if (inBreak) {
        banner.value = `Round ${currentRound + 1}`
        subBanner.value = `Incoming in ${Math.ceil(breakTimer)}`
    }

    if (hp <= 0) die()
}

function die() {
    phase.value = 'over'
    bestRound.value = Math.max(bestRound.value, currentRound)
    firing = false
    keys.clear()
    audio.play('death')
    if (document.pointerLockElement) document.exitPointerLock()
    syncHud()
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function disposeObject(root: THREE.Object3D) {
    root.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose?.()
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
        for (const material of materials) {
            // Canvas-backed signage keeps a texture alive after the material goes.
            const map = (material as THREE.MeshBasicMaterial).map
            map?.dispose()
            material.dispose()
        }
    })
}

function resetRun() {
    for (const zombie of [...zombies]) {
        scene.remove(zombie.model.group)
        disposeObject(zombie.model.group)
    }
    zombies.length = 0
    for (const corpse of corpses) removeZombieModel(corpse.model)
    corpses.length = 0
    worldPopups.length = 0
    popups.value = []
    effects.clear()

    for (const door of CALL_OF_XENO_DOORS) {
        if (!doorGroups.has(door.id)) scene.add(buildDoorMesh(door.id))
    }
    openDoors.clear()
    perks.clear()
    ownedPerks.value = []
    powered = false
    powerOn.value = false

    for (const room of CALL_OF_XENO_ROOMS) {
        for (let i = 0; i < 2; i++) {
            const light = roomLights[room.id * 2 + i]
            if (light) light.intensity = room.id === 2 ? 3 : 38
        }
    }
    for (const entry of CALL_OF_XENO_INTERACTABLES) {
        const prop = propModels.get(entry.id)
        if (!prop) continue
        for (const material of prop.glow) {
            if (entry.kind === 'power') material.color.setHex(0x441111)
            else if (entry.kind === 'papunch') material.color.setHex(0x2a0f3a)
            else if (entry.perk) material.color.setHex(CALL_OF_XENO_PERKS[entry.perk].color).multiplyScalar(0.14)
        }
        if (prop.light) prop.light.intensity = 0
    }
    if (powerHandle) powerHandle.rotation.x = 0.9

    px = CALL_OF_XENO_PLAYER_START.x
    pz = CALL_OF_XENO_PLAYER_START.z
    yaw = 0
    pitch = 0
    bob = 0
    shake = 0
    recoilPitch = 0
    bloom = 0
    hpMax = CALL_OF_XENO_BASE_HEALTH
    hp = hpMax
    sinceDamage = 99
    score = CALL_OF_XENO_STARTING_POINTS
    killCount = 0
    currentRound = 1
    spawnQueue = zombieCount(1)
    spawnTimer = 1.5
    inBreak = false
    breakTimer = 0
    bannerTimer = 2.4
    banner.value = 'Round 1'
    subBanner.value = 'Landing Bay'
    slots = [makeSlot('m1911')]
    activeSlot = 0
    reloadTimer = 0
    reloadTotal = 0
    swapTimer = 0
    fireTimer = 0
    firing = false
    equipModel()
    rebuildCollision()
    syncHud()
}

function begin() {
    audio.start()
    if (phase.value === 'menu') resetRun()
    phase.value = 'playing'
    viewport.value?.querySelector('canvas')?.requestPointerLock()
}

function restart() {
    audio.start()
    resetRun()
    phase.value = 'playing'
    viewport.value?.querySelector('canvas')?.requestPointerLock()
}

function toggleMute() {
    muted.value = !muted.value
    audio.setMuted(muted.value)
}

function onKeyDown(event: KeyboardEvent) {
    const code = event.code.toLowerCase()
    keys.add(code)
    if (code === 'keym') toggleMute()
    if (phase.value !== 'playing' || !locked.value) return
    if (code === 'keyr') startReload()
    if (code === 'keyf') interact()
    if (code === 'keyq') swapWeapon()
    if (code === 'space') event.preventDefault()
}

function onKeyUp(event: KeyboardEvent) {
    keys.delete(event.code.toLowerCase())
}

function onMouseMove(event: MouseEvent) {
    if (!locked.value) return
    yaw -= event.movementX * 0.0022
    pitch -= event.movementY * 0.0022
    pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch))
}

function onMouseDown(event: MouseEvent) {
    if (event.button !== 0 || !locked.value || phase.value !== 'playing') return
    firing = true
}

function onMouseUp(event: MouseEvent) {
    if (event.button === 0) firing = false
}

function onPointerLockChange() {
    locked.value = document.pointerLockElement !== null
    if (!locked.value) {
        firing = false
        keys.clear()
    }
}

function onResize() {
    if (!renderer || !viewport.value) return
    const width = viewport.value.clientWidth
    const height = viewport.value.clientHeight
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
}

onMounted(() => {
    const host = viewport.value
    if (!host) return

    scene = new THREE.Scene()
    scene.background = new THREE.Color(0x05070a)
    scene.fog = new THREE.Fog(0x05070a, 12, 44)

    camera = new THREE.PerspectiveCamera(80, host.clientWidth / host.clientHeight, 0.03, 220)
    camera.rotation.order = 'YXZ'

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setSize(host.clientWidth, host.clientHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    host.appendChild(renderer.domElement)

    effects = new CallOfXenoEffects(scene)
    buildLevel()

    weaponRoot = new THREE.Group()
    camera.add(weaponRoot)

    flashTexture = makeFlashTexture()
    muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTexture,
        transparent: true,
        opacity: 0,
        depthTest: false,
        blending: THREE.AdditiveBlending
    }))
    muzzleFlash.position.set(0, 0.05, -0.62)
    muzzleFlash.scale.setScalar(0.32)
    muzzleFlash.visible = false
    weaponRoot.add(muzzleFlash)

    muzzleLight = new THREE.PointLight(0xffbb55, 0, 10, 2)
    muzzleLight.position.set(0, 0.05, -0.7)
    weaponRoot.add(muzzleLight)

    scene.add(camera)
    resetRun()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('resize', onResize)
    document.addEventListener('pointerlockchange', onPointerLockChange)

    let last = performance.now()
    const loop = (now: number) => {
        if (disposed) return
        frameHandle = requestAnimationFrame(loop)
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        if (phase.value === 'playing' && locked.value) {
            update(dt)
            syncHud()
        }
        renderer!.render(scene, camera)
    }
    frameHandle = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
    disposed = true
    cancelAnimationFrame(frameHandle)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mouseup', onMouseUp)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('pointerlockchange', onPointerLockChange)
    if (document.pointerLockElement) document.exitPointerLock()

    audio.dispose()
    effects?.dispose()
    if (scene) disposeObject(scene)
    flashTexture?.dispose()
    for (const texture of levelTextures) texture.dispose()
    levelTextures = []
    renderer?.dispose()
    renderer = null

    // Module-scope caches outlive the component instance.
    zombies.length = 0
    corpses.length = 0
    worldPopups.length = 0
    doorGroups = new Map()
    propModels = new Map()
    roomLights = []
    lightTubes = []
    weaponModel = null
    powerHandle = null
})
</script>
