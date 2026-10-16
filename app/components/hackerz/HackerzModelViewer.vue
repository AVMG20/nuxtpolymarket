<script setup lang="ts">
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { HACKERZ_HEAL_TICK_MS, HACKERZ_SPIDER_MAX_DRAIN, hackerzEnemy, type HackerzEnemyDefinition } from '#shared/utils/gamelogic/hackerz'
import { FIELD_SCALE, MODEL_HEIGHT_SCALE } from '~/utils/hackerz-engine/constants'
import { buildRig, disposeRig, hdr, loadModels, type ModelRig } from '~/utils/hackerz-engine/models'
import {
  MOTION, burrowFrame, drainGrowth, gatherLegs, easeHeave, easeInject, fangTips, injectLands, easeRailKick, easeRecoil, easeSheen, easeStrike, easeTurretKick, groundPace, heaveCarry, heaveReleases,
  hitFlash, hoverBob, poseRig, muzzleOf, railKickFor, rollSpeedFor, spinTurret, strideFor, strikeLands, turnToward, weaponTip
} from '~/utils/hackerz-engine/rig-motion'
import { HackTerminals } from '~/utils/hackerz-engine/hack-terminal'
import { makeProjectile, makeSpit } from '~/utils/hackerz-engine/fx'
import { LeakCarry, LeakStack } from '~/utils/hackerz-engine/memory-leak'
import { Shrapnel } from '~/utils/hackerz-engine/shrapnel'
import { HexShield } from '~/utils/hackerz-engine/hex-shield'
import { CRYSTAL_RIBBON_IDS, CrystalRibbon } from '~/utils/hackerz-engine/crystal-ribbon'
import { BLOCK_STORM_IDS, BlockStorm } from '~/utils/hackerz-engine/block-storm'
import { DrainWound } from '~/utils/hackerz-engine/drain-wound'
import { IceWall, disposeIceGlob, makeIceGlob } from '~/utils/hackerz-engine/ice-wall'
import { emblemTextures } from '~/utils/hackerz-engine/lane-props'
import type { CodexModel } from '~/utils/hackerz-codex'

/**
 * A model from the database on a turntable — and a mob debugging tool. Every
 * animation here is one of the game's own states, run through the same motion
 * code the board uses (`rig-motion`), at the unit's own speed, size and attack
 * timing: if a mob moves wrong in the game, it moves wrong here too.
 *
 * Drag to spin it round its axis; click to step through its states.
 */

const props = defineProps<{ spec: CodexModel }>()

const host = ref<HTMLDivElement | null>(null)

const def = computed<HackerzEnemyDefinition | null>(() => props.spec.enemy ? hackerzEnemy(props.spec.enemy) : null)

/**
 * The game states on offer for this model, by name:
 * - Hold: standing still, as when holding back or covering.
 * - Walk / Fly: moving at its own pace. Charge: on their red ground, at the speed it gives.
 * - Attack: at the wall, striking on its own attack timer (a gun recoils, volleys and all).
 * - Hacking: the hacker at a node, terminal open, pulses flying (hackers only).
 * - Shielded: carrying red ground's shield. Hit: taking rounds.
 * - Turrets: Idle, Track (swinging onto a moving target), Fire (at its own rate).
 */
const animations = computed<string[]>(() => {
  if (props.spec.kind === 'turret') return ['Idle', 'Track', 'Fire']
  const move = props.spec.kind === 'flyer' ? 'Fly' : 'Walk'
  // A healer mends instead of attacking, and goes off when it is the last of its wave.
  const list = def.value?.heal
    ? ['Hold', move, 'Heal', 'Self-destruct', 'Shielded', 'Hit']
    : ['Hold', move, 'Charge', 'Attack', 'Shielded', 'Hit']
  // A carried shield can be broken off; ROOTKIT goes to ground.
  if (def.value?.guard) list.push('Shatter')
  if (def.value?.id === 'titan') list.push('Burrow')
  return props.spec.enemy === 'crawler' ? ['Hacking', ...list] : list
})
const animation = ref(0)
const animationName = computed(() => animations.value[animation.value % animations.value.length] ?? 'Hold')

let renderer: THREE.WebGLRenderer | null = null
let composer: EffectComposer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let rig: ModelRig | null = null
let frame = 0
let last = 0
let clock = 0
let spin = 0.6
let spinVelocity = 0
let autoSpin = true
let resize: ResizeObserver | null = null

/** The unit's state, kept and advanced exactly as the engine keeps it on an enemy or a mount. */
const state = {
  stride: 0,
  hover: 0,
  flashMs: 0,
  recoil: 0,
  strike: 0,
  heave: 0,
  inject: 0,
  power: 1,
  boomMs: 0,
  boomed: false,
  attackTimer: 0,
  burstLeft: 0,
  kick: 0,
  heading: 0,
  fireTimer: 0,
  hitTimer: 0
}

let stage: THREE.Group | null = null
let chip: THREE.Group | null = null
let chipRing: THREE.Line | null = null
let chipEmblem: THREE.MeshBasicMaterial | null = null
/** The node the hacker works on: red, as a node under attack is, on the stage behind it. */
const CHIP_HEX = 0xff3b3b
const CHIP_SCALE = 0.4
const CHIP_AT = new THREE.Vector3(0, 0, -0.75)
const RING_STEPS = 64
/** Where the hacker parks to work: in front of the node, facing it. */
const HACKER_AT = new THREE.Vector3(0, 0, 0.7)

/** Height the model is built to, and the most any extent may span on the turntable, in world units. */
const MODEL_HEIGHT = 2
const MODEL_FIT = 2.4
let fitScale = 1

async function mount() {
  const el = host.value
  if (!el) return
  renderer = new THREE.WebGLRenderer({ antialias: false })
  renderer.setPixelRatio(Math.min(2, Math.max(1, window.devicePixelRatio)))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // The board's look: tone-mapped, and bloomed, which is what makes the glow
  // parts glow — without it a Sapper's charge is just a flat light patch.
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  el.appendChild(renderer.domElement)
  renderer.domElement.style.display = 'block'

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x02070d)
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50)
  camera.position.set(0, 1.9, 6.4)
  camera.lookAt(0, 0.85, 0)

  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }))
  composer.addPass(new RenderPass(scene, camera))
  // Gentler than the board's: up close a model fills the frame, and the board's
  // settings would wash the whole panel out.
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.18, 0.9))
  composer.addPass(new OutputPass())

  // A turntable: a lit ring and a faint disc under the model.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.25, 1.3, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: hdr(props.spec.hex, 1.2), toneMapped: false, transparent: true, opacity: 0.7 })
  )
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.25, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: props.spec.hex, transparent: true, opacity: 0.06 })
  )
  discMesh = disc
  scene.add(ring, disc)
  // Everything that turns with the turntable stands on the stage.
  stage = new THREE.Group()
  scene.add(stage)
  stage.add(buildChip(), buildFloor())
  shrapnel = new Shrapnel(scene)

  resize = new ResizeObserver(fit)
  resize.observe(el)
  fit()

  await loadModels()
  build()
  last = performance.now()
  frame = requestAnimationFrame(loop)
}

function build() {
  if (!stage) return
  if (rig) disposeRig(rig)
  hexShield?.dispose()
  hexShield = null
  rig = buildRig(props.spec.id, props.spec.hex, MODEL_HEIGHT)
  if (rig.guardParts.length) hexShield = new HexShield(rig)
  floorUniforms.uColor.value.copy(hdr(props.spec.hex, 0.9))
  // Models are built to a height, so a long, low one (a Siege Tank) comes out
  // huge: scale it down until its largest extent fits the turntable.
  const size = rig.box.getSize(new THREE.Vector3())
  fitScale = Math.min(1, MODEL_FIT / Math.max(size.x, size.y, size.z))
  rig.root.scale.setScalar(fitScale)
  stage.add(rig.root)
  Object.assign(state, { stride: 0, hover: 0, flashMs: 0, recoil: 0, strike: 0, heave: 0, inject: 0, power: 1, boomMs: 0, boomed: false, attackTimer: 0, burstLeft: 0, kick: 0, heading: 0, fireTimer: 0, hitTimer: 0 })
}

/**
 * A path node like the board's — the dark package, its edge lines and the
 * emblem on top — shown red and under attack, for the hacker to work on.
 */
function buildChip() {
  const group = new THREE.Group()
  const packageGeometry = new THREE.BoxGeometry(2.8, 0.34, 2.8)
  const body = new THREE.Mesh(packageGeometry, new THREE.MeshBasicMaterial({ color: 0x050a12 }))
  body.position.y = 0.2
  body.add(new THREE.LineSegments(new THREE.EdgesGeometry(packageGeometry), new THREE.LineBasicMaterial({ color: hdr(CHIP_HEX, 1.6), toneMapped: false })))
  chipEmblem = new THREE.MeshBasicMaterial({
    map: emblemTextures().theirs[0] ?? null,
    color: hdr(CHIP_HEX, 1.7),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  })
  const emblem = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1).rotateX(-Math.PI / 2), chipEmblem)
  emblem.position.y = 0.4
  // The hack's progress ring, filling round the node.
  const points: THREE.Vector3[] = []
  for (let s = 0; s <= RING_STEPS; s++) {
    const a = s / RING_STEPS * Math.PI * 2
    points.push(new THREE.Vector3(Math.sin(a) * 2.1, 0.06, Math.cos(a) * 2.1))
  }
  chipRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: hdr(CHIP_HEX, 2.2), toneMapped: false }))
  group.add(body, emblem, chipRing)
  group.scale.setScalar(CHIP_SCALE)
  group.position.copy(CHIP_AT)
  group.visible = false
  chip = group
  return group
}

/** The turntable's grid floor and faint disc: hidden while a faux chip floor stands in for them. */
let floorMesh: THREE.Mesh | null = null
let discMesh: THREE.Mesh | null = null

// ── The floor: a faint grid on the disc that scrolls back under a moving unit at its pace ──
/** Grid cell size in turntable units. */
const FLOOR_CELL = 0.25
const floorUniforms = {
  uScroll: { value: 0 },
  uColor: { value: new THREE.Color() },
  uCell: { value: FLOOR_CELL },
  uRadius: { value: 1.25 }
}

function buildFloor() {
  floorUniforms.uColor.value.copy(hdr(props.spec.hex, 0.9))
  const material = new THREE.ShaderMaterial({
    uniforms: floorUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */`
      varying vec2 vPos;
      void main() {
        vPos = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uScroll;
      uniform vec3 uColor;
      uniform float uCell;
      uniform float uRadius;
      varying vec2 vPos;
      void main() {
        vec2 cell = vec2(vPos.x, vPos.y + uScroll) / uCell;
        vec2 edge = abs(fract(cell) - 0.5);
        float width = fwidth(cell.x) + fwidth(cell.y);
        float line = 1.0 - smoothstep(0.0, width * 1.2, 0.5 - max(edge.x, edge.y));
        float fade = 1.0 - smoothstep(uRadius * 0.55, uRadius, length(vPos));
        gl_FragColor = vec4(uColor * line * fade * 0.22, 1.0);
      }`
  })
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.25, 64).rotateX(-Math.PI / 2), material)
  floor.position.y = 0.005
  floor.renderOrder = -1
  floorMesh = floor
  return floor
}

/** Scrolls the floor back under the unit by `distance` turntable units. */
function scrollFloor(distance: number) {
  floorUniforms.uScroll.value = (floorUniforms.uScroll.value + distance) % (FLOOR_CELL * 64)
}

function fit() {
  const el = host.value
  if (!el || !renderer || !camera) return
  const width = el.clientWidth || 240
  const height = el.clientHeight || 280
  renderer.setSize(width, height, false)
  composer?.setPixelRatio(renderer.getPixelRatio())
  composer?.setSize(width, height)
  renderer.domElement.style.width = `${width}px`
  renderer.domElement.style.height = `${height}px`
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

function loop(now: number) {
  frame = requestAnimationFrame(loop)
  const dtMs = Math.min(50, now - last)
  last = now
  // A glob of black ice on the rail: the picture holds, as on the board.
  if (lagMs > 0) {
    lagMs -= dtMs
    composer?.render(dtMs / 1000)
    return
  }
  clock += dtMs / 1000
  if (rig) animate(rig, dtMs / 1000, dtMs)
  updateShots(dtMs / 1000)
  shrapnel?.update(dtMs / 1000)
  updateCamera(dtMs / 1000)
  composer?.render(dtMs / 1000)
}

/** Turns the turntable: a slow drift until grabbed, then the flick it was given, easing out. */
function turn(dt: number) {
  if (dragging) return
  // A shooter swings side-on, firing left to right, so the whole flight crosses the frame.
  if (shooting()) {
    spin = turnToward(spin, SHOOT_SPIN, dt * 3)
    spinVelocity = 0
  } else if (autoSpin) spin += dt * 0.35
  else {
    spin += spinVelocity * dt
    spinVelocity *= Math.max(0, 1 - dt * 2.5)
  }
}

/** Runs the state that is on, through the game's own motion. */
function animate(r: ModelRig, dt: number, dtMs: number) {
  turn(dt)
  if (stage) stage.rotation.y = spin
  r.root.rotation.y = 0
  r.root.position.set(0, 0, 0)
  r.root.scale.setScalar(fitScale)
  r.root.visible = true
  const name = animationName.value

  if (props.spec.kind === 'turret') {
    animateGun(r, name, dt, dtMs)
    return
  }
  const unit = def.value
  if (!unit) return

  hackScene(name === 'Hacking', dt)
  updateLeak(name === 'Attack', dt)
  updatePatient(name === 'Heal', dt)
  let moved = 0
  // The model is drawn at turntable size; the game's height for it is what
  // distance-driven motion (stride, roll, bob) is measured against.
  const gameHeight = unit.height * MODEL_HEIGHT_SCALE
  const sapper = unit.kind === 'bomber'
  if (name === 'Hacking') {
    r.root.position.copy(HACKER_AT)
    r.root.rotation.y = Math.PI
    r.root.scale.setScalar(fitScale * 0.75)
  } else if (name === 'Walk' || name === 'Fly') {
    moved = groundPace(unit.speed, sapper) * dt
  } else if (name === 'Charge') {
    moved = groundPace(unit.speed, sapper, true) * dt
  } else if (name === 'Heal') {
    // The board's heal tick: a beam into its patient every tick.
    state.attackTimer -= dtMs
    if (state.attackTimer <= 0) {
      state.attackTimer = HACKERZ_HEAL_TICK_MS
      healTick(r, unit)
    }
  } else if ((name === 'Attack' && sapper) || name === 'Self-destruct') {
    // A Sapper's attack is going off: it charges the fence, blows apart, and
    // (on the turntable) rezzes back for the next one.
    state.boomMs += dtMs
    if (state.boomMs >= BOOM_CYCLE_MS) state.boomMs = 0
    if (state.boomMs < BOOM_AT_MS) {
      state.boomed = false
      moved = groundPace(unit.speed, sapper, true) * dt
    } else {
      if (!state.boomed) blowUp(r, unit)
      state.boomed = true
      r.root.visible = false
    }
  } else if (name === 'Attack') {
    // The engine's attack timer, volleys and all: a gun recoils on each shot.
    state.attackTimer -= dtMs
    if (state.attackTimer <= 0) {
      if (state.burstLeft <= 0) state.burstLeft = unit.burst ?? 1
      state.burstLeft--
      state.attackTimer = state.burstLeft > 0 ? MOTION.burstGapMs : unit.attackMs
      if (unit.kind === 'ranged') {
        state.recoil = 1
        fireSpit(r, unit)
      } else {
        state.strike = 1
        if (unit.leak && state.heave <= 0) state.heave = 1
        // ROOTKIT's forelegs rear to inject; a spiderling drains the fence it is latched on.
        if (r.fangs.length && state.inject <= 0) state.inject = 1
        if (unit.drain && stage) {
          state.power = state.power >= HACKERZ_SPIDER_MAX_DRAIN ? 1 : Math.min(HACKERZ_SPIDER_MAX_DRAIN, state.power * (1 + unit.drain))
          unitWound ??= new DrainWound(stage)
          biteFence(r, unitWound, FENCE_AT.spiderling!, MODEL_HEIGHT * fitScale * 0.9)
        }
      }
    }
  }
  // Legs move only with ground covered: holding, hacking and striking, they stand.
  state.stride += strideFor(moved, unit.height)
  // The floor slides back under it at the pace it walks, at turntable scale.
  if (moved) scrollFloor(moved * FIELD_SCALE * fitScale * MODEL_HEIGHT / gameHeight)
  const roll = moved ? rollSpeedFor(moved, gameHeight, dt, FIELD_SCALE) : 0

  // Taking rounds: the engine's hit flash, a hit every beat.
  if (name === 'Hit') {
    state.hitTimer -= dtMs
    if (state.hitTimer <= 0) {
      state.hitTimer = 700
      // A carried shield takes it: the bubble flashes from the shield back.
      if (hexShield) hexShield.pulse()
      else state.flashMs = MOTION.hitFlashMs
    }
  }
  // Shatter: the shield is blown off, and (on the turntable) re-forms for the next go.
  const shattered = name === 'Shatter' && r.guardParts.length > 0
  if (shattered) {
    state.boomMs += dtMs
    if (state.boomMs >= SHATTER_CYCLE_MS) state.boomMs = 0
    const off = state.boomMs >= SHATTER_AT_MS
    if (off && !state.boomed) {
      shrapnel?.burst(r, 0xffffff, r.guardParts)
      r.root.updateWorldMatrix(true, false)
      impact(r.root.localToWorld(new THREE.Vector3(0, r.box.max.y * 0.5, r.box.max.z * 0.4)), 0xffffff, false)
    }
    state.boomed = off
  }
  for (const part of r.guardParts) part.visible = !shattered || !state.boomed
  hexShield?.update(dt)
  burrowScene(r, unit, name === 'Burrow', dt, dtMs)
  blackIceScene(r, name === 'Attack' && unit.id === 'leviathan', dt, dtMs)
  // The placeholder fence a ROOTKIT's brood, or a spiderling itself, drains.
  const fenceZ = name === 'Attack' ? FENCE_AT[unit.id] ?? null : null
  showFence(fenceZ)
  if (fenceZ === null && brood.length) clearBrood()
  if (fenceZ !== null) updateBrood(fenceZ, dt, dtMs)
  if (r.fangs.length) {
    const before = state.inject
    state.inject = easeInject(r, state.inject, dt)
    // ROOTKIT's stab hatches its brood; a spiderling's is its bite.
    if (injectLands(before, state.inject) && unit.id === 'titan') for (const tip of fangTips(r)) hatchBrood(tip)
  }
  unitWound?.update(dt)
  if (unit.drain) {
    if (name !== 'Attack') state.power = 1
    // Fitted to the turntable already: its swelling is shown at a third, so it stays in frame.
    r.root.scale.setScalar(fitScale * (1 + (drainGrowth(state.power) - 1) * 0.35))
  }
  if (state.flashMs > 0) state.flashMs = Math.max(0, state.flashMs - dtMs)
  r.body.uniforms.uFlash!.value = hitFlash(state.flashMs)
  easeSheen(r, name === 'Shielded', dt)

  if (props.spec.kind === 'flyer') {
    state.hover += dt * MOTION.hoverRate
    const toTurntable = fitScale * MODEL_HEIGHT / gameHeight
    r.root.position.y = 0.35 + hoverBob(state.hover) * FIELD_SCALE * toTurntable
  }
  poseRig(r, state.stride, dt, roll)
  // ROOTKIT's drill point is laid over the walk's pose, never under it.
  gatherLegs(r, burrowGather)
  if (r.barrel) state.recoil = easeRecoil(r, state.recoil, dt)
  // A melee blow, as the board plays it: a prod discharges at full reach; a
  // ram's slam shows as the plate itself driving out on its pistons.
  if (r.weapon) {
    const before = state.strike
    state.strike = easeStrike(r, state.strike, dt)
    if (strikeLands(before, state.strike) && r.weaponKind === 'jab') zap(r)
  }
  // A Phantom's attack: the crystal ribbon, fed for as long as it attacks.
  if (CRYSTAL_RIBBON_IDS.includes(unit.id) && scene && stage) {
    const height = MODEL_HEIGHT * fitScale
    ribbon ??= new CrystalRibbon(scene, unit.hex, height, at => puff(puffSphere, unit.hex, 2.4, at, 0.2, 0.05, 0.22))
    r.root.updateWorldMatrix(true, false)
    const chest = r.root.localToWorld(new THREE.Vector3(0, r.box.max.y * 0.6, 0))
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(stage.quaternion)
    const target = chest.clone().addScaledVector(forward, SHOT_RANGE).setY(0.9)
    ribbon.update(dt, name === 'Attack', chest, forward, target)
  }
  // ZERO DAY's attack: its blocks fly at the wall past its gem, then it regrows.
  if (BLOCK_STORM_IDS.includes(unit.id) && scene && stage) {
    storm ??= new BlockStorm(r, scene, unit.hex, at => puff(puffSphere, unit.hex, 2.4, at, 0.25, 0.06, 0.25))
    if (name === 'Attack' && !storm.running) {
      r.root.updateWorldMatrix(true, true)
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(stage.quaternion)
      storm.start(r.root.localToWorld(new THREE.Vector3(0, r.box.max.y * 0.5, 0)).addScaledVector(forward, SHOT_RANGE).setY(0.9))
    }
    storm.update(dt)
  }
  // A leak's heave: back to the disc, a block out of it, overhead, let go onto the pile.
  if (r.lifts.length) {
    const before = state.heave
    state.heave = easeHeave(r, state.heave, dt)
    const at = new THREE.Vector3()
    const grown = heaveCarry(r, state.heave, at)
    if (grown > 0 && stage) {
      leakCarry ??= new LeakCarry(stage, unit.hex)
      leakCarry.show(stage.worldToLocal(at), grown)
    } else leakCarry?.hide()
    if (heaveReleases(before, state.heave) && leakCarry) spillLeak(unit, leakCarry.mesh.position)
  }
  if (zapLine) {
    zapAge += dt
    zapLine.material.opacity = Math.max(0, 1 - zapAge / 0.18)
    zapLine.visible = zapAge < 0.18
  }
}

// ── The prod's discharge: a jagged arc from its tip, down to the ground in front ──
let zapLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null
let zapAge = 1
const zapFrom = new THREE.Vector3()

function zap(r: ModelRig) {
  if (!scene || !stage) return
  stage.updateMatrixWorld()
  if (!weaponTip(r, zapFrom)) return
  // Where the fence would be: ahead of the unit, on the floor.
  const to = stage.localToWorld(new THREE.Vector3(0, 0.05, 1.25))
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= 7; i++) {
    const p = zapFrom.clone().lerp(to, i / 7)
    if (i > 0 && i < 7) p.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.18))
    points.push(p)
  }
  if (!zapLine) {
    zapLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: hdr(0xbfe9ff, 4), toneMapped: false, transparent: true }))
    scene.add(zapLine)
  }
  zapLine.geometry.setFromPoints(points)
  zapAge = 0
}

// ── A Sapper going off: the board's blast, its spikes blown everywhere (`Shrapnel`) ──
let shrapnel: Shrapnel | null = null
/** How long it charges before it blows, and the whole loop with the gap before the next one. */
const BOOM_AT_MS = 1100
const BOOM_CYCLE_MS = 2600

function blowUp(r: ModelRig, unit: HackerzEnemyDefinition) {
  shrapnel?.burst(r, unit.hex)
  r.root.updateWorldMatrix(true, false)
  const at = r.root.localToWorld(new THREE.Vector3(0, r.box.max.y * 0.5, 0))
  impact(at, unit.hex, true)
  puff(puffSphere, 0xffffff, 3, at, 0.25, 0.3, 1.4)
}

// ── A placeholder firewall fence, and ROOTKIT's brood draining it ──
let fenceProp: THREE.Group | null = null
/** Where the fence stands in front of a unit, by the unit's size: the brood runs to it. */
const FENCE_AT = { titan: 2.2, spiderling: 1.35 } as Record<string, number>
const FENCE_HEX = 0x38bdf8
const BROOD_HEIGHT = 0.42
const BROOD_SPEED = 1.4
/** How often a latched spiderling drains, and how many times before it is shown again from the start. */
const BROOD_DRAIN_MS = 600
const BROOD_DRAINS = 7

interface Brood {
  rig: ModelRig
  stride: number
  drainMs: number
  power: number
  drains: number
  inject: number
  wound: DrainWound
}
const brood: Brood[] = []

/** A short run of the board's fence: glowing posts and rails, in front of the turntable. */
function buildFenceProp() {
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: hdr(FENCE_HEX, 1.5), toneMapped: false })
  for (let x = -1.2; x <= 1.21; x += 0.4) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.85, 0.05), material)
    post.position.set(x, 0.425, 0)
    group.add(post)
  }
  for (const y of [0.2, 0.45, 0.7]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.03, 0.03), material)
    rail.position.y = y
    group.add(rail)
  }
  return group
}

function showFence(z: number | null) {
  if (z === null) {
    if (fenceProp) fenceProp.visible = false
    return
  }
  if (!fenceProp && stage) {
    fenceProp = buildFenceProp()
    stage.add(fenceProp)
  }
  if (fenceProp) {
    fenceProp.visible = true
    fenceProp.position.z = z
  }
}

/** A spiderling out of a needle at `at` (world space), to run for the fence. */
function hatchBrood(at: THREE.Vector3) {
  if (!stage) return
  const spider = buildRig('spiderling', hackerzEnemy('spiderling').hex, BROOD_HEIGHT)
  spider.root.position.copy(stage.worldToLocal(at.clone())).setY(0)
  stage.add(spider.root)
  brood.push({ rig: spider, stride: 0, drainMs: 0, power: 1, drains: 0, inject: 0, wound: new DrainWound(stage) })
}

/** The brood: each runs to the fence, latches on and drains it, swelling, and is gone after a while. */
function updateBrood(fenceZ: number, dt: number, dtMs: number) {
  for (let i = brood.length - 1; i >= 0; i--) {
    const b = brood[i]!
    const root = b.rig.root
    const stop = fenceZ - 0.12
    let moved = 0
    if (root.position.z < stop) {
      moved = Math.min(stop - root.position.z, BROOD_SPEED * dt)
      root.position.z += moved
    } else {
      b.drainMs -= dtMs
      if (b.drainMs <= 0) {
        b.drainMs = BROOD_DRAIN_MS
        b.drains++
        b.power = Math.min(HACKERZ_SPIDER_MAX_DRAIN, b.power * (1 + (hackerzEnemy('spiderling').drain ?? 0)))
        b.inject = 1
        biteFence(b.rig, b.wound, fenceZ, BROOD_HEIGHT * drainGrowth(b.power) * 0.9)
      }
    }
    // Its legs step by the ground it covers, as on the board.
    b.stride += moved / BROOD_HEIGHT * MOTION.strideScale
    poseRig(b.rig, b.stride, dt, 0)
    b.inject = easeInject(b.rig, b.inject, dt)
    b.wound.update(dt)
    root.scale.setScalar(drainGrowth(b.power))
    if (b.drains < BROOD_DRAINS) continue
    disposeBrood(b)
    brood.splice(i, 1)
  }
}

/**
 * A bite, as on the board: the fangs drive into the fence, a red stain spills
 * out round them about the drainer's size, and the draw pulses in from its
 * edge, up the fangs, into the drainer.
 */
function biteFence(rig: ModelRig, wound: DrainWound, fenceZ: number, size: number) {
  if (!stage) return
  rig.root.updateWorldMatrix(true, true)
  const tips = fangTips(rig)
  const bite = tips.reduce((sum, t) => sum.add(t), new THREE.Vector3()).divideScalar(Math.max(1, tips.length))
  const local = stage.worldToLocal(bite)
  wound.place(new THREE.Vector3(local.x, local.y, fenceZ - 0.02), new THREE.Vector3(0, 0, -1), size)
  wound.draw(stage.worldToLocal(rig.root.localToWorld(new THREE.Vector3(0, rig.box.max.y * 0.45, 0))))
}

/** The turntable spiderling's own bite, and its stain. */
let unitWound: DrainWound | null = null

function disposeBrood(b: Brood) {
  disposeRig(b.rig)
  b.rig.root.removeFromParent()
  b.wound.dispose()
}

function clearBrood() {
  for (const b of brood) disposeBrood(b)
  brood.length = 0
  showFence(null)
  unitWound?.dispose()
  unitWound = null
}

// ── BLACK ICE: its spit, the wall it builds, and a stand-in rail it lags ──
interface ViewerGlob {
  mesh: THREE.Mesh
  from: THREE.Vector3
  to: THREE.Vector3
  t: number
  flight: number
  arc: number
  atRail: boolean
}
const iceGlobs: ViewerGlob[] = []
let iceWall: IceWall | null = null
let iceRail: ModelRig | null = null
let iceSpitMs = 0
let iceSpits = 0
/** The frame held by a glob on the rail: the turntable stands still, as the board does in a lag spike. */
let lagMs = 0
const ICE_WALL_Z = 1.9
const ICE_WALL_HEIGHT = 1.4
const ICE_RAIL_Z = 3.4
const ICE_SPIT_MS = 1100

function blackIceScene(r: ModelRig, on: boolean, dt: number, dtMs: number) {
  if (!on) {
    if (iceWall || iceRail || iceGlobs.length) clearBlackIce()
    return
  }
  if (!stage) return
  if (!iceRail) {
    iceRail = buildRig('turret-rail', 0x22d3ee, 0.9)
    iceRail.root.position.set(0, 0, ICE_RAIL_Z)
    iceRail.root.rotation.y = Math.PI
    stage.add(iceRail.root)
  }
  iceSpitMs -= dtMs
  if (iceSpitMs <= 0) {
    iceSpitMs = ICE_SPIT_MS
    iceSpits = (iceSpits + 1) % 3
    const atRail = iceSpits === 0
    r.root.updateWorldMatrix(true, true)
    const from = stage.worldToLocal(muzzleOf(r, new THREE.Vector3()))
    const to = atRail
      ? new THREE.Vector3(0, 0.5, ICE_RAIL_Z)
      : new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, ICE_WALL_Z)
    const mesh = makeIceGlob(0.22)
    mesh.position.copy(from)
    stage.add(mesh)
    iceGlobs.push({ mesh, from, to, t: 0, flight: atRail ? 0.9 : 0.7, arc: atRail ? 1.6 : 0.9, atRail })
    puff(puffSphere, 0xa5b4fc, 2.4, stage.localToWorld(from.clone()), 0.18, 0.08, 0.25)
  }
  for (let i = iceGlobs.length - 1; i >= 0; i--) {
    const glob = iceGlobs[i]!
    glob.t = Math.min(1, glob.t + dt / glob.flight)
    glob.mesh.position.lerpVectors(glob.from, glob.to, glob.t)
    glob.mesh.position.y += Math.sin(glob.t * Math.PI) * glob.arc
    glob.mesh.rotation.x += dt * 4
    glob.mesh.rotation.y += dt * 3
    if (glob.t < 1) continue
    const at = stage.localToWorld(glob.mesh.position.clone())
    disposeIceGlob(glob.mesh)
    iceGlobs.splice(i, 1)
    puff(puffSphere, 0xa5b4fc, 2.4, at, 0.3, 0.1, 0.4)
    if (glob.atRail) {
      // The rail is hit: the frame freezes, as the board does.
      lagMs = 600
      continue
    }
    iceWall ??= new IceWall(stage, new THREE.Vector3(0, 0, ICE_WALL_Z), 2, ICE_WALL_HEIGHT)
    // A full wall starts over, so the build keeps playing.
    if (iceWall.fill >= 1) {
      iceWall.dispose()
      iceWall = new IceWall(stage, new THREE.Vector3(0, 0, ICE_WALL_Z), 2, ICE_WALL_HEIGHT)
    }
    iceWall.deposit(0.3)
  }
  iceWall?.update(dt)
}

function clearBlackIce() {
  for (const glob of iceGlobs) disposeIceGlob(glob.mesh)
  iceGlobs.length = 0
  iceWall?.dispose()
  iceWall = null
  if (iceRail) {
    disposeRig(iceRail)
    iceRail.root.removeFromParent()
    iceRail = null
  }
  iceSpitMs = 0
  lagMs = 0
}

// ── ROOTKIT burrowing: it melts into a faux chip floor and climbs back out ──
let burrowFloor: THREE.Group | null = null
let burrowGlow: THREE.MeshBasicMaterial | null = null
/** The loop: stands, melts in, stays under, climbs out, stands again (ms). */
const BURROW_SINK_AT = 700
const BURROW_RISE_AT = 2300
const BURROW_CYCLE_MS = 3400

/** A path-node package like the board's, opaque, flush with the turntable: what ROOTKIT sinks into. */
function buildBurrowFloor() {
  const group = new THREE.Group()
  const geometry = new THREE.BoxGeometry(2.5, 0.8, 2.5)
  const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x050a12 }))
  body.position.y = -0.4
  body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: hdr(CHIP_HEX, 1.4), toneMapped: false })))
  // Where it goes under: the floor glows red round it.
  burrowGlow = new THREE.MeshBasicMaterial({ color: hdr(CHIP_HEX, 2), toneMapped: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40).rotateX(-Math.PI / 2), burrowGlow)
  glow.position.y = 0.004
  group.add(body, glow)
  return group
}

/** The clutch that scatters where ROOTKIT drills under, as on the board: each runs off and fades. */
interface Hatchling {
  rig: ModelRig
  dir: THREE.Vector3
  stride: number
  age: number
}
const hatchlings: Hatchling[] = []
const HATCHLING_LIFE = 1.2
const HATCHLING_SPEED = 1.2

function scatterHatchlings() {
  if (!stage) return
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.random() * 0.6
    const spider = buildRig('spiderling', hackerzEnemy('spiderling').hex, BROOD_HEIGHT)
    const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
    spider.root.position.copy(dir).multiplyScalar(0.2)
    spider.root.rotation.y = a
    stage.add(spider.root)
    hatchlings.push({ rig: spider, dir, stride: 0, age: 0 })
  }
}

function updateHatchlings(dt: number) {
  for (let i = hatchlings.length - 1; i >= 0; i--) {
    const h = hatchlings[i]!
    h.age += dt
    const moved = HATCHLING_SPEED * dt
    h.rig.root.position.addScaledVector(h.dir, moved)
    h.stride += moved / BROOD_HEIGHT * MOTION.strideScale
    poseRig(h.rig, h.stride, dt, 0)
    h.rig.root.scale.setScalar(Math.max(0.01, 1 - Math.max(0, h.age - HATCHLING_LIFE * 0.7) / (HATCHLING_LIFE * 0.3)))
    if (h.age < HATCHLING_LIFE) continue
    disposeRig(h.rig)
    h.rig.root.removeFromParent()
    hatchlings.splice(i, 1)
  }
}

/** How far ROOTKIT's legs are drawn into its drill point this frame. */
let burrowGather = 0

function burrowScene(r: ModelRig, unit: HackerzEnemyDefinition, on: boolean, dt: number, dtMs: number) {
  if (floorMesh) floorMesh.visible = !on
  if (discMesh) discMesh.visible = !on
  burrowGather = 0
  if (!on) {
    if (burrowFloor) burrowFloor.visible = false
    updateHatchlings(dt)
    return
  }
  if (!burrowFloor && stage) {
    burrowFloor = buildBurrowFloor()
    stage.add(burrowFloor)
  }
  if (burrowFloor) burrowFloor.visible = true
  const before = state.boomMs
  state.boomMs = (state.boomMs + dtMs) % BURROW_CYCLE_MS
  const sinking = (state.boomMs - BURROW_SINK_AT) / MOTION.burrowSinkMs
  const rising = (state.boomMs - BURROW_RISE_AT) / MOTION.burrowRiseMs
  // The board's dive: a leap with its legs drawn to a point, then drilling down, spinning.
  const dive = burrowFrame(
    state.boomMs >= BURROW_SINK_AT && state.boomMs < BURROW_RISE_AT ? sinking : null,
    state.boomMs >= BURROW_RISE_AT ? rising : null
  )
  r.root.position.y = dive.lift * r.height * fitScale
  r.root.rotation.y = dive.spin
  // Laid over the walk's pose once that is set (see `animate`).
  burrowGather = dive.gather
  r.root.visible = dive.lift > -1
  // Gone under: its brood scatters from the hole.
  const under = BURROW_SINK_AT + MOTION.burrowSinkMs
  if (before < under && state.boomMs >= under) scatterHatchlings()
  updateHatchlings(dt)
  // The floor boils while it drills in and climbs out.
  const busy = (sinking > 0.3 && sinking < 1) || (rising > 0 && rising < 1)
  if (burrowGlow) burrowGlow.opacity += ((busy ? 0.3 : 0) - burrowGlow.opacity) * Math.min(1, dt * 8)
  if (busy && Math.random() < dt * 25 && stage) {
    const at = stage.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 1.4, 0.05, (Math.random() - 0.5) * 1.4))
    puff(puffSphere, unit.hex, 2.4, at, 0.5, 0.06, 0.01, new THREE.Vector3(0, 1.2 + Math.random(), 0))
  }
}

// ── A Phantom's crystal ribbon, and ZERO DAY's block storm ──
let ribbon: CrystalRibbon | null = null
let storm: BlockStorm | null = null

// ── A carried shield: its hit bubble, and the shatter loop's timing ──
let hexShield: HexShield | null = null
const SHATTER_AT_MS = 900
const SHATTER_CYCLE_MS = 2600

// ── Healing: a patient in front of the healer, mended a tick at a time ──
let patient: ModelRig | null = null
let healLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null
let healAge = 1
const HEAL_HEX = 0x4ade80
/** Where the patient stands, and its size beside the healer. */
const PATIENT_AT = new THREE.Vector3(0, 0, 1.3)
const PATIENT_SCALE = 0.45

function healTick(r: ModelRig, unit: HackerzEnemyDefinition) {
  if (!scene || !stage || !patient) return
  const from = muzzleOf(r, new THREE.Vector3())
  patient.root.updateWorldMatrix(true, false)
  const to = patient.root.localToWorld(new THREE.Vector3(0, patient.box.max.y * 0.55, 0))
  if (!healLine) {
    healLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: hdr(HEAL_HEX, 3), toneMapped: false, transparent: true }))
    scene.add(healLine)
  }
  healLine.geometry.setFromPoints([from, to])
  healAge = 0
  puff(puffSphere, HEAL_HEX, 2.4, to, 0.3, 0.08, 0.3)
  puff(puffSphere, unit.hex, 2, from, 0.15, 0.06, 0.18)
  patient.body.uniforms.uFlash!.value = 0.5
}

function updatePatient(on: boolean, dt: number) {
  if (!on) {
    if (patient) {
      disposeRig(patient)
      patient = null
    }
    if (healLine) healLine.visible = false
    return
  }
  if (!patient && stage) {
    patient = buildRig('grunt', 0x67e8f9, MODEL_HEIGHT)
    patient.root.position.copy(PATIENT_AT)
    patient.root.rotation.y = Math.PI
    patient.root.scale.setScalar(PATIENT_SCALE)
    stage.add(patient.root)
  }
  if (patient) {
    const flash = patient.body.uniforms.uFlash!
    flash.value = Math.max(0, flash.value - dt * 4)
    poseRig(patient, 0, dt, 0)
  }
  if (healLine) {
    healAge += dt
    healLine.material.opacity = Math.max(0, 1 - healAge / 0.18)
    healLine.visible = healAge < 0.18
  }
}

// ── Memory leak: the Daemon's hits pile leaked blocks up at the fence's foot, as on the board ──
let leakStack: LeakStack | null = null
let leakCarry: LeakCarry | null = null
let leakTick = 0
/** Where the pile sits on the turntable: in front of the unit, where the fence would be. */
const LEAK_AT = new THREE.Vector3(0, 0, 1.15)

/** The heaved block is let go at `from` (stage space): it drops onto the pile. */
function spillLeak(unit: HackerzEnemyDefinition, from: THREE.Vector3) {
  if (!stage) return
  leakCarry?.hide()
  // A full heap starts over, so the spill keeps playing.
  if (leakStack?.full) {
    leakStack.dispose()
    leakStack = null
  }
  leakStack ??= new LeakStack(stage, LEAK_AT, unit.hex)
  leakStack.spill(from)
}

/** The pile drains once a second while the unit attacks, and is gone once it stops. */
function updateLeak(on: boolean, dt: number) {
  if (!leakStack) return
  if (!on) return clearLeak()
  leakStack.update(dt)
  leakTick += dt
  if (leakTick < 1) return
  leakTick -= 1
  if (leakStack.count) leakStack.drained()
}

function clearLeak() {
  leakStack?.dispose()
  leakStack = null
  leakCarry?.dispose()
  leakCarry = null
  leakTick = 0
}

/** A turret or the rail: swinging onto a target and firing at its own rate, as on the wall. */
function animateGun(r: ModelRig, name: string, dt: number, dtMs: number) {
  const rail = !!props.spec.railProjectile
  if (!rail) spinTurret(r, dt)
  if (name !== 'Idle') {
    // A target crossing the lane in front of it, to track.
    const target = Math.sin(clock * 0.9) * 0.9
    state.heading = turnToward(state.heading, target, dt * (rail ? MOTION.railTurn : MOTION.turretTurn))
  }
  if (r.yaw) r.yaw.rotation.y = state.heading
  if (name === 'Fire') {
    state.fireTimer -= dtMs
    if (state.fireTimer <= 0) {
      state.fireTimer = props.spec.fireMs ?? 800
      state.kick = rail ? railKickFor(props.spec.railProjectile!) : MOTION.turretKick
      fireRound(r)
    }
  }
  state.kick = rail ? easeRailKick(r, state.kick, dt) : easeTurretKick(r, state.kick, dtMs)
}

// ── Projectiles: the game's own rounds and spits, fired, flown and landed ──
interface Shot {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  gravity: number
  /** Seconds until it lands. */
  life: number
  hex: number
  /** A shell lands heavy: a bigger splash. */
  heavy: boolean
  /** Lobbed shots spin as they fly; rounds keep their nose down the line. */
  spin: boolean
  trailTimer: number
}
const shots: Shot[] = []

/** A short-lived glow: muzzle flash, trail puff, impact flash, debris, shockwave ring. */
interface Puff {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  age: number
  life: number
  /** Scale at birth and at death. */
  from: number
  to: number
  velocity: THREE.Vector3 | null
  gravity: number
}
const puffs: Puff[] = []
const puffSphere = new THREE.SphereGeometry(1, 10, 8)
const puffChunk = new THREE.OctahedronGeometry(1, 0)
const puffRing = new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2)

/** How far out (turntable units) shots land, and how long a round and a lobbed shot take to get there. */
const SHOT_RANGE = 6
const ROUND_FLIGHT = 0.45
const LOB_FLIGHT = 0.9
/** How high a lob climbs above the straight line, for a light shot and a heavy shell. */
const LOB_APEX = 1.6
const LOB_APEX_HEAVY = 2.8
/**
 * Rounds are drawn long so they read across the whole board; on the turntable
 * they are shrunk to fit.
 */
const ROUND_SCALE = 0.32
const SPIT_SCALE = 0.6

function puff(geometry: THREE.BufferGeometry, hex: number, intensity: number, at: THREE.Vector3, life: number, from: number, to: number,
  velocity: THREE.Vector3 | null = null, gravity = 0) {
  if (!scene) return
  const material = new THREE.MeshBasicMaterial({ color: hdr(hex, intensity), toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.copy(at)
  mesh.scale.setScalar(from)
  scene.add(mesh)
  puffs.push({ mesh, age: 0, life, from, to, velocity, gravity })
}

/** Lobs `mesh` from `from` to `to` in a ballistic arc that climbs `apex` above the straight line. */
function lob(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, flight: number, apex: number, hex: number, heavy: boolean) {
  if (!scene) return
  // Gravity and launch speed that peak `apex` above the midpoint and land on time.
  const gravity = 8 * apex / (flight * flight)
  const velocity = to.clone().sub(from).divideScalar(flight)
  velocity.y += 0.5 * gravity * flight
  mesh.position.copy(from)
  scene.add(mesh)
  shots.push({ mesh, velocity, gravity, life: flight, hex, heavy, spin: true, trailTimer: 0 })
}

/** A hostile gun fires: the game's spit, lobbed out to land in front of the turntable. */
function fireSpit(r: ModelRig, unit: HackerzEnemyDefinition) {
  if (!stage) return
  stage.updateMatrixWorld()
  // Twin guns (a Gunship's) take turns down the volley, as on the board.
  const from = muzzleOf(r, new THREE.Vector3(), state.burstLeft)
  const to = stage.localToWorld(new THREE.Vector3(0, 0.05, SHOT_RANGE))
  const heavy = unit.id === 'artillery'
  const mesh = makeSpit(unit.hex, heavy)
  mesh.scale.multiplyScalar(SPIT_SCALE)
  muzzleFlash(from, unit.hex, heavy)
  lob(mesh, from, to, LOB_FLIGHT * (heavy ? 1.35 : 1), heavy ? LOB_APEX_HEAVY : LOB_APEX, unit.hex, heavy)
}

/** A turret or the rail fires: the game's round, out of the barrel to a point down its line. */
function fireRound(r: ModelRig) {
  if (!scene || !props.spec.projectile) return
  const from = muzzleOf(r, new THREE.Vector3())
  const aim = r.barrel ?? r.yaw ?? r.root
  const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(aim.getWorldQuaternion(new THREE.Quaternion()))
  const to = from.clone().addScaledVector(direction, SHOT_RANGE)
  to.y = 0.05
  const mesh = makeProjectile(props.spec.projectile, props.spec.hex, false, !props.spec.railProjectile)
  mesh.scale.multiplyScalar(ROUND_SCALE)
  muzzleFlash(from, props.spec.hex, props.spec.projectile === 'slug')
  if (props.spec.projectile === 'missile') {
    // A warhead lofts, like the board's missiles curving onto their mark.
    lob(mesh, from, to, LOB_FLIGHT, LOB_APEX * 0.6, props.spec.hex, true)
    shots[shots.length - 1]!.spin = false
    return
  }
  const velocity = to.clone().sub(from).divideScalar(ROUND_FLIGHT)
  mesh.position.copy(from)
  mesh.lookAt(to)
  scene.add(mesh)
  shots.push({ mesh, velocity, gravity: 0, life: ROUND_FLIGHT, hex: props.spec.hex, heavy: props.spec.projectile === 'slug', spin: false, trailTimer: 0 })
}

function muzzleFlash(at: THREE.Vector3, hex: number, heavy: boolean) {
  puff(puffSphere, 0xffffff, 3, at, 0.12, heavy ? 0.28 : 0.18, heavy ? 0.5 : 0.3)
  puff(puffSphere, hex, 3, at, 0.18, heavy ? 0.35 : 0.22, heavy ? 0.7 : 0.4)
}

/** Where a shot lands: a flash, a shockwave ring across the floor and a spray of glowing debris. */
function impact(at: THREE.Vector3, hex: number, heavy: boolean) {
  const size = heavy ? 1.6 : 1
  puff(puffSphere, 0xffffff, 3, at, 0.12, 0.12 * size, 0.4 * size)
  puff(puffSphere, hex, 2, at, 0.2, 0.15 * size, 0.5 * size)
  puff(puffRing, hex, 2.6, at.clone().setY(0.03), 0.55, 0.2, heavy ? 2.2 : 1.5)
  for (let i = 0; i < (heavy ? 14 : 8); i++) {
    const a = Math.random() * Math.PI * 2
    const speed = (1.5 + Math.random() * 2.5) * size
    const velocity = new THREE.Vector3(Math.cos(a) * speed, (2 + Math.random() * 3) * size, Math.sin(a) * speed)
    puff(puffChunk, hex, 2.4, at, 0.55, 0.06 * size, 0.02, velocity, 9)
  }
}

function updateShots(dt: number) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const shot = shots[i]!
    shot.life -= dt
    shot.velocity.y -= shot.gravity * dt
    shot.mesh.position.addScaledVector(shot.velocity, dt)
    if (shot.spin) shot.mesh.rotation.y += dt * 8
    else if (shot.gravity) shot.mesh.lookAt(shot.mesh.position.clone().add(shot.velocity))
    // A fading glow trail behind it.
    shot.trailTimer -= dt
    if (shot.trailTimer <= 0) {
      shot.trailTimer = 0.025
      puff(puffSphere, shot.hex, 2, shot.mesh.position, 0.3, shot.heavy ? 0.12 : 0.08, 0.01)
    }
    if (shot.life > 0) continue
    impact(shot.mesh.position, shot.hex, shot.heavy)
    shot.mesh.removeFromParent()
    shots.splice(i, 1)
  }
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i]!
    p.age += dt
    const t = Math.min(1, p.age / p.life)
    p.mesh.scale.setScalar(p.from + (p.to - p.from) * t)
    p.mesh.material.opacity = 1 - t
    if (p.velocity) {
      p.velocity.y -= p.gravity * dt
      p.mesh.position.addScaledVector(p.velocity, dt)
    }
    if (t < 1) continue
    p.mesh.material.dispose()
    p.mesh.removeFromParent()
    puffs.splice(i, 1)
  }
}

function clearShots() {
  for (const shot of shots) shot.mesh.removeFromParent()
  shots.length = 0
  for (const p of puffs) {
    p.mesh.material.dispose()
    p.mesh.removeFromParent()
  }
  puffs.length = 0
}

// ── Camera: pulled back while something is shooting, so the whole shot is in view ──
const CAMERA_NEAR = { position: new THREE.Vector3(0, 1.9, 6.4), look: new THREE.Vector3(0, 0.85, 0) }
/** Framed on the line of fire: the shooter at the left, where its shots land at the right. */
const CAMERA_FAR = { position: new THREE.Vector3(SHOT_RANGE * 0.42, 5.5, 16), look: new THREE.Vector3(SHOT_RANGE * 0.42, 1, 0) }
/** Framed on a blast: centred on the unit, back far enough to keep its spikes in view. */
const CAMERA_BLAST = { position: new THREE.Vector3(0, 4, 11), look: new THREE.Vector3(0, 0.6, 0) }
/** The turntable angle that points a model's front (+z) along +x. */
const SHOOT_SPIN = Math.PI / 2
let cameraPull = 0
const _cameraLook = new THREE.Vector3()

/** True while the state on is a shooter firing. */
function shooting() {
  const name = animationName.value
  if (props.spec.kind === 'turret') return name === 'Fire'
  const id = def.value?.id ?? ''
  return name === 'Attack' && (def.value?.kind === 'ranged' || CRYSTAL_RIBBON_IDS.includes(id) || BLOCK_STORM_IDS.includes(id))
}

function updateCamera(dt: number) {
  if (!camera) return
  // A Sapper's blast throws spikes well past the close-up too, all round it.
  // So does ROOTKIT's brood running for the fence.
  const blast = (animationName.value === 'Attack' && (def.value?.kind === 'bomber' || def.value?.id === 'titan' || def.value?.id === 'leviathan'))
    || animationName.value === 'Self-destruct'
  const far = blast ? CAMERA_BLAST : CAMERA_FAR
  cameraPull += ((shooting() || blast ? 1 : 0) - cameraPull) * Math.min(1, dt * 2.5)
  const t = cameraPull * cameraPull * (3 - 2 * cameraPull)
  camera.position.lerpVectors(CAMERA_NEAR.position, far.position, t)
  camera.lookAt(_cameraLook.lerpVectors(CAMERA_NEAR.look, far.look, t))
}

// ── Hacking: the same holo-terminal the board shows, and its pulses ──
let terminals: HackTerminals | null = null
const TERMINAL_OWNER = {}
/** Beside the hacker, above its shoulder — in stage space, so it turns with the scene. */
const TERMINAL_LOCAL = new THREE.Vector3(0.7, 1.75, 0.75)
const CHIP_TOP_LOCAL = new THREE.Vector3(0, 0.22, -0.75)
const terminalAt = new THREE.Vector3()
const chipTop = new THREE.Vector3()
let pulse: THREE.Mesh | null = null
let pulseT = 1
let pulseWait = 0
/** The hack's progress round the node, looping. */
let hackProgress = 0

function hackScene(on: boolean, dt: number) {
  if (!scene || !camera || !stage) return
  if (chip) chip.visible = on
  if (!on) {
    terminals?.close(TERMINAL_OWNER)
    if (pulse) pulse.visible = false
    return
  }
  hackProgress = (hackProgress + dt / 5) % 1
  chipRing?.geometry.setDrawRange(0, Math.max(2, Math.round(hackProgress * (RING_STEPS + 1))))
  // A node under attack breathes faster the closer it is to falling.
  if (chipEmblem) chipEmblem.color.copy(hdr(CHIP_HEX, 1.4 + 0.5 * Math.sin(clock * (2 + hackProgress * 4))))
  stage.updateMatrixWorld()
  stage.localToWorld(terminalAt.copy(TERMINAL_LOCAL))
  stage.localToWorld(chipTop.copy(CHIP_TOP_LOCAL))
  if (!terminals) {
    terminals = new HackTerminals()
    scene.add(terminals.group)
    pulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshBasicMaterial({ color: hdr(0xff3b3b, 3), toneMapped: false })
    )
    scene.add(pulse)
  }
  const panel = terminals.open(TERMINAL_OWNER)
  panel.position.copy(terminalAt)
  // The board's panels are sized for the board; scaled down for the turntable.
  panel.children.forEach(child => child.scale.setScalar(0.4))
  terminals.update(dt, camera)
  // A pulse at the game's cadence and flight time, arcing from the terminal into the node.
  if (pulseT >= 1) {
    pulseWait -= dt * 1000
    if (pulseWait <= 0) {
      pulseT = 0
      pulseWait = MOTION.hackPulseMs
    }
  } else {
    pulseT = Math.min(1, pulseT + dt / MOTION.hackPulseFlight)
  }
  if (pulse) {
    pulse.visible = pulseT < 1
    pulse.position.lerpVectors(terminalAt, chipTop, pulseT)
    // The board's arc, at turntable scale.
    pulse.position.y += Math.sin(pulseT * Math.PI) * MOTION.hackPulseArc * 0.4
  }
}

// ── Drag to spin, click to cycle ──
let dragging = false
let moved = 0
let lastX = 0
let lastT = 0

function onDown(event: PointerEvent) {
  dragging = true
  moved = 0
  lastX = event.clientX
  lastT = performance.now()
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onMove(event: PointerEvent) {
  if (!dragging) return
  const dx = event.clientX - lastX
  const now = performance.now()
  lastX = event.clientX
  moved += Math.abs(dx)
  spin += dx * 0.012
  spinVelocity = dx * 0.012 / Math.max(0.008, (now - lastT) / 1000)
  lastT = now
  if (moved > 4) autoSpin = false
}

function onUp() {
  if (!dragging) return
  dragging = false
  // A press that barely moved is a click: next state.
  if (moved <= 4) animation.value = (animation.value + 1) % animations.value.length
}

watch(() => [props.spec.id, props.spec.hex, props.spec.enemy] as const, () => {
  animation.value = 0
  autoSpin = true
  hackScene(false, 0)
  clearShots()
  clearLeak()
  shrapnel?.clear()
  updatePatient(false, 0)
  ribbon?.dispose()
  ribbon = null
  storm?.dispose()
  storm = null
  clearBrood()
  clearBlackIce()
  build()
})

onMounted(mount)
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  resize?.disconnect()
  if (rig) disposeRig(rig)
  composer?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
})
</script>

<template>
  <div class="hz-viewer">
    <div
      ref="host"
      class="h-72 w-full cursor-grab touch-none select-none active:cursor-grabbing"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    />
    <div class="flex items-center justify-between gap-2 border-t border-cyan-400/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest">
      <span class="text-cyan-300/80">▶ {{ animationName }}</span>
      <span class="text-white/30">drag · click</span>
    </div>
  </div>
</template>
