/*
 * The run: simulation, rendering sync, juice and the GameApi the content
 * side drives. One instance per run.
 */
import { BitmapText, Container, defaultFilterVert, Filter, GlProgram, Graphics, ParticleContainer, Rectangle, Sprite, Texture, TilingSprite, UniformGroup } from 'pixi.js'
import type { Application } from 'pixi.js'
import { randomChance, randomFloat, randomInt, randomPick } from '#shared/utils/random'
import { RIFTBORN_BOSS_TIMES, riftbornBaseEffects, riftbornClass, riftbornRunXp, riftbornSanitiseReport } from '#shared/utils/gamelogic/riftborn'
import type { RiftbornClassDef, RiftbornMetaEffects } from '#shared/utils/gamelogic/riftborn'
import { ABILITY_DEFS, ABILITY_KEYS, ABILITY_MAX_LEVEL, ABILITY_SLOT_LEVELS, abilityStats, addAbilityMods, COUNT_CHARGES, emptyAbilityMods } from './abilities'
import { ELITE_AFFIXES } from './affixes'
import { AtlasBaker } from './atlas'
import { bakeEngineArt, GEM_TIERS, makeVignetteCanvas } from './art'
import { makeBiomeFloor, makeBiomePatch, nextBiome, startBiome } from './biomes'
import type { BiomeDef } from './biomes'
import { CRIT, HIT, KILL } from './core'
import type { AbilityCtx, AbilityInst, Ally, AllyKind, AllyOpts, EnemyRt, EnemyView, HitOpts, PassiveInst, PlayerRt, PlayerStats, Projectile, ProjOpts, WeaponInst, Zone, ZoneOpts } from './core'
import { FloorDecor } from './decor'
import { createDirector } from './director'
import { ENEMY_DEFS } from './enemies'
import { Fx, TAG_FONT } from './fx'
import { GlowFilter } from './glow'
import { HERO_FEET, HeroRig } from './hero'
import { SpatialHash } from './spatial'
import type { Input } from './input'
import { easeOutBack, Overlay } from './overlay'
import { castUltimate } from './ultimates'
import { computeStats, PASSIVE_DEFS, RARITY_BONUS, RARITY_MUL, rollOptions, shardCacheAmount } from './upgrades'
import type { UpgradeOption, UpgradeState } from './upgrades'
import { addMods, emptyMods, isIntegerOnly, WEAPON_DEFS, WEAPON_MAX_LEVEL, weaponStats } from './weapons'
import type { DamageShare, Director, EliteAffix, EnemyDef, EnemyShot, EngineEvents, GameApi, HudAbility, HudItem, ParticleBurst, RunBiome, RunHud, RunResult, Sfx, SfxName, SfxOptions, TelegraphCircle, TelegraphLine } from './types'

const TAU = Math.PI * 2
const MAX_ENEMIES = 800
const MAX_PROJECTILES = 1100
const MAX_SHOTS = 700
const MAX_GEMS = 420
const COMBO_WINDOW = 2.6
const DASH_SPEED = 920
const DASH_TIME = 0.16

const STREAKS: [number, string, number][] = [
    [25, 'KILLING SPREE', 0x9fe0ff],
    [50, 'RAMPAGE!', 0xffd54f],
    [100, 'UNSTOPPABLE!', 0xff9a3a],
    [200, 'GODLIKE!', 0xff4f6a],
    [350, 'RIFTBORN!', 0xff3fa4],
    [500, 'BEYOND GODLIKE!', 0xc06bff],
    [750, 'LEGENDARY!', 0xffffff]
]

/** Pentatonic steps for the gem pickup arpeggio */
const ARP = [1, 1.122, 1.26, 1.498, 1.682, 2, 2.245, 2.52, 2.997, 3.364]

/** Hit spark style per weapon */
type Impact = 'slash' | 'pierce' | 'fire' | 'shock' | 'void' | 'frost' | 'holy' | 'poison' | 'blunt'
const WEAPON_IMPACT: Record<string, Impact> = {
    cleaver: 'slash',
    longbow: 'pierce',
    daggers: 'pierce',
    fireball: 'fire',
    meteor: 'fire',
    chainLightning: 'shock',
    stormTotem: 'shock',
    ricochet: 'shock',
    soulSkulls: 'void',
    voidOrbs: 'void',
    mines: 'fire',
    laser: 'holy',
    holyAura: 'holy',
    aegis: 'holy',
    frostNova: 'frost',
    boomerang: 'slash',
    plague: 'poison'
}

interface Chrono {
    x: number
    y: number
    r: number
    t: number
    slow: number
    shotSlow: number
    vuln: number
}

interface Buff {
    t: number
    move: number
    fire: number
    crit: number
}

const CTX_METHODS = ['aimDir', 'mouseWorld', 'nearest', 'randomEnemy', 'query', 'hit', 'explode', 'projectile', 'zone', 'ally', 'schedule', 'play', 'shake', 'flash', 'hitStop', 'heal', 'makeSprite', 'freeSprite', 'pull', 'clearShots', 'aimPoint', 'chrono', 'shield', 'haste', 'teleport', 'grantIframes'] as const

const CHROMA_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uStrength;
void main(void) {
    vec2 off = vec2(uStrength * uInputSize.z, uStrength * 0.4 * uInputSize.w);
    vec4 c = texture(uTexture, vTextureCoord);
    float r = texture(uTexture, vTextureCoord + off).r;
    float b = texture(uTexture, vTextureCoord - off).b;
    finalColor = vec4(r, c.g, b, c.a);
}`

function shade(color: number, f: number): number {
    const r = Math.min(255, Math.round(((color >> 16) & 255) * f))
    const g = Math.min(255, Math.round(((color >> 8) & 255) * f))
    const b = Math.min(255, Math.round((color & 255) * f))
    return (r << 16) | (g << 8) | b
}

function makeChroma(): Filter | null {
    try {
        const glProgram = GlProgram.from({ vertex: defaultFilterVert, fragment: CHROMA_FRAG, name: 'riftborn-chroma' })
        return new Filter({ glProgram, resolution: 'inherit', resources: { chromaUniforms: new UniformGroup({ uStrength: { value: 0, type: 'f32' } }) } })
    } catch {
        return null
    }
}

type PickupKind = 'gem' | 'shard' | 'food' | 'magnet' | 'bomb' | 'chest'

/** Boss kill → loot sweep → portal → white-out swap → arrival in the next biome */
interface Travel {
    phase: 'sweep' | 'portal' | 'warp' | 'arrive'
    t: number
    x: number
    y: number
    next: BiomeDef
}

interface Pickup {
    kind: PickupKind
    x: number
    y: number
    vx: number
    vy: number
    value: number
    tier: number
    sprite: Sprite
    shadow: Sprite | null
    attract: boolean
    speed: number
    age: number
    boss: boolean
    alive: boolean
    fxT: number
}

interface ShotRt extends EnemyShot {
    sprite: Sprite
    glow: Sprite
    age: number
    alive: boolean
}

interface Tele {
    line: boolean
    x: number
    y: number
    r: number
    x2: number
    y2: number
    w: number
    delay: number
    t: number
    damage: number
    color: number
}

class SpritePool {
    private readonly free: Sprite[] = []
    constructor(private readonly layer: Container) {}
    get(tex: Texture): Sprite {
        let s = this.free.pop()
        if (!s) {
            s = new Sprite(tex)
            s.anchor.set(0.5)
            this.layer.addChild(s)
        }
        s.texture = tex
        s.visible = true
        s.alpha = 1
        s.tint = 0xffffff
        s.rotation = 0
        s.scale.set(1)
        return s
    }

    release(s: Sprite): void {
        s.visible = false
        this.free.push(s)
    }
}

interface Layers {
    scene: Container
    floor: TilingSprite
    patches: TilingSprite
    world: Container
    /** Screen-space container carrying the bloom filter */
    glowRoot: Container
    /** World-transformed child of glowRoot: the additive FX */
    glowWorld: Container
    /** World-transformed layer above the bloom: damage numbers, top sprites */
    worldTop: Container
    decor: Container
    decorAdd: Container
    fog: Container
    decal: Container
    decalAdd: Container
    shadows: Container
    pickups: Container
    glow: Container
    actors: Container
    proj: Container
    projAdd: Container
    shotGlow: Container
    shots: Container
    partNorm: ParticleContainer
    fxNorm: Container
    partAdd: ParticleContainer
    fxAdd: Container
    lines: Graphics
    tele: Graphics
    text: Container
    top: Container
    motes: Container
}

export interface GameOptions {
    classId: RiftbornClassDef['id']
    meta: RiftbornMetaEffects
    sfx: Sfx
    events: EngineEvents
    input: Input
}

export class Game implements AbilityCtx {
    // ─── Setup ───
    readonly atlas: AtlasBaker
    readonly fx: Fx
    readonly sfx: Sfx
    readonly cls: RiftbornClassDef
    private readonly meta: RiftbornMetaEffects
    private readonly events: EngineEvents
    private readonly input: Input
    private readonly L: Layers
    private readonly overlay: Overlay
    private readonly canvasTextures: Texture[] = []

    // ─── Biomes ───
    private biome: BiomeDef = startBiome()
    private biomeIndex = 0
    private readonly visited: string[] = []
    private travel: Travel | null = null
    private floorTex!: Texture
    private patchTex!: Texture
    private vigTex!: Texture
    private ambientT = 1
    private portal!: { glow: Sprite, ring: Sprite, ring2: Sprite, core: Sprite }
    // Hurt feedback: hp bar under the hero and arcs toward the damage source
    private hpBar!: Graphics
    private hpBarT = 0
    private hpGhost = 1
    private hpGhostT = 0
    private readonly hurtDirs: { a: number, t: number, k: number }[] = []
    private readonly chroma: Filter | null
    private readonly glowFilter: GlowFilter | null
    private readonly glowArea = new Rectangle(0, 0, 1, 1)
    private readonly director: Director
    readonly api: GameApi

    // ─── Run state ───
    time = 0
    private real = 0
    readonly player: PlayerRt
    stats: PlayerStats
    level = 1
    private xp = 0
    private xpNext = 5
    private kills = 0
    private eliteKills = 0
    private bossKills = 0
    private damageDealt = 0
    private shards = 0
    private combo = 0
    private comboT = 0
    private highestCombo = 0
    private streakIdx = 0
    private knightKills = 0
    private lifestealPool = 0
    private ultCharge = 0
    private ultUses = 0
    private ultReadyFired = false
    private rerolls: number
    private revivals: number

    readonly weapons: WeaponInst[] = []
    readonly passives: PassiveInst[] = []
    readonly abilities: AbilityInst[] = []
    /** Ability slots open (1 at start, 2 at level 8, 3 at level 18) */
    private slots = 1
    private readonly chronos: Chrono[] = []
    private shieldHp = 0
    private shieldMax = 0
    private shieldT = 0
    private shieldAbsorbed = 0
    private shieldEnd: ((broken: boolean, absorbed: number) => void) | null = null
    private readonly buffs: Buff[] = []
    private buffMove = 1
    private buffFire = 1
    private buffCrit = 0
    private playerSlowT = 0
    private playerSlowAmt = 0
    /** Damage dealt per source key ('w:<id>', 'a:<id>', 'ultimate', 'other') */
    private readonly dmgBy = new Map<string, number>()
    private ultCtx: AbilityCtx | null = null
    readonly enemies: EnemyRt[] = []
    private readonly dying: EnemyRt[] = []
    private readonly grid: SpatialHash<EnemyRt>
    private readonly projectiles: Projectile[] = []
    private readonly shots: ShotRt[] = []
    private readonly teles: Tele[] = []
    private readonly zones: Zone[] = []
    private readonly allies: Ally[] = []
    private readonly pickups: Pickup[] = []
    private gemCount = 0
    private timers: { t: number, fn: () => void }[] = []
    private uid = 0

    // ─── Flow ───
    private menu: null | 'levelup' | 'chest' = null
    paused = false
    private over = false
    private ending: { t: number, victory: boolean } | null = null
    private victoryLocked = false
    private pendingLevels = 0
    private levelFxT = 0
    private choices: UpgradeOption[] = []

    // ─── Juice ───
    private trauma = 0
    private hitStopT = 0
    private hitStopCd = 0
    private timeScale = 1
    private slowT = 0
    private slowScale = 1
    private chromaAmt = 0
    private zoomMul = 1
    private bossCine: { e: EnemyRt, t: number } | null = null
    private gemStreak = 0
    private lastGemT = -1
    private magnetT = 0
    private readonly lastPlay = new Map<string, number>()
    private hudT = 0
    private stepErrLogged = false
    private frameAvg = 16

    // ─── View ───
    private readonly cam = { x: 0, y: 0, zoom: 1 }
    readonly view = { width: 1280, height: 720 }
    private readonly rig: HeroRig
    private readonly decor: FloorDecor
    private readonly heroShield: Sprite
    private readonly heroShieldRing: Sprite
    private readonly heroLight: Sprite
    private readonly fogs: { s: Sprite, x: number, y: number, vx: number, vy: number, sc: number, a: number }[] = []
    private readonly tagPool: BitmapText[] = []
    private levelGlowT = 0
    private readonly heroShadow: Sprite
    private readonly heroUlt: Sprite
    private readonly heroUltRing: Sprite
    private readonly heroBerserk: Sprite
    private deathBooms = 0
    private magnetPulseT = 20
    private readonly enemyTex = new Map<string, { frames: Texture[], whites: Texture[] }>()
    private readonly freeViews: EnemyView[] = []
    private readonly glowPool: SpritePool
    private readonly projPool: SpritePool
    private readonly projAddPool: SpritePool
    private readonly pickupPool: SpritePool
    private readonly shadowPool: SpritePool
    private readonly shotPool: SpritePool
    private readonly shotGlowPool: SpritePool
    private readonly decalPool: SpritePool
    private readonly decalAddPool: SpritePool
    private readonly topPool: SpritePool
    private readonly actorPool: SpritePool
    private readonly motes: { s: Sprite, x: number, y: number, d: number, ph: number }[] = []
    private lastCamX = 0
    private lastCamY = 0
    private emptyHit: HitOpts = {}

    constructor(private readonly app: Application, opts: GameOptions) {
        this.cls = riftbornClass(opts.classId) ?? riftbornClass('knight')!
        // Defaults first so a partial meta object can't produce NaNs
        this.meta = { ...riftbornBaseEffects(), ...opts.meta }
        this.sfx = opts.sfx
        this.events = opts.events
        this.input = opts.input
        this.rerolls = Math.max(0, Math.floor(this.meta.rerolls))
        this.revivals = Math.max(0, Math.floor(this.meta.revivals))

        // Atlas: engine art first (particles land on the first page), then enemies
        const res = Math.max(1, Math.min(2, app.renderer.resolution))
        this.atlas = new AtlasBaker(res)
        bakeEngineArt(this.atlas)
        for (const def of Object.values(ENEMY_DEFS)) this.queueEnemyBake(def)
        this.atlas.build(app.renderer)
        for (const def of Object.values(ENEMY_DEFS)) this.collectEnemyTex(def)

        this.grid = new SpatialHash<EnemyRt>(80)

        // Layers
        this.visited.push(this.biome.id)
        const floorTex = Texture.from(makeBiomeFloor(this.biome, 512))
        const patchTex = Texture.from(makeBiomePatch(this.biome, 256))
        const vigTex = Texture.from(makeVignetteCanvas(this.biome.vignette, 0.42, 0.95))
        this.floorTex = floorTex
        this.patchTex = patchTex
        this.vigTex = vigTex
        const redTex = Texture.from(makeVignetteCanvas('255,20,40', 0.7, 0.95))
        const edgeTex = Texture.from(makeVignetteCanvas('255,255,255', 0.4, 0.9))
        floorTex.source.addressMode = 'repeat'
        patchTex.source.addressMode = 'repeat'
        this.canvasTextures.push(floorTex, patchTex, vigTex, redTex, edgeTex)

        const particleTex = this.atlas.get('p.dot')
        const scene = new Container()
        const world = new Container()
        const mk = (blend?: 'add') => {
            const c = new Container()
            if (blend) c.blendMode = blend
            return c
        }
        const partNorm = new ParticleContainer({ texture: particleTex, dynamicProperties: { position: true, rotation: true, color: true, vertex: true, uvs: true } })
        const partAdd = new ParticleContainer({ texture: particleTex, dynamicProperties: { position: true, rotation: true, color: true, vertex: true, uvs: true } })
        partAdd.blendMode = 'add'
        const big = new Rectangle(-1e7, -1e7, 2e7, 2e7)
        partNorm.boundsArea = big
        partAdd.boundsArea = big
        const L: Layers = {
            scene,
            floor: new TilingSprite({ texture: floorTex, width: 100, height: 100 }),
            patches: new TilingSprite({ texture: patchTex, width: 100, height: 100 }),
            world,
            glowRoot: new Container(),
            glowWorld: new Container(),
            worldTop: new Container(),
            decor: mk(),
            decorAdd: mk('add'),
            fog: mk(),
            decal: mk(),
            decalAdd: mk('add'),
            shadows: mk(),
            pickups: mk(),
            glow: mk('add'),
            actors: mk(),
            proj: mk(),
            projAdd: mk('add'),
            shotGlow: mk('add'),
            shots: mk(),
            partNorm,
            fxNorm: mk(),
            partAdd,
            fxAdd: mk('add'),
            lines: new Graphics(),
            tele: new Graphics(),
            text: mk(),
            top: mk(),
            motes: mk('add')
        }
        L.lines.blendMode = 'add'
        L.actors.sortableChildren = true
        L.patches.alpha = 0.9
        L.decal.addChild(L.tele)
        world.addChild(L.decor, L.decorAdd, L.decal, L.decalAdd, L.shadows, L.pickups, L.glow, L.actors, L.proj, L.shotGlow, L.shots, L.partNorm, L.fxNorm)
        L.glowWorld.addChild(L.projAdd, L.partAdd, L.fxAdd, L.lines)
        L.glowRoot.addChild(L.glowWorld)
        L.worldTop.addChild(L.top, L.text)
        scene.addChild(L.floor, L.patches, world, L.glowRoot, L.worldTop, L.fog, L.motes)
        this.L = L
        this.overlay = new Overlay(vigTex, redTex, edgeTex)
        app.stage.addChild(scene, this.overlay.root)
        // The aberration shader is GLSL only; skip it on any other backend
        this.chroma = app.renderer.name === 'webgl' ? makeChroma() : null
        let glow: GlowFilter | null = null
        if (app.renderer.name === 'webgl') {
            try {
                glow = new GlowFilter(0.8, 8)
            } catch {
                glow = null
            }
        }
        this.glowFilter = glow
        if (glow) L.glowRoot.filters = [glow]

        this.fx = new Fx(this.atlas, partAdd, partNorm, L.fxAdd, L.fxNorm, L.text, L.lines, L.decal, L.decalAdd)
        this.decor = new FloorDecor(this.atlas, L.decor, L.decorAdd)
        this.decor.setBiome(this.biome, 7)
        app.renderer.background.color = this.biome.bg
        const ps = (tex: string) => {
            const sp = new Sprite(this.atlas.get(tex))
            sp.anchor.set(0.5)
            sp.visible = false
            L.decalAdd.addChild(sp)
            return sp
        }
        this.portal = { glow: ps('glow'), ring: ps('runeRing'), ring2: ps('runeRing'), core: ps('blackHole') }
        this.hpBar = new Graphics()
        L.worldTop.addChild(this.hpBar)
        this.glowPool = new SpritePool(L.glow)
        this.projPool = new SpritePool(L.proj)
        this.projAddPool = new SpritePool(L.projAdd)
        this.pickupPool = new SpritePool(L.pickups)
        this.shadowPool = new SpritePool(L.shadows)
        this.shotPool = new SpritePool(L.shots)
        this.shotGlowPool = new SpritePool(L.shotGlow)
        this.decalPool = new SpritePool(L.decal)
        this.decalAddPool = new SpritePool(L.decalAdd)
        this.topPool = new SpritePool(L.top)
        this.actorPool = new SpritePool(L.actors)

        // Motes: parallax dust in screen space
        for (let i = 0; i < 70; i++) {
            const s = new Sprite(this.atlas.get('p.dot'))
            s.anchor.set(0.5)
            L.motes.addChild(s)
            this.motes.push({ s, x: Math.random() * 2000, y: Math.random() * 1200, d: 0.15 + Math.random() * 0.55, ph: Math.random() * TAU })
        }
        // Fog: a few huge, slow smoke puffs in screen space
        for (let i = 0; i < 7; i++) {
            const s = new Sprite(this.atlas.get('p.smoke'))
            s.anchor.set(0.5)
            s.tint = this.biome.fog[i % 2]!
            L.fog.addChild(s)
            this.fogs.push({ s, x: Math.random() * 2000, y: Math.random() * 1200, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 8, sc: 14 + Math.random() * 12, a: 0.16 + Math.random() * 0.12 })
        }

        // Player
        this.stats = computeStats(this.cls, this.meta, this.passives)
        this.player = {
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            radius: 14,
            hp: this.stats.maxHp,
            facing: 1,
            dashT: 0,
            dashCd: 0,
            dashCdMax: 2,
            dashX: 1,
            dashY: 0,
            iframes: 1.5,
            hurtT: 0,
            alive: true,
            moving: false,
            animT: 0
        }
        this.heroShadow = this.shadowPool.get(this.atlas.get('shadow'))
        this.heroLight = this.glowPool.get(this.atlas.get('glow'))
        this.heroLight.tint = this.cls.color
        this.heroUlt = this.glowPool.get(this.atlas.get('glow'))
        this.heroUlt.visible = false
        this.heroUltRing = this.decalAddPool.get(this.atlas.get('runeRing'))
        this.heroUltRing.visible = false
        this.rig = new HeroRig(this.atlas, this.cls.id, this.cls.color)
        L.actors.addChild(this.rig.root)
        this.heroShield = new Sprite(this.atlas.get('disc'))
        this.heroShield.anchor.set(0.5)
        this.heroShieldRing = new Sprite(this.atlas.get('runeRing'))
        this.heroShieldRing.anchor.set(0.5)
        this.heroShield.visible = false
        this.heroShieldRing.visible = false
        L.projAdd.addChild(this.heroShield, this.heroShieldRing)

        const free = Math.max(0, Math.min(30, Math.floor(this.meta.startLevel)))
        this.level += free
        this.pendingLevels = free
        this.xpNext = this.xpFor(this.level)

        this.heroBerserk = this.glowPool.get(this.atlas.get('glow'))
        this.heroBerserk.visible = false

        this.director = createDirector()
        this.api = this.makeApi()
        this.addWeapon(this.cls.startingWeapon, 1)
        this.fx.ring(0, 0, this.cls.color, 10, 160, 0.8, 1)
        this.fx.burst(0, 0, { count: 40, color: this.cls.color, tex: 'p.star', speed: 400, life: 0.8, size: 8 })
        this.applyMotes()
        this.schedule(0.5, () => this.overlay.stageBanner(this.biome.name, this.biome.color, ''))
    }

    // ─── Baking ──────────────────────────────────────────────────────────

    private queueEnemyBake(def: EnemyDef): void {
        const frames = Math.max(1, Math.floor(def.frames || 1))
        const size = Math.max(8, def.size || def.radius * 2.4)
        for (let f = 0; f < frames; f++) {
            this.atlas.add(`e.${def.id}.${f}`, size, size, g => def.draw(g, f, false))
            this.atlas.add(`e.${def.id}.${f}.w`, size, size, g => def.draw(g, f, true))
        }
    }

    private collectEnemyTex(def: EnemyDef): void {
        const frames: Texture[] = []
        const whites: Texture[] = []
        const n = Math.max(1, Math.floor(def.frames || 1))
        for (let f = 0; f < n; f++) {
            frames.push(this.atlas.get(`e.${def.id}.${f}`))
            whites.push(this.atlas.get(`e.${def.id}.${f}.w`))
        }
        this.enemyTex.set(def.id, { frames, whites })
    }

    // ─── GameApi ─────────────────────────────────────────────────────────

    private makeApi(): GameApi {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const g = this
        return {
            get time() {
                return g.time
            },
            player: g.player,
            get enemies() {
                return g.enemies
            },
            get view() {
                return g.view
            },
            sfx: g.sfx,
            spawn: (id, x, y, o) => g.spawn(id, x, y, o),
            get enemyCount() {
                return g.enemies.length
            },
            enemyShot: s => g.enemyShot(s),
            telegraphCircle: t => g.telegraphCircle(t),
            telegraphLine: t => g.telegraphLine(t),
            particles: (x: number, y: number, b: ParticleBurst) => g.fx.burst(x, y, { ...b, tex: 'p.dot' }),
            shake: p => g.shake(p),
            flash: (c, a) => g.flash(c, a),
            announce: (text, color) => g.overlay.announce(text, color ?? 0xffffff, 58),
            chase: (e, dt, m) => g.chase(e as EnemyRt, dt, m),
            get damageDealt() {
                return g.damageDealt
            },
            get biome() {
                return { id: g.biome.id, index: g.biomeIndex, favor: g.biome.favor }
            },
            get calm() {
                return !!g.travel
            },
            slowPlayer: (t, a) => {
                if (!(t > 0) || !(a > 0)) return
                if (g.playerSlowT <= 0 || a >= g.playerSlowAmt) g.playerSlowAmt = Math.min(0.8, a)
                g.playerSlowT = Math.max(g.playerSlowT, t)
            }
        }
    }

    spawn(defId: string, x: number, y: number, o?: { elite?: boolean, hpMul?: number, minion?: boolean }): EnemyRt | null {
        const def = ENEMY_DEFS[defId]
        if (!def || this.over) return null
        if (this.enemies.length >= MAX_ENEMIES && !def.boss) return null
        let tex = this.enemyTex.get(def.id)
        if (!tex) {
            // A def that wasn't around at bake time: draw it as a plain glowing blob
            tex = { frames: [this.atlas.get('p.dot')], whites: [this.atlas.get('p.dot')] }
            this.enemyTex.set(def.id, tex)
        }
        const elite = !!o?.elite && !def.boss
        const hp = Math.max(1, def.hp * (o?.hpMul ?? 1) * (elite ? 2 : 1))
        const sizeMul = elite ? 1.35 : 1
        const e: EnemyRt = {
            uid: ++this.uid,
            def,
            x,
            y,
            vx: 0,
            vy: 0,
            radius: def.radius * sizeMul,
            hp,
            maxHp: hp,
            damage: def.damage * (elite ? 1.5 : 1),
            speed: def.speed * (elite ? 0.92 : 1),
            elite,
            boss: !!def.boss,
            minion: !!o?.minion,
            dead: false,
            age: 0,
            facing: x > this.player.x ? -1 : 1,
            scale: 1,
            alpha: 1,
            untargetable: false,
            ai: {},
            slowT: 0,
            burnT: 0,
            stunT: 0,
            flashT: 0,
            mass: (def.mass ?? 1) * (elite ? 3 : 1),
            kx: 0,
            ky: 0,
            burnDps: 0,
            burnTick: 0.5,
            burnShown: 0,
            freezeT: 0,
            slowAmt: 0,
            frames: tex.frames,
            whites: tex.whites,
            view: this.makeView(def, elite),
            deathT: 0,
            spawnT: 0,
            fxT: 0,
            lastHit: -1,
            sizeMul,
            killedBy: null,
            burnSrc: 'other',
            affixes: []
        }
        this.enemies.push(e)
        try {
            def.init?.(e, this.api)
        } catch {
            // Content bugs must never kill the run
        }
        if (elite) {
            this.rollAffixes(e)
            if (def.id === 'champion') {
                const extra = e.affixes.map(id => this.affix(id)?.name).filter(Boolean).join(' · ')
                this.setTag(e, extra ? `${def.name} · ${extra}` : def.name, 0xffb03a, 0.72)
            }
            this.play('spawnElite', { volume: 0.6, pan: this.pan(x) }, 0.4)
            this.fx.ring(x, y, 0xffd54f, 10, 90, 0.5, 0.9)
        }
        if (def.boss) this.onBossSpawn(e)
        return e
    }

    private affix(id: string): EliteAffix | undefined {
        return ELITE_AFFIXES[id]
    }

    private rollAffixes(e: EnemyRt): void {
        const ids = Object.keys(ELITE_AFFIXES)
        if (!ids.length) return
        const n = this.time >= 720 ? 3 : this.time >= 420 ? 2 : this.time >= 120 ? 1 : 0
        const pool = [...ids]
        for (let i = 0; i < n && pool.length; i++) {
            const id = randomPick(pool)
            pool.splice(pool.indexOf(id), 1)
            e.affixes.push(id)
        }
        if (!e.affixes.length) return
        const names: string[] = []
        for (const id of e.affixes) {
            const a = this.affix(id)
            if (!a) continue
            names.push(a.name)
            try {
                a.apply?.(e, this.api)
            } catch {
                // content errors never stop the run
            }
            const ring = this.decalAddPool.get(this.atlas.get('ringSoft'))
            ring.tint = a.color
            e.view.auras.push(ring)
        }
        if (!names.length) return
        this.setTag(e, names.join(' · '), this.affix(e.affixes[0]!)?.color ?? 0xffd54f, 0.5)
    }

    private setTag(e: EnemyRt, text: string, color: number, scale: number): void {
        let tag = e.view.tag ?? this.tagPool.pop()
        if (!tag) {
            tag = new BitmapText({ text: '', style: { fontFamily: TAG_FONT, fontSize: 24 } })
            tag.anchor.set(0.5, 1)
            this.L.text.addChild(tag)
        }
        tag.visible = true
        tag.text = text
        tag.tint = color
        tag.scale.set(scale)
        e.view.tag = tag
    }

    private makeView(def: EnemyDef, elite: boolean): EnemyView {
        let v = this.freeViews.pop()
        if (!v) {
            const root = new Container()
            const outline = new Sprite(Texture.EMPTY)
            outline.anchor.set(0.5)
            const body = new Sprite(Texture.EMPTY)
            body.anchor.set(0.5)
            root.addChild(outline, body)
            this.L.actors.addChild(root)
            const shadow = new Sprite(this.atlas.get('shadow'))
            shadow.anchor.set(0.5)
            this.L.shadows.addChild(shadow)
            v = { root, body, outline, shadow, glow: null, auras: [], tag: null }
        }
        v.root.visible = true
        v.root.alpha = 1
        v.root.rotation = 0
        v.shadow.visible = true
        v.outline.visible = elite || !!def.boss
        v.outline.tint = def.boss ? 0xff3a3a : 0xffd54f
        v.body.tint = 0xffffff
        if (def.glow !== undefined || elite || def.boss) {
            v.glow = this.glowPool.get(this.atlas.get('glow'))
            v.glow.tint = elite ? 0xffc93a : def.glow ?? 0xff3a3a
        }
        return v
    }

    private releaseView(e: EnemyRt): void {
        const v = e.view
        v.root.visible = false
        v.shadow.visible = false
        if (v.glow) {
            this.glowPool.release(v.glow)
            v.glow = null
        }
        for (const a of v.auras) this.decalAddPool.release(a)
        v.auras.length = 0
        if (v.tag) {
            v.tag.visible = false
            this.tagPool.push(v.tag)
            v.tag = null
        }
        this.freeViews.push(v)
    }

    chase(e: EnemyRt, _dt: number, speedMul = 1): void {
        const p = this.player
        const dx = p.x - e.x
        const dy = p.y - e.y
        const d = Math.hypot(dx, dy) || 1
        const slow = e.slowT > 0 ? 1 - e.slowAmt : 1
        const sp = e.speed * speedMul * slow
        e.vx = (dx / d) * sp
        e.vy = (dy / d) * sp
        if (Math.abs(dx) > 4) e.facing = dx > 0 ? 1 : -1
    }

    enemyShot(s: EnemyShot): void {
        if (this.shots.length >= MAX_SHOTS || this.ending) return
        const kind = s.kind ?? 'orb'
        const sprite = this.shotPool.get(this.atlas.get(`shot.${kind}`))
        sprite.tint = s.color
        const glow = this.shotGlowPool.get(this.atlas.get('glow'))
        glow.tint = s.color
        glow.alpha = 0.55
        glow.scale.set((s.radius * 5) / 128)
        this.shots.push({ ...s, sprite, glow, age: 0, alive: true })
        this.play('enemyShot', { volume: 0.35, pan: this.pan(s.x) }, 0.09)
    }

    private telegraphCircle(t: TelegraphCircle): void {
        this.teles.push({ line: false, x: t.x, y: t.y, r: t.radius, x2: 0, y2: 0, w: 0, delay: Math.max(0.05, t.delay), t: 0, damage: t.damage, color: t.color })
        this.play('telegraph', { volume: 0.4, pan: this.pan(t.x) }, 0.15)
    }

    private telegraphLine(t: TelegraphLine): void {
        this.teles.push({ line: true, x: t.x1, y: t.y1, r: 0, x2: t.x2, y2: t.y2, w: t.width, delay: Math.max(0.05, t.delay), t: 0, damage: t.damage, color: t.color })
        this.play('telegraph', { volume: 0.4, pan: this.pan(t.x1) }, 0.15)
    }

    // ─── Ctx helpers ─────────────────────────────────────────────────────

    play(name: SfxName, opts?: SfxOptions, minGap = 0): void {
        if (minGap > 0) {
            const last = this.lastPlay.get(name) ?? -1e9
            if (this.real - last < minGap) return
            this.lastPlay.set(name, this.real)
        }
        try {
            this.sfx.play(name, opts)
        } catch {
            // Audio is best effort
        }
    }

    private pan(x: number): number {
        return Math.max(-1, Math.min(1, (x - this.player.x) / Math.max(200, this.view.width / 2))) * 0.8
    }

    shake(power: number): void {
        this.trauma = Math.min(1, this.trauma + power)
    }

    flash(color: number, alpha: number): void {
        this.overlay.flash(color, alpha)
    }

    hitStop(seconds: number): void {
        if (this.hitStopCd > 0) return
        this.hitStopT = Math.max(this.hitStopT, Math.min(0.12, seconds))
        this.hitStopCd = 0.22
    }

    private slowMo(scale: number, seconds: number): void {
        this.slowScale = this.slowT > 0 ? Math.min(this.slowScale, scale) : scale
        this.slowT = Math.max(this.slowT, seconds)
    }

    heal(amount: number, show = false): void {
        const p = this.player
        if (!p.alive || amount <= 0) return
        const before = p.hp
        p.hp = Math.min(this.stats.maxHp, p.hp + amount)
        const gained = p.hp - before
        if (show && gained >= 1) {
            this.fx.number(p.x, p.y - 34, gained, 'heal')
            this.play('heal', { volume: 0.6 }, 0.2)
            this.fx.burst(p.x, p.y, { count: 10, color: 0x5dff8a, tex: 'p.star', speed: 120, life: 0.6, size: 6, gravity: -120 })
        }
    }

    mouseWorld(): { x: number, y: number } | null {
        if (!this.input.mouseActive(performance.now() / 1000)) return null
        const w = this.L.world
        return { x: (this.input.mouseX - w.x) / this.cam.zoom, y: (this.input.mouseY - w.y) / this.cam.zoom }
    }

    aimDir(): { x: number, y: number } {
        const p = this.player
        const m = this.mouseWorld()
        if (m) {
            const dx = m.x - p.x
            const dy = m.y - p.y
            const d = Math.hypot(dx, dy)
            if (d > 6) return { x: dx / d, y: dy / d }
        }
        const e = this.nearest(p.x, p.y, 650)
        if (e) {
            const dx = e.x - p.x
            const dy = e.y - p.y
            const d = Math.hypot(dx, dy) || 1
            return { x: dx / d, y: dy / d }
        }
        const d = Math.hypot(p.dashX, p.dashY) || 1
        return { x: p.dashX / d, y: p.dashY / d }
    }

    aimPoint(range: number): { x: number, y: number } {
        const p = this.player
        const m = this.mouseWorld()
        if (m) {
            const dx = m.x - p.x
            const dy = m.y - p.y
            const d = Math.hypot(dx, dy)
            if (d <= range) return m
            return { x: p.x + (dx / d) * range, y: p.y + (dy / d) * range }
        }
        // Densest pack in range
        let best: EnemyRt | null = null
        let bestScore = -1
        const r2 = range * range
        const list = this.enemies
        const step = Math.max(1, Math.floor(list.length / 40))
        for (let i = 0; i < list.length; i += step) {
            const e = list[i]!
            if (e.dead || e.untargetable || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > r2) continue
            let score = e.boss ? 25 : e.elite ? 6 : 0
            this.grid.query(e.x, e.y, 110, () => {
                score++
            })
            if (score > bestScore) {
                bestScore = score
                best = e
            }
        }
        if (best) return { x: best.x, y: best.y }
        const d = Math.hypot(p.dashX, p.dashY) || 1
        return { x: p.x + (p.dashX / d) * range * 0.5, y: p.y + (p.dashY / d) * range * 0.5 }
    }

    chrono(x: number, y: number, r: number, life: number, slow: number, shotSlow: number, vuln = 0): void {
        this.chronos.push({ x, y, r, t: life, slow, shotSlow, vuln })
    }

    shield(hp: number, life: number, onEnd: (broken: boolean, absorbed: number) => void): void {
        // A fresh shield replaces the old one; the old one pops as expired
        this.endShield(false)
        this.shieldHp = hp
        this.shieldMax = hp
        this.shieldT = life
        this.shieldAbsorbed = 0
        this.shieldEnd = onEnd
    }

    private endShield(broken: boolean): void {
        const end = this.shieldEnd
        this.shieldEnd = null
        this.shieldHp = 0
        this.shieldT = 0
        if (end) {
            try {
                end(broken, this.shieldAbsorbed)
            } catch {
                // ignore
            }
        }
    }

    haste(t: number, move: number, fire: number, crit: number): void {
        this.buffs.push({ t, move, fire, crit })
    }

    teleport(x: number, y: number): void {
        const p = this.player
        p.x = x
        p.y = y
        p.dashT = 0
    }

    grantIframes(t: number): void {
        this.player.iframes = Math.max(this.player.iframes, t)
    }

    clearShots(x: number, y: number, r: number): number {
        let n = 0
        for (const s of this.shots) {
            if (!s.alive || s.life <= 0) continue
            const rr = r + s.radius
            if ((s.x - x) ** 2 + (s.y - y) ** 2 > rr * rr) continue
            s.life = 0
            n++
        }
        return n
    }

    /** A Ctx whose hits, explosions, projectiles, zones and allies carry a damage source */
    private sourced(src: string): AbilityCtx {
        const o = Object.create(this) as Record<string, unknown>
        for (const k of CTX_METHODS) {
            const fn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[k]!
            o[k] = fn.bind(this)
        }
        o.hit = (e: EnemyRt, d: number, h?: HitOpts) => this.hit(e, d, { ...(h ?? {}), src: h?.src ?? src })
        o.explode = (x: number, y: number, r: number, d: number, h?: Parameters<Game['explode']>[4]) => this.explode(x, y, r, d, { ...(h ?? {}), src: h?.src ?? src })
        o.projectile = (po: ProjOpts) => this.projectile({ ...po, hit: { ...(po.hit ?? {}), src: po.hit?.src ?? src } })
        o.zone = (zo: ZoneOpts) => this.zone({ ...zo, hit: { ...(zo.hit ?? {}), src: zo.hit?.src ?? src } })
        o.ally = (kind: AllyKind, x: number, y: number, life: number, ao?: AllyOpts) => this.ally(kind, x, y, life, { ...(ao ?? {}), src: ao?.src ?? src })
        return o as unknown as AbilityCtx
    }

    nearest(x: number, y: number, maxR: number, skip?: (e: EnemyRt) => boolean): EnemyRt | null {
        let best: EnemyRt | null = null
        let bd = maxR * maxR
        // The grid is cheaper for short searches, a scan is fine for long ones
        if (maxR <= 240) {
            this.grid.query(x, y, maxR, e => {
                if (e.dead || e.untargetable || (skip && skip(e))) return
                const d = (e.x - x) ** 2 + (e.y - y) ** 2
                if (d < bd) {
                    bd = d
                    best = e
                }
            })
            return best
        }
        for (const e of this.enemies) {
            if (e.dead || e.untargetable) continue
            const d = (e.x - x) ** 2 + (e.y - y) ** 2
            if (d < bd && !(skip && skip(e))) {
                bd = d
                best = e
            }
        }
        return best
    }

    randomEnemy(x: number, y: number, maxR: number): EnemyRt | null {
        const n = this.enemies.length
        if (!n) return null
        const r2 = maxR * maxR
        for (let tries = 0; tries < 12; tries++) {
            const e = this.enemies[Math.floor(randomFloat() * n)]!
            if (!e.dead && !e.untargetable && (e.x - x) ** 2 + (e.y - y) ** 2 < r2) return e
        }
        return this.nearest(x, y, maxR)
    }

    query(x: number, y: number, r: number, fn: (e: EnemyRt) => unknown): void {
        this.grid.query(x, y, r, e => {
            if (e.untargetable) return
            const rr = r + e.radius
            if ((e.x - x) ** 2 + (e.y - y) ** 2 > rr * rr) return
            return fn(e)
        })
    }

    pull(x: number, y: number, radius: number, strength: number, dt: number, bosses = false): void {
        this.grid.query(x, y, radius, e => {
            if (e.untargetable || ((e.boss || e.elite) && !bosses)) return
            const dx = x - e.x
            const dy = y - e.y
            const d = Math.hypot(dx, dy)
            if (d > radius || d < 4) return
            const f = (strength * dt * (1 - d / radius * 0.5)) / Math.sqrt(e.mass)
            e.x += (dx / d) * Math.min(f, d)
            e.y += (dy / d) * Math.min(f, d)
        })
    }

    makeSprite(tex: string, layer: 'decal' | 'decalAdd' | 'glow' | 'top'): Sprite {
        const pool = layer === 'decal' ? this.decalPool : layer === 'decalAdd' ? this.decalAddPool : layer === 'glow' ? this.glowPool : this.topPool
        const s = pool.get(this.atlas.get(tex))
        ;(s as Sprite & { _rbPool?: SpritePool })._rbPool = pool
        return s
    }

    freeSprite(s: Sprite): void {
        const pool = (s as Sprite & { _rbPool?: SpritePool })._rbPool
        if (pool) pool.release(s)
        else s.visible = false
    }

    schedule(delay: number, fn: () => void): void {
        this.timers.push({ t: this.time + Math.max(0, delay), fn })
    }

    // ─── Damage ──────────────────────────────────────────────────────────

    hit(e: EnemyRt, damage: number, o: HitOpts = this.emptyHit): number {
        if (e.dead || e.untargetable || !(damage > 0)) return 0
        let res = HIT
        let amount = damage
        const s = this.stats
        if (!o.noCrit && randomChance(s.crit + (o.critBonus ?? 0) + this.buffCrit)) {
            amount *= s.critMul
            res |= CRIT
        }
        if (this.meta.berserk) amount *= this.berserkMul()
        if (e.affixes.length) {
            for (const id of e.affixes) {
                const a = this.affix(id)
                if (!a?.damageTaken) continue
                try {
                    const m = a.damageTaken(e, this.api, amount)
                    if (m >= 0) amount *= m
                } catch {
                    // ignore content errors
                }
            }
        }
        if (this.chronos.length) {
            for (const c of this.chronos) {
                if (c.vuln > 0 && (e.x - c.x) ** 2 + (e.y - c.y) ** 2 < c.r * c.r) {
                    amount *= 1 + c.vuln
                    break
                }
            }
        }
        if (!(amount > 0)) return 0
        if (o.shatter && e.freezeT > 0) {
            amount *= 3
            e.freezeT = 0
            this.fx.burst(e.x, e.y, { count: 12, color: 0xdff6ff, tex: 'p.shard', speed: 320, life: 0.5, size: 8 })
            this.play('frost', { volume: 0.4, pitch: 1.6 }, 0.08)
        }
        const before = e.hp
        e.hp -= amount
        const dealt = Math.min(Math.max(0, before), amount)
        this.damageDealt += dealt
        if (o.weapon) o.weapon.dealt += dealt
        const key = o.src ?? (o.weapon ? 'w:' + o.weapon.def.id : 'other')
        this.dmgBy.set(key, (this.dmgBy.get(key) ?? 0) + dealt)
        e.flashT = 0.08
        e.lastHit = this.time
        const exec = this.meta.executeThreshold
        if (exec > 0 && e.hp > 0 && !e.boss && e.hp < e.maxHp * exec) {
            e.hp = 0
            this.fx.sprite('skull', e.x, e.y - e.radius - 8, { life: 0.7, size0: 20, size1: 44, a0: 1, a1: 0, vy: -70 })
            this.fx.burst(e.x, e.y, { count: 8, color: 0xc77dff, tex: 'p.smoke', speed: 140, life: 0.45, size: 10 })
            this.play('crit', { volume: 0.35, pitch: 0.55 }, 0.08)
        }

        if (o.knock) {
            let kx = o.kx
            let ky = o.ky
            if (kx === undefined || ky === undefined) {
                const sx = o.sx ?? this.player.x
                const sy = o.sy ?? this.player.y
                const dx = e.x - sx
                const dy = e.y - sy
                const d = Math.hypot(dx, dy) || 1
                kx = dx / d
                ky = dy / d
            }
            const k = (o.knock / e.mass) * (e.boss ? 0.2 : 1)
            e.kx += kx * k
            e.ky += ky * k
            const km = Math.hypot(e.kx, e.ky)
            if (km > 1100) {
                e.kx *= 1100 / km
                e.ky *= 1100 / km
            }
        }
        if (o.burn && o.burn > 0) {
            e.burnDps = e.burnT > 0 ? Math.max(e.burnDps, o.burn) : o.burn
            e.burnT = Math.max(e.burnT, o.burnT ?? 3)
            e.burnSrc = key
        }
        if (o.slow) {
            e.slowAmt = Math.max(e.slowAmt, Math.min(0.85, o.slow))
            e.slowT = Math.max(e.slowT, o.slowT ?? 1)
        }
        const resist = e.boss ? 0.15 : e.elite ? 0.5 : 1
        if (o.freeze) e.freezeT = Math.max(e.freezeT, o.freeze * resist)
        if (o.stun) e.stunT = Math.max(e.stunT, o.stun * resist)
        if (s.lifesteal > 0) this.lifestealPool += dealt * s.lifesteal

        if (!o.noNumber) {
            const kind = o.numKind ?? ((res & CRIT) ? 'crit' : 'normal')
            this.fx.number(e.x, e.y - e.radius - 6, amount, kind)
        }
        if (!o.silent) this.play('hit', { pitch: 0.85 + Math.random() * 0.35, volume: 0.3, pan: this.pan(e.x) }, 0.035)
        if (res & CRIT) {
            this.play('crit', { volume: 0.45, pitch: 0.95 + Math.random() * 0.2, pan: this.pan(e.x) }, 0.07)
            this.chromaAmt = Math.min(1, this.chromaAmt + 0.25)
            if (amount > 120 || e.boss || e.elite) this.hitStop(0.03)
            this.fx.burst(e.x, e.y, { count: 4, color: 0xfff6c0, tex: 'p.spark', speed: 480, life: 0.22, size: 7 })
            if (!o.noNumber && this.fx.quality > 0.5) this.fx.impact(e.x, e.y, 34 + e.radius * 1.6, 0xfff2c0)
            if (!o.noNumber) this.impactFx(e, o)
            if (this.cls.id === 'stormcaller' && !o.chained && randomChance(0.3)) {
                const n = this.nearest(e.x, e.y, 170, x => x === e)
                if (n) {
                    this.fx.lightning(e.x, e.y, n.x, n.y, 0x63c7ff, 2.5, 0.16)
                    this.hit(n, damage * 0.5, { chained: true, noCrit: true, silent: true, weapon: o.weapon, src: o.src, color: 0x9fe6ff })
                }
            }
        } else if (this.fx.quality > 0.6 && !o.noNumber) {
            this.impactFx(e, o)
        }
        if (e.hp <= 0) {
            const overkill = -e.hp
            this.kill(e)
            res |= KILL
            try {
                o.onKill?.(e)
            } catch {
                // content error
            }
            if ((res & CRIT) && this.meta.overkill && !o.chained && overkill > 1) this.overkillSplash(e, overkill)
        }
        return res
    }

    private impactFx(e: EnemyRt, o: HitOpts): void {
        const fx = this.fx
        const style: Impact = o.weapon ? WEAPON_IMPACT[o.weapon.def.id] ?? 'blunt' : 'blunt'
        const col = o.color ?? 0xffffff
        const ang = o.kx !== undefined && o.ky !== undefined ? Math.atan2(o.ky, o.kx) : Math.atan2(e.y - (o.sy ?? this.player.y), e.x - (o.sx ?? this.player.x))
        switch (style) {
            case 'slash':
                fx.sprite('slash', e.x, e.y, { life: 0.12, color: col, size0: e.radius * 1.6, size1: e.radius * 2.8, rot: ang + Math.PI / 2 + (Math.random() - 0.5) * 0.6, a0: 0.85 })
                fx.burst(e.x, e.y, { count: 3, color: 0xfff0c0, tex: 'p.spark', speed: 420, life: 0.2, size: 6, angle: ang, spread: 0.9 })
                break
            case 'pierce':
                fx.burst(e.x, e.y, { count: 3, color: col, tex: 'p.spark', speed: 460, life: 0.18, size: 5, angle: ang, spread: 0.6 })
                break
            case 'fire':
                fx.burst(e.x, e.y, { count: 3, color: 0xff8a30, tex: 'p.flame', speed: 160, life: 0.35, size: 9, gravity: -120 })
                break
            case 'shock':
                fx.burst(e.x, e.y, { count: 4, color: 0x9fe6ff, tex: 'p.spark', speed: 380, life: 0.16, size: 5 })
                break
            case 'void':
                fx.sprite('ringSoft', e.x, e.y, { life: 0.2, color: 0xff7ac8, size0: e.radius, size1: e.radius * 3, a0: 0.8 })
                break
            case 'frost':
                fx.burst(e.x, e.y, { count: 3, color: 0xdff6ff, tex: 'p.shard', speed: 240, life: 0.3, size: 6 })
                break
            case 'holy':
                fx.burst(e.x, e.y, { count: 2, color: 0xffe27a, tex: 'p.star', speed: 200, life: 0.3, size: 7 })
                break
            case 'poison':
                break
            default:
                fx.burst(e.x, e.y, { count: 2, color: col, tex: 'p.spark', speed: 280, life: 0.16, size: 5 })
        }
    }

    private berserkMul(): number {
        const p = this.player
        return 1 + 0.6 * Math.max(0, Math.min(1, 1 - p.hp / this.stats.maxHp))
    }

    private overkillSplash(e: EnemyRt, amount: number): void {
        const r = 95 + e.radius
        const dmg = amount * 0.7
        this.query(e.x, e.y, r, o => {
            if (o === e) return
            this.hit(o, dmg, { chained: true, noCrit: true, silent: true, knock: 220, sx: e.x, sy: e.y, color: 0xff6a3a })
        })
        this.fx.ring(e.x, e.y, 0xff5a2a, 10, r, 0.28, 1)
        this.fx.sprite('glow', e.x, e.y, { life: 0.25, color: 0xff4a1a, size0: r * 0.6, size1: r * 1.8, a0: 0.8 })
        this.fx.burst(e.x, e.y, { count: 14, color: 0xffa060, tex: 'p.spark', speed: r * 6, life: 0.3, size: 7 })
        this.play('explosion', { volume: 0.4, pitch: 1.4, pan: this.pan(e.x) }, 0.06)
    }

    explode(x: number, y: number, r: number, damage: number, o: HitOpts & { color?: number, sfx?: boolean, shake?: number, visual?: 'fire' | 'void' | 'holy' | 'frost' | 'plain' | 'none' } = {}): void {
        const opts: HitOpts = { ...o, sx: o.sx ?? x, sy: o.sy ?? y, silent: true }
        this.query(x, y, r, e => {
            this.hit(e, damage, opts)
        })
        const vis = o.visual ?? 'plain'
        const fx = this.fx
        if (vis === 'fire') {
            fx.sprite('glow', x, y, { life: 0.32, color: 0xff6a18, size0: r * 1.2, size1: r * 2.6, a0: 0.75 })
            fx.sprite('glow', x, y, { life: 0.16, color: 0xffd890, size0: r * 0.5, size1: r * 1.2, a0: 0.75 })
            fx.impact(x, y, r * 1.3, 0xffc070)
            fx.ring(x, y, 0xffa040, r * 0.3, r * 1.05, 0.3, 0.9)
            fx.burst(x, y, { count: Math.min(26, 6 + r / 5), color: 0xff7a20, tex: 'p.flame', speed: r * 4, life: 0.45, size: 12, drag: 5 })
            fx.burst(x, y, { count: 6, color: 0xffe0a0, tex: 'p.spark', speed: r * 6, life: 0.3, size: 7 })
            fx.burst(x, y, { count: 4, color: 0x2a1a20, tex: 'p.smoke', speed: r * 1.2, life: 0.9, size: 18, normal: true, alpha: 0.5, grow: 2.2, drag: 2 })
        } else if (vis === 'void') {
            const c = o.color ?? 0xff3fa4
            fx.sprite('glow', x, y, { life: 0.3, color: c, size0: r * 1.4, size1: r * 2.4, a0: 0.9 })
            fx.ring(x, y, 0xffd0ec, r * 0.2, r * 1.05, 0.28, 0.9)
            fx.burst(x, y, { count: Math.min(22, 6 + r / 6), color: c, tex: 'p.spark', speed: r * 5, life: 0.35, size: 7 })
        } else if (vis === 'holy') {
            fx.sprite('glow', x, y, { life: 0.3, color: 0xffd54f, size0: r, size1: r * 2.4, a0: 0.9 })
            fx.ring(x, y, 0xfff2b0, r * 0.3, r, 0.3, 0.9)
            fx.burst(x, y, { count: 12, color: 0xffe27a, tex: 'p.star', speed: r * 4, life: 0.5, size: 8 })
        } else if (vis === 'frost') {
            fx.ring(x, y, 0x9fe0ff, r * 0.3, r, 0.3, 0.9)
            fx.burst(x, y, { count: 14, color: 0xdff6ff, tex: 'p.shard', speed: r * 4, life: 0.4, size: 7 })
        } else if (vis === 'plain') {
            const c = o.color ?? 0xffffff
            fx.sprite('glow', x, y, { life: 0.22, color: c, size0: r * 0.8, size1: r * 2, a0: 0.8 })
            fx.ring(x, y, c, r * 0.3, r, 0.22, 0.8)
            fx.burst(x, y, { count: 6, color: c, tex: 'p.spark', speed: r * 5, life: 0.25, size: 6 })
        }
        if (r >= 50 && (vis === 'fire' || vis === 'void')) fx.scorch(x, y, r * 0.75, 0x000000, vis === 'fire' ? 5 : 4, vis === 'fire' ? 'burn' : 'void')
        if (o.sfx) this.play('explosion', { volume: Math.min(1, 0.35 + r / 220), pitch: 0.85 + Math.random() * 0.3, pan: this.pan(x) }, 0.06)
        if (o.shake) this.shake(o.shake)
    }

    private kill(e: EnemyRt): void {
        if (e.dead) return
        e.dead = true
        e.deathT = 0
        e.hp = 0
        try {
            e.def.onDeath?.(e, this.api)
        } catch {
            // ignore content errors
        }
        for (const id of e.affixes) {
            try {
                this.affix(id)?.onDeath?.(e, this.api)
            } catch {
                // ignore content errors
            }
        }
        const color = e.def.glow ?? 0xd8c8ff
        const big = e.elite || e.boss
        const crowd = this.enemies.length > 350
        this.fx.burst(e.x, e.y, { count: big ? 34 : crowd ? 4 : 7, color, tex: 'p.dot', speed: big ? 420 : 260, life: big ? 0.7 : 0.4, size: big ? 9 : 6 })
        this.fx.burst(e.x, e.y, { count: big ? 12 : 3, color: 0xffffff, tex: 'p.spark', speed: 420, life: 0.25, size: 6 })
        // Debris chunks that tumble out under gravity
        if (!crowd || big) this.fx.burst(e.x, e.y - 4, { count: big ? 16 : 3, color: shade(color, 0.55), tex: 'p.shard', speed: big ? 420 : 240, life: big ? 0.8 : 0.5, size: big ? 9 : 6, normal: true, gravity: 700, drag: 1.5 })
        if (this.fx.quality > 0.7 && !crowd) this.fx.ring(e.x, e.y, color, e.radius * 0.5, e.radius * 2.2, 0.25, 0.6)
        if (this.fx.quality > 0.55 && (big || randomFloat() < (crowd ? 0.15 : 0.45))) this.fx.scorch(e.x, e.y + e.radius * 0.4, e.radius * (big ? 1.6 : 1.1), shade(color, 0.35), big ? 8 : 4, 'splat')
        if (big) {
            this.fx.impact(e.x, e.y, e.radius * 5, 0xffffff)
            this.fx.burst(e.x, e.y, { count: 8, color: 0x302838, tex: 'p.smoke', speed: 140, life: 1, size: 26, normal: true, alpha: 0.45, grow: 2.2 })
        }

        if (!e.minion) {
            this.kills++
            this.dropXp(e)
            this.rollDrops(e)
        }
        if (e.elite) {
            this.eliteKills++
            this.dropPickup('chest', e.x, e.y, 0, false)
            this.play('killBig', { volume: 0.8, pan: this.pan(e.x) }, 0.08)
            this.shake(0.25)
            this.hitStop(0.05)
            this.fx.ring(e.x, e.y, 0xffd54f, 10, 140, 0.45, 1)
        }
        if (e.boss) this.onBossDeath(e)

        // Combo
        this.combo = this.comboT > 0 ? this.combo + 1 : 1
        this.comboT = COMBO_WINDOW
        if (this.combo > this.highestCombo) this.highestCombo = this.combo
        this.play('kill', { pitch: 1 + Math.min(this.combo, 90) * 0.011, volume: 0.42, pan: this.pan(e.x) }, 0.03)
        if (this.combo % 10 === 0) this.play('comboUp', { pitch: 1 + Math.min(this.combo, 300) / 300, volume: 0.45 })
        this.checkStreak()

        // Ultimate charge
        const need = Math.min(260, 95 + this.ultUses * 25)
        this.ultCharge = Math.min(1, this.ultCharge + ((e.boss ? 40 : e.elite ? 10 : 1) * this.meta.ultChargeMul) / need)

        if (this.meta.killHeal > 0) this.heal(this.meta.killHeal)
        const boomChance = this.meta.deathExplosionChance
        if (boomChance > 0 && this.deathBooms < 24 && !this.ending && randomChance(boomChance)) {
            this.deathBooms++
            const x = e.x
            const y = e.y
            const r = Math.max(65, e.radius * 2.6)
            const dmg = (12 + this.level * 2.5) * this.stats.might + e.maxHp * 0.15
            this.fx.sprite('glow', x, y, { life: 0.12, color: 0xffa040, size0: r * 0.4, size1: r, a0: 0.7 })
            // A short fuse so chain reactions ripple outward instead of resolving in one frame
            this.schedule(0.07 + randomFloat() * 0.08, () => {
                this.deathBooms--
                this.explode(x, y, r, dmg, { visual: 'fire', knock: 240, sx: x, sy: y, sfx: true, shake: 0.05, noCrit: true })
            })
        }
        if (this.ultCharge >= 1 && !this.ultReadyFired) {
            this.ultReadyFired = true
            this.play('ultimateReady', { volume: 0.8 })
            this.fx.ring(this.player.x, this.player.y, this.cls.color, 10, 120, 0.5, 1)
        }

        // Class traits
        if (this.cls.id === 'knight') {
            this.knightKills++
            if (this.knightKills % 25 === 0) this.heal(1, true)
        } else if (this.cls.id === 'pyromancer' && e.burnT > 0) {
            const dps = e.burnDps * 0.8
            this.query(e.x, e.y, 90, o => {
                if (o.burnT <= 0) {
                    o.burnDps = dps
                    o.burnT = 2.5
                } else o.burnDps = Math.max(o.burnDps, dps)
            })
            this.fx.burst(e.x, e.y, { count: 8, color: 0xff7a20, tex: 'p.flame', speed: 200, life: 0.4, size: 10 })
        } else if (this.cls.id === 'necromancer' && !e.minion && randomChance(e.elite ? 1 : 0.06)) {
            let skeletons = 0
            for (const a of this.allies) if (a.kind === 'skeleton') skeletons++
            if (skeletons < 12) {
                this.ally('skeleton', e.x, e.y, 14)
                this.fx.burst(e.x, e.y, { count: 10, color: 0xb06bff, tex: 'p.smoke', speed: 120, life: 0.5, size: 10 })
                this.play('summon', { volume: 0.3, pitch: 1.2 }, 0.2)
            }
        }
    }

    private checkStreak(): void {
        let label: [number, string, number] | null = null
        const next = STREAKS[this.streakIdx]
        if (next && this.combo >= next[0]) {
            label = next
            this.streakIdx++
        } else if (!next && this.combo >= 1000 && this.combo % 500 === 0) {
            label = [this.combo, `${this.combo} COMBO!`, 0xffffff]
        }
        if (!label) return
        this.overlay.announce(label[1], label[2], 62)
        this.play('streak', { volume: 0.9, pitch: 1 + this.streakIdx * 0.05 })
        this.shake(0.15)
        this.chromaAmt = Math.min(1, this.chromaAmt + 0.5)
    }

    // ─── Bosses ──────────────────────────────────────────────────────────

    private onBossSpawn(e: EnemyRt): void {
        this.bossCine = { e, t: 0 }
        this.overlay.bossBanner(e.def.name, !!e.def.final)
        this.play('bossWarning', { volume: 1 })
        this.schedule(0.7, () => {
            this.play('bossRoar', { volume: 1 })
            this.shake(0.6)
        })
        this.slowMo(0.45, 1.1)
        this.flash(e.def.final ? 0xff3fa4 : 0xff2020, 0.25)
    }

    private onBossDeath(e: EnemyRt): void {
        this.bossKills++
        this.play('bossDeath', { volume: 1 })
        this.shake(1)
        this.flash(0xffffff, 0.6)
        this.slowMo(0.25, 1.3)
        this.hitStopCd = 0
        this.hitStop(0.1)
        this.chromaAmt = 1
        const x = e.x
        const y = e.y
        const r = e.radius
        for (let i = 0; i < 9; i++) {
            this.schedule(i * 0.11, () => {
                const a = randomFloat() * TAU
                const d = randomFloat() * r * 1.4
                const ex = x + Math.cos(a) * d
                const ey = y + Math.sin(a) * d
                this.fx.sprite('glow', ex, ey, { life: 0.35, color: e.def.glow ?? 0xff6a2a, size0: r, size1: r * 2.5, a0: 1 })
                this.fx.ring(ex, ey, 0xffffff, 10, r * 1.2, 0.35, 1)
                this.fx.burst(ex, ey, { count: 20, color: e.def.glow ?? 0xffa040, tex: 'p.spark', speed: 600, life: 0.5, size: 8 })
                this.play('explosion', { volume: 0.7, pitch: 0.7 + randomFloat() * 0.4 })
                this.shake(0.3)
            })
        }
        this.fx.ring(x, y, 0xffd54f, r, r * 6, 0.9, 1)
        this.dropPickup('chest', x, y, 0, true)
        const finalBoss = !!e.def.final
        if (finalBoss) {
            // Lock the win now: nothing can kill the player during the death spectacle
            this.victoryLocked = true
            this.player.iframes = 99
            for (const s of this.shots) s.life = 0
            this.teles.length = 0
            this.schedule(1.1, () => this.beginEnd(true))
            return
        }
        this.overlay.announce(`${e.def.name.toUpperCase()} FALLS`, 0xffd54f, 52)
        const id = e.def.id
        this.schedule(1.2, () => this.beginTravel(id))
    }

    // ─── Drops & pickups ─────────────────────────────────────────────────

    private dropXp(e: EnemyRt): void {
        const total = e.def.xp * (e.elite ? 6 : 1)
        if (total <= 0) return
        if (e.boss) {
            const n = 24
            for (let i = 0; i < n; i++) {
                const a = (i / n) * TAU
                this.dropPickup('gem', e.x, e.y, total / n, false, Math.cos(a) * 320, Math.sin(a) * 320)
            }
            return
        }
        this.dropPickup('gem', e.x, e.y, total, false)
    }

    private rollDrops(e: EnemyRt): void {
        const luck = this.stats.luck
        const shardChance = (e.elite ? 1 : 0.008) * this.stats.greed * (1 + luck * 0.08)
        if (randomChance(shardChance)) this.dropPickup('shard', e.x, e.y, 1, false)
        if (e.boss) {
            for (let i = 0; i < 5; i++) this.dropPickup('shard', e.x, e.y, 1, false, (randomFloat() - 0.5) * 500, (randomFloat() - 0.5) * 500)
            this.dropPickup('food', e.x + 40, e.y, 0, false)
            return
        }
        const hurt = this.player.hp < this.stats.maxHp * 0.5 ? 2 : 1
        if (randomChance(0.004 * hurt * (1 + luck * 0.05))) this.dropPickup('food', e.x, e.y, 0, false)
        else if (randomChance(0.0016 * (1 + luck * 0.05))) this.dropPickup('magnet', e.x, e.y, 0, false)
        else if (randomChance(0.0011 * (1 + luck * 0.05))) this.dropPickup('bomb', e.x, e.y, 0, false)
    }

    private gemTier(v: number): number {
        let t = 0
        for (let i = 0; i < GEM_TIERS.length; i++) if (v >= GEM_TIERS[i]!.min) t = i
        return t
    }

    private dropPickup(kind: PickupKind, x: number, y: number, value: number, boss: boolean, vx?: number, vy?: number): void {
        if (kind === 'gem') {
            if (this.gemCount >= MAX_GEMS) {
                // Fold into the nearest resting gem rather than add another sprite
                let best: Pickup | null = null
                let bd = Infinity
                for (const p of this.pickups) {
                    if (p.kind !== 'gem' || !p.alive || p.attract) continue
                    const d = (p.x - x) ** 2 + (p.y - y) ** 2
                    if (d < bd) {
                        bd = d
                        best = p
                    }
                }
                if (best) {
                    best.value += value
                    const t = this.gemTier(best.value)
                    if (t !== best.tier) {
                        best.tier = t
                        best.sprite.texture = this.atlas.get(`gem.${t}`)
                    }
                    return
                }
            }
            this.gemCount++
        }
        const tier = kind === 'gem' ? this.gemTier(value) : 0
        const tex = kind === 'gem' ? `gem.${tier}` : kind === 'chest' ? (boss ? 'chestBoss' : 'chest') : kind
        const sprite = this.pickupPool.get(this.atlas.get(tex))
        const a = randomFloat() * TAU
        const sp = kind === 'gem' ? 40 + randomFloat() * 90 : kind === 'chest' ? 0 : 120
        const shadow = kind === 'chest' || kind === 'food' || kind === 'bomb' || kind === 'magnet' ? this.shadowPool.get(this.atlas.get('shadow')) : null
        this.pickups.push({
            kind,
            x,
            y,
            vx: vx ?? Math.cos(a) * sp,
            vy: vy ?? Math.sin(a) * sp,
            value,
            tier,
            sprite,
            shadow,
            attract: false,
            speed: 0,
            age: 0,
            boss,
            alive: true,
            fxT: 0
        })
        if (kind === 'chest') {
            this.play('chestDrop', { volume: 0.9 })
            this.fx.ring(x, y, boss ? 0xff6ad5 : 0xffd54f, 10, 120, 0.6, 1)
            this.fx.sprite('glow', x, y - 120, { life: 1.4, color: boss ? 0xff6ad5 : 0xffd54f, size0: 60, size1: 40, a0: 0.9, a1: 0, aspect: 7 })
            this.fx.burst(x, y, { count: 30, color: 0xffe27a, tex: 'p.star', speed: 300, life: 0.8, size: 8 })
        }
    }

    private updatePickups(dt: number): void {
        const p = this.player
        const mag = this.stats.magnet
        const mag2 = mag * mag
        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const k = this.pickups[i]!
            if (!k.alive) continue
            k.age += dt
            const dx = p.x - k.x
            const dy = p.y - k.y
            const d2 = dx * dx + dy * dy
            if (!k.attract && k.kind !== 'chest' && p.alive) {
                const range = k.kind === 'gem' || k.kind === 'shard' ? mag2 : mag2 * 0.45
                if (d2 < range) {
                    k.attract = true
                    // A little hop away first, then the vacuum
                    const d = Math.sqrt(d2) || 1
                    k.vx = (-dx / d) * 160
                    k.vy = (-dy / d) * 160
                    k.speed = 0
                }
            }
            if (k.attract && p.alive) {
                const d = Math.sqrt(d2) || 1
                k.speed = Math.min(1700, k.speed + 2600 * dt)
                const tx = (dx / d) * k.speed
                const ty = (dy / d) * k.speed
                const f = 1 - Math.exp(-dt * 10)
                k.vx += (tx - k.vx) * f
                k.vy += (ty - k.vy) * f
            } else {
                const f = Math.exp(-dt * 5)
                k.vx *= f
                k.vy *= f
            }
            k.x += k.vx * dt
            k.y += k.vy * dt
            const reach = k.kind === 'chest' ? p.radius + 26 : p.radius + 12
            if (p.alive && d2 < reach * reach && k.age > 0.15) this.collect(k)
        }
        // Compact
        let w = 0
        for (let i = 0; i < this.pickups.length; i++) {
            const k = this.pickups[i]!
            if (k.alive) this.pickups[w++] = k
        }
        this.pickups.length = w
    }

    private collect(k: Pickup): void {
        k.alive = false
        this.pickupPool.release(k.sprite)
        if (k.shadow) this.shadowPool.release(k.shadow)
        const p = this.player
        switch (k.kind) {
            case 'gem': {
                this.gemCount--
                this.gainXp(k.value * this.stats.growth)
                const now = this.real
                if (now - this.lastGemT > 0.35) this.gemStreak = 0
                this.lastGemT = now
                const step = this.gemStreak++
                const octave = Math.min(2, Math.floor(step / ARP.length)) * 0.5
                const pitch = ARP[step % ARP.length]! * (1 + octave) * (this.magnetT > 0 ? 1 + Math.min(0.5, step * 0.004) : 1)
                this.play('xp', { pitch: Math.min(4, pitch * 0.9), volume: 0.32 }, 0.03)
                if (this.fx.quality > 0.6) this.fx.one(p.x, p.y - 4, 'p.star', GEM_TIERS[k.tier]!.color, 0, -40, 0.3, 8)
                break
            }
            case 'shard':
                this.shards++
                this.play('shard', { volume: 0.7 })
                this.fx.burst(p.x, p.y, { count: 10, color: 0xff5ec4, tex: 'p.star', speed: 160, life: 0.5, size: 7 })
                break
            case 'food':
                this.heal(Math.max(25, this.stats.maxHp * 0.25), true)
                break
            case 'magnet':
                this.vacuumGems()
                this.play('magnet', { volume: 0.9 })
                this.fx.ring(p.x, p.y, 0x5aa8ff, 20, Math.max(this.view.width, this.view.height) * 0.7, 0.7, 0.9, true)
                this.fx.ring(p.x, p.y, 0xffffff, 10, 200, 0.4, 0.7)
                break
            case 'bomb':
                this.bomb()
                break
            case 'chest':
                this.openChest(k.boss)
                break
        }
    }

    private vacuumGems(): void {
        this.magnetT = 2
        for (const g of this.pickups) {
            if (g.alive && (g.kind === 'gem' || g.kind === 'shard') && !g.attract) {
                g.attract = true
                g.speed = 200
            }
        }
    }

    private bomb(): void {
        const p = this.player
        const hw = this.view.width / 2 + 40
        const hh = this.view.height / 2 + 40
        for (const e of [...this.enemies]) {
            if (e.dead || Math.abs(e.x - p.x) > hw || Math.abs(e.y - p.y) > hh) continue
            // Boss body parts (wyrm segments: xp-less minions) pass damage to the head; the head takes its own share
            if (e.minion && e.def.xp <= 0) continue
            const dmg = e.boss ? e.maxHp * 0.05 : e.elite ? e.maxHp * 0.35 : e.hp + 1
            this.hit(e, dmg, { noCrit: true, silent: true, noNumber: !e.boss && !e.elite, knock: 400, numKind: 'big' })
        }
        for (const s of this.shots) s.life = 0
        this.flash(0xffffff, 0.75)
        this.shake(0.9)
        this.chromaAmt = 1
        this.play('explosion', { volume: 1, pitch: 0.55 })
        this.play('killBig', { volume: 0.9 })
        this.fx.ring(p.x, p.y, 0xffa040, 30, Math.hypot(hw, hh), 0.6, 1)
        this.fx.sprite('glow', p.x, p.y, { life: 0.5, color: 0xffd0a0, size0: 200, size1: Math.hypot(hw, hh) * 2.2, a0: 0.8 })
    }

    // ─── XP and level-ups ────────────────────────────────────────────────

    private xpFor(level: number): number {
        const l = level - 1
        return Math.round(5 + l * 8 + l * l * 0.45)
    }

    private gainXp(v: number): void {
        this.xp += v
        while (this.xp >= this.xpNext) {
            this.xp -= this.xpNext
            this.level++
            this.pendingLevels++
            this.xpNext = this.xpFor(this.level)
        }
    }

    private upgradeState(): UpgradeState {
        return { cls: this.cls, weapons: this.weapons, passives: this.passives, luck: this.stats.luck, hp: this.player.hp, maxHp: this.stats.maxHp, abilities: this.abilities, slots: this.slots, stats: this.stats, level: this.level }
    }

    private checkSlots(): void {
        let open = 0
        for (const lv of ABILITY_SLOT_LEVELS) if (this.level >= lv) open++
        if (open <= this.slots) return
        this.slots = open
        const p = this.player
        this.overlay.announce('SLOT UNLOCKED', 0x9fd8ff, 60)
        this.overlay.announce(`New ability on ${ABILITY_KEYS[open - 1]}`, 0xffffff, 30)
        this.play('slotUnlock', { volume: 1 })
        this.flash(0x9fd8ff, 0.25)
        this.chromaAmt = 1
        this.shake(0.3)
        for (let i = 0; i < 3; i++) this.schedule(i * 0.1, () => this.fx.ring(p.x, p.y, i === 1 ? 0xffffff : 0x9fd8ff, 20, 300 + i * 60, 0.6, 1))
        this.fx.sprite('runeRing', p.x, p.y, { life: 1.2, color: 0x9fd8ff, size0: 80, size1: 360, a0: 1, a1: 0, vrot: -3, follow: p })
        this.fx.burst(p.x, p.y, { count: 60, color: 0x9fd8ff, tex: 'p.star', speed: 640, life: 0.9, size: 9 })
    }

    private startLevelFx(): void {
        const p = this.player
        this.checkSlots()
        this.levelGlowT = 0.6
        this.levelFxT = 0.42
        this.slowMo(0.2, 0.42)
        this.play('levelUp', { volume: 0.9 })
        this.fx.ring(p.x, p.y, 0xffd54f, 20, 280, 0.5, 1)
        this.fx.ring(p.x, p.y, 0xffffff, 10, 180, 0.35, 0.8, true)
        this.fx.sprite('runeRing', p.x, p.y, { life: 0.7, color: 0xffe27a, size0: 60, size1: 260, a0: 0.9, a1: 0, vrot: 3, follow: p })
        this.fx.burst(p.x, p.y, { count: 46, color: 0xffd54f, tex: 'p.star', speed: 520, life: 0.8, size: 8, drag: 3 })
        this.fx.burst(p.x, p.y, { count: 16, color: 0xffffff, tex: 'p.spark', speed: 700, life: 0.35, size: 8 })
        this.flash(0xffd54f, 0.12)
        this.zoomMul = 1.06
        // Shockwave pushes the crowd back
        this.grid.query(p.x, p.y, 260, e => {
            const dx = e.x - p.x
            const dy = e.y - p.y
            const d = Math.hypot(dx, dy) || 1
            if (d > 260) return
            const k = (700 * (1 - d / 300)) / e.mass * (e.boss ? 0.1 : 1)
            e.kx += (dx / d) * k
            e.ky += (dy / d) * k
        })
    }

    private openLevelUp(): void {
        if (this.pendingLevels <= 0 || this.over || this.ending) return
        this.pendingLevels--
        this.menu = 'levelup'
        const n = this.stats.luck >= 4 ? 4 : 3
        this.choices = rollOptions(this.upgradeState(), n)
        if (this.choices.some(c => c.rarity === 'legendary')) this.play('legendary', { volume: 0.6 })
        this.events.onLevelUp(this.choices.map(c => c.choice), this.rerolls)
    }

    choose(index: number): void {
        if (this.menu !== 'levelup') return
        const o = this.choices[index]
        if (!o) return
        this.choices = []
        this.applyOption(o)
        this.play('cardSelect', { volume: 0.7 })
        this.menu = null
        if (this.pendingLevels > 0) this.openLevelUp()
        this.input.clearQueued()
        this.emitHud()
    }

    reroll(): void {
        if (this.menu !== 'levelup' || this.rerolls <= 0) return
        this.rerolls--
        const n = this.stats.luck >= 4 ? 4 : 3
        this.choices = rollOptions(this.upgradeState(), n)
        this.play('reroll', { volume: 0.7 })
        this.input.clearQueued()
        this.events.onLevelUp(this.choices.map(c => c.choice), this.rerolls)
    }

    private openChest(boss: boolean): void {
        const luck = this.stats.luck
        const r = randomFloat()
        const count = (boss ? (r < 0.55 ? 3 : 5) : r < 0.72 - luck * 0.03 ? 1 : r < 0.96 ? 3 : 5) + Math.max(0, Math.floor(this.meta.chestBonus))
        const rewards = []
        for (let i = 0; i < count; i++) {
            const opt = rollOptions(this.upgradeState(), 1, { ownedOnly: true, rarityBoost: boss ? 4 : 1.5 })[0]
            if (!opt) break
            this.applyOption(opt)
            rewards.push(opt.choice)
        }
        const gold = Math.max(1, Math.round((boss ? randomInt(5, 10) : randomInt(1, 3)) * this.stats.greed))
        this.shards += gold
        this.menu = 'chest'
        this.play('chestOpen', { volume: 1 })
        const p = this.player
        this.fx.burst(p.x, p.y, { count: 40, color: boss ? 0xff6ad5 : 0xffd54f, tex: 'p.star', speed: 420, life: 0.9, size: 9 })
        this.fx.ring(p.x, p.y, 0xffe27a, 20, 200, 0.5, 1)
        this.events.onChest(rewards, gold)
    }

    closeChest(): void {
        if (this.menu !== 'chest') return
        this.menu = null
        this.input.clearQueued()
        this.emitHud()
    }

    private addWeapon(id: string, mul: number): void {
        const def = WEAPON_DEFS[id]
        if (!def || this.weapons.some(w => w.def.id === id)) return
        const mods = emptyMods()
        mods.damage += (mul - 1) * 0.3
        this.weapons.push({ def, level: 1, evolved: false, mods, timer: 0.3, st: {}, dealt: 0 })
    }

    private applyOption(o: UpgradeOption): void {
        const mul = RARITY_MUL[o.rarity]
        const p = this.player
        switch (o.kind) {
            case 'weapon': {
                const w = this.weapons.find(x => x.def.id === o.id)
                if (!w) {
                    this.addWeapon(o.id, mul)
                    break
                }
                if (w.level >= WEAPON_MAX_LEVEL) break
                const mods = w.def.levels[w.level - 1] ?? {}
                addMods(w.mods, mods, mul)
                if (isIntegerOnly(mods)) w.mods.damage += (mul - 1) * 0.25
                w.mods.damage += RARITY_BONUS[o.rarity]
                if (o.rarity === 'legendary') {
                    if (w.def.usesAmount) w.mods.amount += 1
                    else w.mods.area += 0.15
                }
                w.level++
                this.weaponLevelFx(w)
                break
            }
            case 'evolution': {
                const w = this.weapons.find(x => x.def.id === o.id)
                if (!w || w.evolved) break
                w.evolved = true
                addMods(w.mods, w.def.evo.bonus)
                this.overlay.announce(`EVOLVED: ${w.def.evo.name.toUpperCase()}`, w.def.evo.color, 56)
                this.play('legendary', { volume: 1 })
                this.fx.ring(p.x, p.y, w.def.evo.color, 20, 320, 0.7, 1)
                this.fx.ring(p.x, p.y, 0xffffff, 10, 220, 0.5, 1, true)
                this.fx.burst(p.x, p.y, { count: 70, color: w.def.evo.color, tex: 'p.star', speed: 600, life: 1, size: 10 })
                this.flash(w.def.evo.color, 0.35)
                this.chromaAmt = 1
                this.shake(0.4)
                break
            }
            case 'passive': {
                const def = PASSIVE_DEFS[o.id]
                if (!def) break
                const owned = this.passives.find(x => x.id === o.id)
                const gain = def.scalable ? mul : 1
                if (owned) {
                    if (owned.level >= def.maxLevel) break
                    owned.level++
                    owned.power += gain
                } else {
                    this.passives.push({ id: o.id, level: 1, power: gain })
                }
                this.recomputeStats()
                break
            }
            case 'ability':
                this.learnAbility(o.id, mul)
                break
            case 'heal':
                this.heal(this.stats.maxHp * 0.3 * mul, true)
                break
            case 'shards':
                this.shards += shardCacheAmount(o.rarity)
                this.play('shard', { volume: 0.8 })
                break
        }
        if (o.rarity === 'legendary' && o.kind !== 'evolution') this.play('legendary', { volume: 0.7 })
    }

    private weaponLevelFx(w: WeaponInst): void {
        const p = this.player
        const c = w.def.color
        this.fx.ring(p.x, p.y, c, 10, 110 + w.level * 10, 0.4, 0.9)
        this.fx.burst(p.x, p.y, { count: 14 + w.level * 2, color: c, tex: 'p.spark', speed: 380, life: 0.4, size: 7 })
    }

    private learnAbility(id: string, mul: number): void {
        const def = ABILITY_DEFS[id]
        if (!def) return
        const p = this.player
        const owned = this.abilities.find(a => a.def.id === id)
        if (owned) {
            if (owned.level >= ABILITY_MAX_LEVEL) return
            const before = this.abilityMax(owned)
            addAbilityMods(owned.mods, def.levels[owned.level - 1] ?? {}, mul)
            owned.level++
            const after = this.abilityMax(owned)
            owned.charges = Math.min(after, owned.charges + Math.max(0, after - before))
            if (owned.level >= ABILITY_MAX_LEVEL) {
                this.overlay.announce(`MASTERY: ${def.name.toUpperCase()}`, def.color, 48)
                this.play('legendary', { volume: 0.8 })
            }
        } else {
            if (this.abilities.length >= this.slots) return
            const mods = emptyAbilityMods()
            mods.damage += (mul - 1) * 0.4
            const a: AbilityInst = { def, level: 1, mods, cd: 0, cdMax: 1, charges: 1, activeT: 0, st: {}, readyFired: true, ctx: null }
            a.ctx = this.sourced('a:' + id)
            this.abilities.push(a)
            this.overlay.announce(`${ABILITY_KEYS[this.abilities.length - 1]}: ${def.name.toUpperCase()}`, def.color, 44)
            this.play('abilityUnlock', { volume: 0.9 })
        }
        this.fx.ring(p.x, p.y, def.color, 20, 220, 0.5, 1)
        this.fx.ring(p.x, p.y, 0xffffff, 10, 150, 0.35, 0.8, true)
        this.fx.burst(p.x, p.y, { count: 36, color: def.color, tex: 'p.star', speed: 480, life: 0.7, size: 8 })
    }

    private abilityMax(a: AbilityInst): number {
        return COUNT_CHARGES.has(a.def.id) ? 1 : 1 + a.mods.charges
    }

    private abilityStatsOf(a: AbilityInst) {
        return abilityStats(a.def, a.level, a.mods, this.stats, this.level)
    }

    castAbility(slot: number): void {
        if (this.paused || this.menu || this.over || this.ending || !this.player.alive) return
        const a = this.abilities[slot]
        if (!a) return
        if (a.charges <= 0) {
            this.play('uiError', { volume: 0.35 }, 0.25)
            return
        }
        const s = this.abilityStatsOf(a)
        let ok = false
        try {
            ok = a.def.cast(a.ctx!, a, s)
        } catch {
            ok = false
        }
        if (ok === false) {
            this.play('uiError', { volume: 0.3 }, 0.25)
            return
        }
        if (a.charges >= this.abilityMax(a)) {
            a.cd = s.cooldown
            a.cdMax = s.cooldown
        }
        a.charges--
        a.readyFired = false
        this.rig.attack(Math.atan2(this.aimDir().y, this.aimDir().x), this.player.facing)
        this.play('cast', { volume: 0.6, pitch: 0.9 + randomFloat() * 0.2 }, 0.05)
        const p = this.player
        this.fx.ring(p.x, p.y, a.def.color, 8, 60, 0.25, 0.9)
    }

    private updateAbilities(dt: number): void {
        for (const a of this.abilities) {
            const max = this.abilityMax(a)
            if (a.charges < max) {
                a.cd -= dt
                if (a.cd <= 0) {
                    a.charges++
                    if (a.charges < max) {
                        const s = this.abilityStatsOf(a)
                        a.cd = s.cooldown
                        a.cdMax = s.cooldown
                    } else a.cd = 0
                    if (!a.readyFired) {
                        a.readyFired = true
                        this.play('abilityReady', { volume: 0.45 }, 0.2)
                        const p = this.player
                        this.fx.ring(p.x, p.y, a.def.color, 10, 50, 0.3, 0.8, true)
                    }
                }
            }
            if (a.activeT > 0) a.activeT = Math.max(0, a.activeT - dt)
            if (a.def.tick) {
                try {
                    a.def.tick(a.ctx!, a, this.abilityStatsOf(a), dt)
                } catch {
                    // ignore
                }
            }
        }
        // Timed buffs
        let move = 1
        let fire = 1
        let crit = 0
        for (let i = this.buffs.length - 1; i >= 0; i--) {
            const b = this.buffs[i]!
            b.t -= dt
            if (b.t <= 0) {
                this.buffs.splice(i, 1)
                continue
            }
            move = Math.max(move, b.move)
            fire = Math.max(fire, b.fire)
            crit = Math.max(crit, b.crit)
        }
        this.buffMove = move
        this.buffFire = fire
        this.buffCrit = crit
        // Chrono fields
        for (let i = this.chronos.length - 1; i >= 0; i--) {
            const c = this.chronos[i]!
            c.t -= dt
            if (c.t <= 0) {
                this.chronos.splice(i, 1)
                continue
            }
            this.grid.query(c.x, c.y, c.r, e => {
                if ((e.x - c.x) ** 2 + (e.y - c.y) ** 2 > c.r * c.r) return
                e.slowAmt = Math.max(e.slowAmt, c.slow * (e.boss ? 0.4 : 1))
                e.slowT = Math.max(e.slowT, 0.15)
            })
        }
        // Shield
        if (this.shieldEnd) {
            this.shieldT -= dt
            if (this.shieldT <= 0) this.endShield(false)
        }
    }

    private recomputeStats(): void {
        const old = this.stats.maxHp
        this.stats = computeStats(this.cls, this.meta, this.passives)
        if (this.stats.maxHp > old) this.player.hp += this.stats.maxHp - old
        this.player.hp = Math.min(this.player.hp, this.stats.maxHp)
    }

    // ─── Projectiles, zones, allies ──────────────────────────────────────

    projectile(o: ProjOpts): Projectile {
        if (this.projectiles.length >= MAX_PROJECTILES) {
            // Recycle the oldest plain projectile
            const idx = this.projectiles.findIndex(p => p.alive && !p.update && p.life < 1e8)
            if (idx >= 0) {
                const old = this.projectiles[idx]!
                old.alive = false
                old.onEnd = null
            }
        }
        // Each weapon level makes its shots visibly bigger and brighter
        const w = o.weapon
        if (w) {
            const grow = 1 + (w.level - 1) * 0.045 + (w.evolved ? 0.12 : 0)
            o = { ...o, scale: (o.scale ?? 1) * grow }
            const col = w.evolved ? w.def.evo.color : w.def.color
            if (o.glow === undefined && o.tex && w.level >= 4 && !o.update) {
                o.glow = col
                o.glowSize = 34 + w.level * 3
            } else if (o.glowSize) o.glowSize *= grow
            if (!o.trail && o.tex && w.level >= 6 && !o.update) o.trail = { color: col, rate: 26, tex: 'p.spark', size: 4, life: 0.16 }
        }
        const additive = !!o.additive
        const pool = additive ? this.projAddPool : this.projPool
        const sprite = pool.get(o.tex ? this.atlas.get(o.tex) : Texture.EMPTY)
        sprite.visible = !!o.tex
        sprite.tint = o.color ?? 0xffffff
        let glow: Sprite | null = null
        if (o.glow !== undefined) {
            glow = this.glowPool.get(this.atlas.get('glow'))
            glow.tint = o.glow
            glow.alpha = 0.7
            glow.scale.set((o.glowSize ?? 48) / 128)
        }
        const p: Projectile = {
            alive: true,
            x: o.x,
            y: o.y,
            vx: o.vx,
            vy: o.vy,
            radius: o.radius,
            damage: o.damage,
            pierce: o.pierce ?? 1,
            life: o.life,
            age: 0,
            sprite,
            glow,
            spin: o.spin ?? 0,
            faceVel: o.faceVel ?? !o.spin,
            scale: o.scale ?? 1,
            hit: { ...(o.hit ?? {}), weapon: o.weapon ?? null },
            rehit: o.rehit ?? 0,
            hitIds: [],
            hitMap: o.rehit ? new Map() : null,
            homing: o.homing ?? 0,
            weapon: o.weapon ?? null,
            trail: o.trail ?? null,
            trailT: 0,
            update: o.update ?? null,
            onHit: o.onHit ?? null,
            onEnd: o.onEnd ?? null,
            noCollide: !!o.noCollide,
            data: o.data ?? {},
            target: o.target ?? null,
            additive
        }
        sprite.position.set(p.x, p.y)
        sprite.scale.set(p.scale)
        sprite.rotation = p.faceVel ? Math.atan2(p.vy, p.vx) : 0
        this.projectiles.push(p)
        return p
    }

    private endProjectile(p: Projectile): void {
        p.alive = false
        const end = p.onEnd
        p.onEnd = null
        if (end) {
            try {
                end(p, this)
            } catch {
                // ignore
            }
        }
    }

    private updateProjectiles(dt: number): void {
        const pl = this.player
        const list = this.projectiles
        for (let i = 0; i < list.length; i++) {
            const p = list[i]!
            if (!p.alive) continue
            p.age += dt
            p.life -= dt
            if (p.update) {
                try {
                    p.update(p, this, dt)
                } catch {
                    p.alive = false
                }
            } else {
                if (p.homing > 0) {
                    if (!p.target || p.target.dead || p.target.untargetable) {
                        p.data.rt = (p.data.rt ?? 0) - dt
                        if (p.data.rt <= 0) {
                            p.data.rt = 0.15
                            p.target = this.nearest(p.x, p.y, 560, e => p.hitIds.includes(e.uid) || (p.hitMap?.get(e.uid) ?? 0) > this.time)
                        }
                    }
                    const t = p.target
                    const sp = Math.hypot(p.vx, p.vy) || 1
                    const want = p.data.spd ?? sp
                    const nsp = sp + (want - sp) * Math.min(1, dt * 4)
                    let a = Math.atan2(p.vy, p.vx)
                    if (t && !t.dead) {
                        let d = Math.atan2(t.y - p.y, t.x - p.x) - a
                        d = Math.atan2(Math.sin(d), Math.cos(d))
                        a += Math.max(-p.homing * dt, Math.min(p.homing * dt, d))
                    }
                    p.vx = Math.cos(a) * nsp
                    p.vy = Math.sin(a) * nsp
                }
                p.x += p.vx * dt
                p.y += p.vy * dt
            }
            if (!p.alive) {
                this.endProjectile(p)
                continue
            }
            if (p.trail) {
                p.trailT -= dt
                if (p.trailT <= 0) {
                    p.trailT = 1 / p.trail.rate
                    const tr = p.trail
                    this.fx.one(p.x, p.y, tr.tex ?? 'p.dot', tr.color, -p.vx * 0.05 + (Math.random() - 0.5) * 30, -p.vy * 0.05 + (Math.random() - 0.5) * 30, tr.life ?? 0.3, (tr.size ?? 6) * p.scale)
                }
            }
            if (!p.noCollide && p.radius > 0) this.collide(p)
            if (p.life <= 0 || p.pierce <= 0) {
                this.endProjectile(p)
                continue
            }
            if (!p.update && (Math.abs(p.x - pl.x) > 2200 || Math.abs(p.y - pl.y) > 2200)) {
                p.alive = false
                p.onEnd = null
            }
        }
        // Compact and release
        let w = 0
        for (let i = 0; i < list.length; i++) {
            const p = list[i]!
            if (p.alive) {
                list[w++] = p
                continue
            }
            ;(p.additive ? this.projAddPool : this.projPool).release(p.sprite)
            if (p.glow) this.glowPool.release(p.glow)
        }
        list.length = w
    }

    private collide(p: Projectile): void {
        const time = this.time
        this.grid.query(p.x, p.y, p.radius, e => {
            if (e.untargetable) return
            const rr = p.radius + e.radius
            const dx = e.x - p.x
            const dy = e.y - p.y
            if (dx * dx + dy * dy > rr * rr) return
            if (p.hitMap) {
                const t = p.hitMap.get(e.uid)
                if (t !== undefined && t > time) return
                p.hitMap.set(e.uid, time + p.rehit)
                if (p.hitMap.size > 300) {
                    for (const [k, v] of p.hitMap) if (v < time) p.hitMap.delete(k)
                }
            } else {
                if (p.hitIds.includes(e.uid)) return
                p.hitIds.push(e.uid)
            }
            let res = 0
            if (p.damage > 0) {
                const sp = Math.hypot(p.vx, p.vy)
                if (sp > 20) {
                    p.hit.kx = p.vx / sp
                    p.hit.ky = p.vy / sp
                } else {
                    p.hit.kx = undefined
                    p.hit.ky = undefined
                    p.hit.sx = p.x
                    p.hit.sy = p.y
                }
                res = this.hit(e, p.damage, p.hit)
            }
            if (p.onHit) {
                try {
                    p.onHit(p, e, this, res)
                } catch {
                    // content error: keep the projectile flying
                }
            }
            p.pierce--
            if (p.pierce <= 0) return true
        })
    }

    zone(o: ZoneOpts): Zone {
        const kind = o.kind
        const sprite = kind === 'void'
            ? this.decalPool.get(this.atlas.get('blackHole'))
            : this.decalAddPool.get(this.atlas.get('disc'))
        const ring = this.decalAddPool.get(this.atlas.get(kind === 'holy' || kind === 'void' ? 'runeRing' : 'ringSoft'))
        sprite.tint = kind === 'void' ? 0xffffff : o.color
        ring.tint = o.color
        const z: Zone = {
            x: o.x,
            y: o.y,
            radius: o.radius,
            life: o.life,
            tick: o.tick,
            damage: o.damage,
            color: o.color,
            kind,
            pull: o.pull ?? 0,
            follow: !!o.follow,
            hit: { ...(o.hit ?? {}), weapon: o.weapon ?? null, silent: true },
            age: 0,
            tickT: 0,
            sprite,
            ring,
            weapon: o.weapon ?? null,
            onTick: o.onTick ?? null,
            onEnd: o.onEnd ?? null,
            pullBosses: !!o.pullBosses,
            fxT: 0,
            alive: true
        }
        this.zones.push(z)
        return z
    }

    private updateZones(dt: number): void {
        const p = this.player
        for (const z of this.zones) {
            if (!z.alive) continue
            z.age += dt
            if (z.follow) {
                z.x = p.x
                z.y = p.y
            }
            if (z.pull) this.pull(z.x, z.y, z.radius, z.pull, dt, z.pullBosses)
            z.tickT -= dt
            if (z.tickT <= 0 && z.damage > 0) {
                z.tickT = z.tick
                this.query(z.x, z.y, z.radius, e => {
                    this.hit(e, z.damage, z.hit)
                })
                try {
                    z.onTick?.(z, this)
                } catch {
                    z.onTick = undefined
                }
            }
            z.fxT -= dt
            if (z.fxT <= 0) {
                z.fxT = z.kind === 'storm' ? 0.03 : 0.06
                const a = Math.random() * TAU
                const r = Math.sqrt(Math.random()) * z.radius
                const x = z.x + Math.cos(a) * r
                const y = z.y + Math.sin(a) * r
                if (z.kind === 'fire' || z.kind === 'magma') this.fx.one(x, y, 'p.flame', z.kind === 'magma' ? 0xff4a10 : 0xff7a20, 0, -60, 0.5, 11)
                else if (z.kind === 'rift' || z.kind === 'void') this.fx.one(z.x + Math.cos(a) * z.radius, z.y + Math.sin(a) * z.radius, 'p.spark', z.color, -Math.cos(a) * z.radius * 2.5, -Math.sin(a) * z.radius * 2.5, 0.35, 7)
                else if (z.kind === 'storm') this.fx.one(x, y, 'p.spark', z.color, (Math.random() - 0.5) * 60, -280, 0.3, 6)
                else if (z.kind === 'poison') {
                    this.fx.one(x, y, 'p.smoke', z.color, (Math.random() - 0.5) * 20, -18, 1.1, 30 + Math.random() * 20, { grow: 1.6, alpha: 0.32 })
                    if (Math.random() < 0.3) this.fx.one(x, y, 'p.dot', 0xe0ff9a, 0, -40, 0.6, 5)
                }
                else this.fx.one(x, y, 'p.star', z.color, 0, -40, 0.6, 6)
            }
            if (z.age >= z.life) {
                z.alive = false
                try {
                    z.onEnd?.(z, this)
                } catch {
                    // ignore
                }
            }
        }
        let w = 0
        for (let i = 0; i < this.zones.length; i++) {
            const z = this.zones[i]!
            if (z.alive) {
                this.zones[w++] = z
                continue
            }
            ;(z.kind === 'void' ? this.decalPool : this.decalAddPool).release(z.sprite)
            this.decalAddPool.release(z.ring)
        }
        this.zones.length = w
    }

    ally(kind: AllyKind, x: number, y: number, life: number, opts?: AllyOpts): void {
        const sprite = this.actorPool.get(this.atlas.get(kind === 'shade' ? `hero.${this.cls.id}.w` : kind))
        if (kind === 'shade') sprite.tint = 0x5a2a9a
        const shadow = this.shadowPool.get(this.atlas.get('shadow'))
        const might = this.stats.might
        this.allies.push({
            kind,
            x,
            y,
            vx: 0,
            vy: 0,
            life,
            max: life,
            speed: opts?.speed ?? (kind === 'wraith' ? 400 : 230),
            damage: opts?.damage ?? (kind === 'wraith' ? 22 + this.level * 1.6 : 8 + this.level * 0.7) * might,
            radius: kind === 'skeleton' ? 13 : 16,
            src: opts?.src ?? 'other',
            onEnd: opts?.onEnd ?? null,
            target: null,
            retarget: 0,
            hits: new Map(),
            sprite,
            shadow,
            facing: 1,
            fxT: 0,
            alive: true
        })
    }

    private updateAllies(dt: number): void {
        const p = this.player
        for (const a of this.allies) {
            if (!a.alive) continue
            a.life -= dt
            a.retarget -= dt
            if (!a.target || a.target.dead || a.target.untargetable || a.retarget <= 0) {
                a.target = this.nearest(a.x, a.y, a.kind === 'wraith' ? 600 : 420)
                a.retarget = 0.35
            }
            let tx: number
            let ty: number
            if (a.target) {
                tx = a.target.x
                ty = a.target.y
            } else {
                const ang = this.time * 1.5 + (a.max * 7) % TAU
                tx = p.x + Math.cos(ang) * 70
                ty = p.y + Math.sin(ang) * 70
            }
            const dx = tx - a.x
            const dy = ty - a.y
            const d = Math.hypot(dx, dy) || 1
            const want = d > 10 ? a.speed : 0
            const f = 1 - Math.exp(-dt * (a.kind === 'wraith' ? 6 : 9))
            a.vx += ((dx / d) * want - a.vx) * f
            a.vy += ((dy / d) * want - a.vy) * f
            a.x += a.vx * dt
            a.y += a.vy * dt
            if (Math.abs(a.vx) > 5) a.facing = a.vx > 0 ? 1 : -1
            this.query(a.x, a.y, a.radius, e => {
                const t = a.hits.get(e.uid) ?? 0
                if (t > this.time) return
                a.hits.set(e.uid, this.time + (a.kind === 'skeleton' ? 0.5 : 0.3))
                this.hit(e, a.damage, { knock: 140, sx: a.x, sy: a.y, silent: true, color: 0xd8c0ff, src: a.src })
                if (a.kind === 'shade') this.fx.sprite('slash', e.x, e.y, { life: 0.14, color: 0xc0a0ff, size0: 30, size1: 60, rot: Math.random() * 6.28, a0: 0.9 })
            })
            if (a.hits.size > 200) a.hits.clear()
            a.fxT -= dt
            if (a.fxT <= 0 && a.kind !== 'skeleton') {
                a.fxT = a.kind === 'shade' ? 0.06 : 0.04
                if (a.kind === 'shade') this.fx.sprite(`hero.${this.cls.id}.w`, a.x, a.y - 6, { life: 0.25, color: 0x8a5aff, size0: 70, size1: 64, a0: 0.35, a1: 0, flip: a.facing < 0 })
                else this.fx.one(a.x, a.y, 'p.smoke', 0x9a5aff, 0, 0, 0.45, 12, { alpha: 0.6 })
            }
            if (a.life <= 0) {
                a.alive = false
                this.fx.burst(a.x, a.y, { count: 10, color: 0xb06bff, tex: 'p.smoke', speed: 120, life: 0.5, size: 10 })
                if (a.onEnd) {
                    try {
                        a.onEnd(a)
                    } catch {
                        // ignore
                    }
                }
            }
        }
        let w = 0
        for (let i = 0; i < this.allies.length; i++) {
            const a = this.allies[i]!
            if (a.alive) {
                this.allies[w++] = a
                continue
            }
            this.actorPool.release(a.sprite)
            this.shadowPool.release(a.shadow)
        }
        this.allies.length = w
    }

    // ─── Player ──────────────────────────────────────────────────────────

    private updatePlayer(dt: number): void {
        const p = this.player
        if (!p.alive) return
        const mv = this.input.move()
        p.moving = Math.hypot(mv.x, mv.y) > 0.1
        if (p.moving) {
            p.dashX = mv.x
            p.dashY = mv.y
        }
        if (this.input.dashQueued) {
            this.input.dashQueued = false
            if (p.dashCd <= 0 && p.dashT <= 0) this.dash()
        }
        if (this.input.ultQueued) {
            this.input.ultQueued = false
            this.castUlt()
        }
        const q = this.input.abilityQueued
        for (let i = 0; i < q.length; i++) {
            if (!q[i]) continue
            q[i] = false
            this.castAbility(i)
        }
        if (p.dashT > 0) {
            p.dashT -= dt
            const d = Math.hypot(p.dashX, p.dashY) || 1
            p.vx = (p.dashX / d) * DASH_SPEED
            p.vy = (p.dashY / d) * DASH_SPEED
            if (Math.random() < 0.8) {
                this.fx.sprite(`hero.${this.cls.id}.w`, p.x, p.y, { life: 0.3, color: this.cls.color, size0: 104, size1: 98, a0: 0.55, a1: 0, flip: p.facing < 0 })
            }
            this.fx.one(p.x, p.y + 10, 'p.spark', this.cls.color, -p.vx * 0.3, -p.vy * 0.3, 0.3, 7)
        } else {
            if (this.playerSlowT > 0) this.playerSlowT -= dt
            const sp = this.stats.moveSpeed * this.buffMove * (this.playerSlowT > 0 ? 1 - this.playerSlowAmt : 1)
            const f = 1 - Math.exp(-dt * 14)
            p.vx += (mv.x * sp - p.vx) * f
            p.vy += (mv.y * sp - p.vy) * f
        }
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.dashCd = Math.max(0, p.dashCd - dt)
        p.iframes = Math.max(0, p.iframes - dt)
        p.hurtT = Math.max(0, p.hurtT - dt)
        // Facing with hysteresis so vertical moves and aim swaps don't flicker it
        const m = this.mouseWorld()
        if (m) {
            const dx = m.x - p.x
            if (dx * p.facing < -18) p.facing = -p.facing
        } else if (p.vx * p.facing < -60) p.facing = -p.facing
        p.animT += dt * (p.moving ? 1 + Math.hypot(p.vx, p.vy) / 120 : 1)

        // Regen and lifesteal
        if (this.stats.regen > 0) this.heal(this.stats.regen * dt)
        if (this.lifestealPool > 0) {
            const cap = (2 + this.stats.lifesteal * 100) * dt
            const amt = Math.min(this.lifestealPool, cap)
            this.heal(amt)
            this.lifestealPool = Math.min(this.lifestealPool - amt, cap * 10)
        }
    }

    private dash(): void {
        const p = this.player
        if (!p.moving) {
            p.dashX = p.facing
            p.dashY = 0
        }
        const d = Math.hypot(p.dashX, p.dashY) || 1
        const nx = p.dashX / d
        const ny = p.dashY / d
        const ox = p.x
        const oy = p.y
        const blink = this.meta.blinkDash
        const len = blink ? 200 : DASH_SPEED * DASH_TIME
        p.dashCdMax = Math.max(1.2, 1.9 * Math.sqrt(this.stats.cooldown) * this.meta.dashCooldownMul)
        p.dashCd = p.dashCdMax
        const iframes = (DASH_TIME + 0.14) * this.meta.dashIframeMul
        this.play('dash', { volume: 0.7, pitch: blink ? 1.3 : 1 })
        this.fx.burst(p.x, p.y + 12, { count: 12, color: 0xd8d0f0, tex: 'p.smoke', speed: 160, life: 0.4, size: 10, normal: true, alpha: 0.5 })
        this.fx.ring(p.x, p.y, this.cls.color, 6, 46, 0.25, 0.8)
        if (blink) {
            for (let i = 0; i < 6; i++) {
                const t = i / 6
                this.fx.sprite(`hero.${this.cls.id}.w`, ox + nx * len * t, oy + ny * len * t, { life: 0.2 + t * 0.2, color: this.cls.color, size0: 104, size1: 96, a0: 0.25 + t * 0.4, a1: 0, flip: p.facing < 0 })
            }
            p.x += nx * len
            p.y += ny * len
            p.vx = nx * this.stats.moveSpeed
            p.vy = ny * this.stats.moveSpeed
            p.dashT = 0
            p.iframes = Math.max(p.iframes, iframes + 0.1)
            this.fx.lightning(ox, oy, p.x, p.y, this.cls.color, 4, 0.25, 0.6)
            const dmg = (18 + this.level * 3) * this.stats.might
            this.explode(ox, oy, 85, dmg, { visual: 'void', color: this.cls.color, knock: 320, sx: ox, sy: oy, sfx: true })
            this.explode(p.x, p.y, 85, dmg, { visual: 'void', color: this.cls.color, knock: 320, sx: p.x, sy: p.y, shake: 0.12 })
            this.chromaAmt = Math.min(1, this.chromaAmt + 0.4)
        } else {
            p.dashT = DASH_TIME
            p.iframes = Math.max(p.iframes, iframes)
        }
        if (this.cls.id === 'voidwalker') {
            const dmg = (10 + this.level * 1.5) * this.stats.might
            for (let i = 0; i <= 3; i++) {
                const t = i / 3
                this.zone({ x: ox + nx * len * t, y: oy + ny * len * t, radius: 42, life: 2.5, tick: 0.3, damage: dmg, color: 0xff3fa4, kind: 'rift', hit: { slow: 0.3, slowT: 0.5 } })
            }
        }
    }

    private castUlt(): void {
        if (this.ultCharge < 1 || this.ending || !this.player.alive) return
        this.ultCharge = 0
        this.ultUses++
        this.ultReadyFired = false
        this.play('ultimate', { volume: 1 })
        this.overlay.announce(this.cls.ultimate.toUpperCase(), this.cls.color, 56)
        this.chromaAmt = 1
        this.zoomMul = 1.08
        if (!this.ultCtx) this.ultCtx = this.sourced('ultimate')
        try {
            castUltimate(this.ultCtx)
        } catch (err) {
            console.error('[riftborn] ultimate failed', err)
        }
    }

    damagePlayer(amount: number, sx?: number, sy?: number): number {
        const p = this.player
        if (!p.alive || p.iframes > 0 || this.ending || this.victoryLocked || this.travel || amount <= 0) return 0
        let dmg = Math.max(1, amount - this.stats.armor)
        if (this.shieldHp > 0) {
            const taken = Math.min(this.shieldHp, dmg)
            this.shieldHp -= taken
            this.shieldAbsorbed += taken
            dmg -= taken
            p.iframes = 0.3
            this.fx.ring(p.x, p.y, 0xffe27a, 30, 50, 0.2, 1)
            this.fx.burst(sx ?? p.x, sy ?? p.y, { count: 8, color: 0xfff2b0, tex: 'p.spark', speed: 300, life: 0.25, size: 6 })
            this.play('affixShield', { volume: 0.5, pitch: 1.4 }, 0.08)
            if (this.shieldHp <= 0.01) this.endShield(true)
            if (dmg <= 0) return 0
        }
        p.hp -= dmg
        p.iframes = 0.55
        p.hurtT = 0.25
        this.hpBarT = 2.4
        this.hpGhostT = 0.45
        if (sx !== undefined && sy !== undefined && (sx !== p.x || sy !== p.y)) {
            const a = Math.atan2(sy - p.y, sx - p.x)
            // Rapid hits from about the same direction refresh one arc
            const same = this.hurtDirs.find(h => Math.abs(Math.atan2(Math.sin(h.a - a), Math.cos(h.a - a))) < 0.45)
            if (same) {
                same.a = a
                same.t = 0.6
                same.k = Math.min(1.6, same.k + 0.25)
            } else {
                if (this.hurtDirs.length >= 6) this.hurtDirs.shift()
                this.hurtDirs.push({ a, t: 0.6, k: 1 })
            }
        }
        this.fx.number(p.x, p.y - 30, dmg, 'player')
        this.fx.burst(p.x, p.y, { count: 10, color: 0xff3a4a, tex: 'p.dot', speed: 260, life: 0.4, size: 6 })
        this.shake(0.32)
        // Scaled by the hit, so chip damage in a crowd doesn't keep the screen red
        this.flash(0xff1a2a, Math.min(0.2, 0.05 + dmg / this.stats.maxHp))
        this.chromaAmt = Math.min(1, this.chromaAmt + 0.45)
        this.play('hurt', { volume: 0.85 })
        this.hitStopCd = 0
        this.hitStop(0.045)
        // Shove the crowd back a little
        const ox = sx ?? p.x
        const oy = sy ?? p.y
        this.grid.query(p.x, p.y, 70, e => {
            const dx = e.x - (ox + p.x) / 2
            const dy = e.y - (oy + p.y) / 2
            const d = Math.hypot(dx, dy) || 1
            const k = 300 / e.mass * (e.boss ? 0.05 : 1)
            e.kx += (dx / d) * k
            e.ky += (dy / d) * k
        })
        if (p.hp <= 0) this.playerDown()
        return dmg
    }

    private playerDown(): void {
        const p = this.player
        if (this.revivals > 0) {
            this.revivals--
            p.hp = this.stats.maxHp * 0.5
            p.iframes = 3
            this.play('revive', { volume: 1 })
            this.overlay.announce('REVIVED', 0xffd54f, 70)
            this.flash(0xffffff, 0.8)
            this.shake(0.8)
            this.chromaAmt = 1
            this.slowMo(0.3, 1)
            for (let i = 0; i < 3; i++) this.schedule(i * 0.12, () => this.fx.ring(p.x, p.y, i === 1 ? 0xffffff : 0xffd54f, 20, 380, 0.6, 1))
            this.fx.sprite('runeRing', p.x, p.y, { life: 1.4, color: 0xffe27a, size0: 80, size1: 400, a0: 1, a1: 0, vrot: 2.5 })
            this.fx.burst(p.x, p.y, { count: 80, color: 0xffd54f, tex: 'p.star', speed: 700, life: 1, size: 10 })
            this.explode(p.x, p.y, 320, (60 + this.level * 10) * this.stats.might, { knock: 900, visual: 'holy' })
            for (const s of this.shots) s.life = 0
            return
        }
        p.hp = 0
        this.beginEnd(false)
    }

    // ─── Enemies ─────────────────────────────────────────────────────────

    private updateEnemies(dt: number): void {
        const p = this.player
        const reach = Math.max(this.view.width, this.view.height) * 0.85 + 260
        const api = this.api
        const list = this.enemies
        for (let i = 0; i < list.length; i++) {
            const e = list[i]!
            if (e.dead) continue
            e.age += dt
            e.spawnT += dt
            if (e.flashT > 0) e.flashT -= dt
            if (e.freezeT > 0) e.freezeT -= dt
            if (e.stunT > 0) e.stunT -= dt
            if (e.slowT > 0) e.slowT -= dt
            else e.slowAmt = 0
            if (e.burnT > 0) {
                e.burnT -= dt
                e.burnTick -= dt
                if (e.burnTick <= 0) {
                    e.burnTick = 0.5
                    this.hit(e, e.burnDps * 0.5, { noCrit: true, silent: true, numKind: 'burn', src: e.burnSrc })
                    if (e.dead) continue
                }
                e.fxT -= dt
                if (e.fxT <= 0 && this.fx.quality > 0.5) {
                    e.fxT = 0.12
                    this.fx.one(e.x + (Math.random() - 0.5) * e.radius, e.y - e.radius * 0.3, 'p.flame', 0xff7a20, (Math.random() - 0.5) * 20, -70, 0.4, 9)
                }
            }
            if (e.affixes.length) {
                for (const id of e.affixes) {
                    try {
                        this.affix(id)?.update?.(e, api, dt)
                    } catch {
                        // ignore content errors
                    }
                }
                if (e.dead) continue
            }
            const held = e.freezeT > 0 || e.stunT > 0
            if (held) {
                e.vx = 0
                e.vy = 0
            } else {
                try {
                    if (e.def.update) e.def.update(e, api, dt)
                    else this.chase(e, dt)
                } catch {
                    this.chase(e, dt)
                }
            }
            if (e.dead) continue
            e.x += (e.vx + e.kx) * dt
            e.y += (e.vy + e.ky) * dt
            const kd = Math.exp(-dt * 9)
            e.kx *= kd
            e.ky *= kd
            if (e.hp <= 0) {
                this.kill(e)
                continue
            }
            // Stragglers left far behind come back around the front
            if (!e.boss) {
                const dx = e.x - p.x
                const dy = e.y - p.y
                if (Math.abs(dx) > reach || Math.abs(dy) > reach) {
                    e.x = p.x - dx * 0.92
                    e.y = p.y - dy * 0.92
                }
            }
        }
    }

    private separate(): void {
        const list = this.enemies
        for (let i = 0; i < list.length; i++) {
            const e = list[i]!
            if (e.dead || e.boss) continue
            let checks = 0
            this.grid.query(e.x, e.y, e.radius, o => {
                if (o === e) return
                const dx = e.x - o.x
                const dy = e.y - o.y
                const min = (e.radius + o.radius) * 0.85
                const d2 = dx * dx + dy * dy
                if (d2 >= min * min) return
                const d = Math.sqrt(d2) || 0.01
                const push = (min - d) * 0.5 * (o.mass / (e.mass + o.mass)) * 1.2
                e.x += (dx / d) * push
                e.y += (dy / d) * push
                if (++checks > 7) return true
            })
        }
    }

    private updateDying(dt: number): void {
        for (let i = this.dying.length - 1; i >= 0; i--) {
            const e = this.dying[i]!
            e.deathT += dt
            const dur = e.boss ? 0.9 : e.elite ? 0.4 : 0.24
            if (e.deathT >= dur) {
                this.releaseView(e)
                this.dying.splice(i, 1)
            }
        }
    }

    private compactEnemies(): void {
        const list = this.enemies
        let w = 0
        for (let i = 0; i < list.length; i++) {
            const e = list[i]!
            if (!e.dead) {
                list[w++] = e
                continue
            }
            if (this.dying.length < 220) this.dying.push(e)
            else this.releaseView(e)
        }
        list.length = w
    }

    private contactDamage(): void {
        const p = this.player
        if (!p.alive || p.iframes > 0) return
        this.grid.query(p.x, p.y, p.radius, e => {
            if (e.untargetable || e.damage <= 0) return
            const rr = e.radius * 0.85 + p.radius
            const dx = e.x - p.x
            const dy = e.y - p.y
            if (dx * dx + dy * dy > rr * rr) return
            const taken = this.damagePlayer(e.damage, e.x, e.y)
            if (taken > 0 && e.affixes.length) {
                for (const id of e.affixes) {
                    try {
                        this.affix(id)?.onHitPlayer?.(e, this.api)
                    } catch {
                        // ignore content errors
                    }
                }
            }
            if (taken > 0 && this.meta.thorns > 0 && !e.dead) {
                const dx = e.x - p.x
                const dy = e.y - p.y
                const d = Math.hypot(dx, dy) || 1
                this.hit(e, this.meta.thorns * taken * 10, { knock: 700, kx: dx / d, ky: dy / d, noCrit: true, color: 0xd0d8e8 })
                this.fx.burst(p.x, p.y, { count: 10, color: 0xd0d8e8, tex: 'p.shard', speed: 420, life: 0.3, size: 8, angle: Math.atan2(dy, dx), spread: 1.4 })
                this.fx.ring(p.x, p.y, 0xd0d8e8, 8, 70, 0.25, 0.9)
            }
            return true
        })
    }

    private updateShots(dt: number): void {
        const p = this.player
        for (const s of this.shots) {
            if (!s.alive) continue
            s.age += dt
            s.life -= dt
            if (s.homing && p.alive) {
                const a = Math.atan2(s.vy, s.vx)
                let d = Math.atan2(p.y - s.y, p.x - s.x) - a
                d = Math.atan2(Math.sin(d), Math.cos(d))
                const na = a + Math.max(-s.homing * dt, Math.min(s.homing * dt, d))
                const sp = Math.hypot(s.vx, s.vy)
                s.vx = Math.cos(na) * sp
                s.vy = Math.sin(na) * sp
            }
            let k = 1
            for (const c of this.chronos) {
                if ((s.x - c.x) ** 2 + (s.y - c.y) ** 2 < c.r * c.r) {
                    k = 1 - c.shotSlow
                    break
                }
            }
            if (k < 1) s.life += dt * (1 - k)
            s.x += s.vx * dt * k
            s.y += s.vy * dt * k
            const rr = s.radius + p.radius * 0.75
            if (p.alive && (s.x - p.x) ** 2 + (s.y - p.y) ** 2 < rr * rr) {
                if (p.iframes <= 0) {
                    this.damagePlayer(s.damage, s.x, s.y)
                    s.life = 0
                } else if (p.dashT > 0) {
                    // Grazing a shot mid-dash feels great: spark it
                    if (Math.random() < 0.3) this.fx.one(s.x, s.y, 'p.spark', 0xffffff, 0, 0, 0.15, 5)
                }
            }
            if (s.life <= 0) {
                s.alive = false
                this.fx.burst(s.x, s.y, { count: 4, color: s.color, tex: 'p.dot', speed: 120, life: 0.25, size: 5 })
            }
        }
        let w = 0
        for (let i = 0; i < this.shots.length; i++) {
            const s = this.shots[i]!
            if (s.alive) {
                this.shots[w++] = s
                continue
            }
            this.shotPool.release(s.sprite)
            this.shotGlowPool.release(s.glow)
        }
        this.shots.length = w
    }

    private updateTeles(dt: number): void {
        const p = this.player
        for (let i = this.teles.length - 1; i >= 0; i--) {
            const t = this.teles[i]!
            t.t += dt
            if (t.t < t.delay) continue
            this.teles.splice(i, 1)
            let hitPlayer = false
            if (t.line) {
                const dx = t.x2 - t.x
                const dy = t.y2 - t.y
                const len2 = dx * dx + dy * dy || 1
                const u = Math.max(0, Math.min(1, ((p.x - t.x) * dx + (p.y - t.y) * dy) / len2))
                const cx = t.x + dx * u
                const cy = t.y + dy * u
                hitPlayer = Math.hypot(p.x - cx, p.y - cy) < t.w / 2 + p.radius * 0.6
                this.fx.lightning(t.x, t.y, t.x2, t.y2, t.color, Math.max(4, t.w * 0.4), 0.25, 0.25)
                const n = Math.min(10, Math.ceil(Math.sqrt(len2) / 60))
                for (let k = 0; k <= n; k++) this.fx.burst(t.x + (dx * k) / n, t.y + (dy * k) / n, { count: 2, color: t.color, tex: 'p.spark', speed: 220, life: 0.3, size: 6 })
            } else {
                hitPlayer = Math.hypot(p.x - t.x, p.y - t.y) < t.r + p.radius * 0.6
                this.fx.sprite('glow', t.x, t.y, { life: 0.3, color: t.color, size0: t.r * 1.2, size1: t.r * 2.4, a0: 0.8 })
                this.fx.ring(t.x, t.y, t.color, t.r * 0.4, t.r * 1.05, 0.3, 0.9)
                this.fx.burst(t.x, t.y, { count: Math.min(24, 6 + t.r / 8), color: t.color, tex: 'p.spark', speed: t.r * 4, life: 0.35, size: 7 })
            }
            const onScreen = Math.abs(t.x - p.x) < this.view.width / 2 + 100 && Math.abs(t.y - p.y) < this.view.height / 2 + 100
            if (onScreen) {
                this.shake(0.12)
                this.play('explosion', { volume: 0.45, pitch: 1.1, pan: this.pan(t.x) }, 0.07)
            }
            if (hitPlayer) this.damagePlayer(t.damage, t.x, t.y)
        }
    }

    // ─── End of run ──────────────────────────────────────────────────────

    private beginEnd(victory: boolean): void {
        if (this.ending || this.over) return
        if (!victory && this.victoryLocked) return
        this.ending = { t: 0, victory }
        this.menu = null
        this.levelFxT = 0
        const p = this.player
        if (victory) {
            this.player.iframes = 99
            this.overlay.announce('THE RIFT IS SEALED', 0xffd54f, 64)
            this.flash(0xffffff, 0.8)
            this.slowMo(0.35, 2)
            for (const e of this.enemies) {
                if (e.dead) continue
                e.dead = true
                e.deathT = 0
                this.fx.burst(e.x, e.y, { count: 6, color: e.def.glow ?? 0xffffff, tex: 'p.dot', speed: 200, life: 0.5, size: 6 })
            }
            for (const s of this.shots) s.life = 0
            this.teles.length = 0
        } else {
            p.alive = false
            this.slowMo(0.25, 2.5)
            this.flash(0xff1a2a, 0.6)
            this.shake(1)
            this.chromaAmt = 1
            this.fx.burst(p.x, p.y, { count: 60, color: this.cls.color, tex: 'p.dot', speed: 500, life: 1, size: 9 })
            this.fx.burst(p.x, p.y, { count: 30, color: 0xff3a4a, tex: 'p.spark', speed: 700, life: 0.6, size: 9 })
            this.fx.ring(p.x, p.y, 0xff3a4a, 10, 260, 0.8, 1)
            this.zoomMul = 1.18
        }
    }

    private finish(): void {
        if (this.over) return
        this.over = true
        this.menu = null
        this.emitHud()
        this.events.onGameOver(this.result())
    }

    forfeit(): void {
        if (this.over) return
        this.paused = false
        // Once the Rift Heart is down the run is won: forfeiting just skips the victory animation
        if (this.victoryLocked || this.ending?.victory) {
            if (!this.ending) this.beginEnd(true)
            this.finish()
            return
        }
        if (!this.ending) this.beginEnd(false)
        this.ending!.victory = false
        this.finish()
    }

    private result(): RunResult {
        return {
            time: Math.floor(this.time),
            kills: this.kills,
            eliteKills: this.eliteKills,
            bossKills: this.bossKills,
            level: this.level,
            shards: this.shards,
            victory: !!this.ending?.victory,
            classId: this.cls.id,
            weapons: this.weaponItems(),
            passives: this.passiveItems(),
            damageDealt: Math.round(this.damageDealt),
            highestCombo: this.highestCombo,
            abilities: this.abilityItems(),
            damageBySource: this.damageShares(),
            biome: this.runBiome()
        }
    }

    private abilityItems(): HudAbility[] {
        return this.abilities.map((a, i) => {
            const max = this.abilityMax(a)
            const ready = a.charges > 0
            return {
                id: a.def.id,
                name: a.def.name,
                icon: a.def.icon,
                color: a.def.color,
                key: ABILITY_KEYS[i] ?? '',
                level: a.level,
                maxLevel: ABILITY_MAX_LEVEL,
                cooldown: ready ? 0 : a.cdMax > 0 ? Math.min(1, Math.max(0, a.cd / a.cdMax)) : 0,
                cooldownSeconds: ready ? 0 : Math.max(0, a.cd),
                active: a.def.active ? a.def.active(a) : false,
                charges: a.charges,
                maxCharges: max,
                rechargeSeconds: a.charges < max ? Math.max(0, a.cd) : 0
            }
        })
    }

    private damageShares(): DamageShare[] {
        const out: DamageShare[] = []
        for (const [key, dmg] of this.dmgBy) {
            if (dmg <= 0) continue
            if (key.startsWith('w:')) {
                const id = key.slice(2)
                const w = this.weapons.find(x => x.def.id === id)
                const def = WEAPON_DEFS[id]
                if (!def) continue
                const evo = !!w?.evolved
                out.push({ id, name: evo ? def.evo.name : def.name, icon: evo ? def.evo.icon : def.icon, color: evo ? def.evo.color : def.color, damage: Math.round(dmg), kind: 'weapon' })
            } else if (key.startsWith('a:')) {
                const def = ABILITY_DEFS[key.slice(2)]
                if (!def) continue
                out.push({ id: def.id, name: def.name, icon: def.icon, color: def.color, damage: Math.round(dmg), kind: 'ability' })
            } else if (key === 'ultimate') {
                out.push({ id: 'ultimate', name: this.cls.ultimate, icon: 'i-lucide-sparkles', color: this.cls.color, damage: Math.round(dmg), kind: 'ultimate' })
            } else {
                out.push({ id: 'other', name: 'Other', icon: 'i-lucide-flame-kindling', color: 0xb8b0c8, damage: Math.round(dmg), kind: 'other' })
            }
        }
        out.sort((a, b) => b.damage - a.damage)
        return out
    }

    // ─── Pause ───────────────────────────────────────────────────────────

    pause(): void {
        if (this.paused || this.over) return
        this.paused = true
        this.events.onPause(true)
    }

    resume(): void {
        if (!this.paused || this.over) return
        this.paused = false
        this.input.clearQueued()
        this.events.onPause(false)
    }

    // ─── HUD ─────────────────────────────────────────────────────────────

    private weaponItems(): HudItem[] {
        return this.weapons.map(w => ({
            id: w.def.id,
            name: w.evolved ? w.def.evo.name : w.def.name,
            icon: w.evolved ? w.def.evo.icon : w.def.icon,
            level: w.level,
            maxLevel: WEAPON_MAX_LEVEL,
            color: w.evolved ? w.def.evo.color : w.def.color,
            evolved: w.evolved
        }))
    }

    private passiveItems(): HudItem[] {
        return this.passives.map(p => {
            const def = PASSIVE_DEFS[p.id]!
            return { id: p.id, name: def.name, icon: def.icon, level: p.level, maxLevel: def.maxLevel, color: def.color, evolved: false }
        })
    }

    private runBiome(): RunBiome {
        return { id: this.biome.id, name: this.biome.name, index: this.biomeIndex }
    }

    private emitHud(): void {
        let boss: EnemyRt | null = null
        for (const e of this.enemies) if (e.boss && !e.dead && (!boss || e.maxHp > boss.maxHp)) boss = e
        // Rift Champions get the boss bar while no real boss is up
        if (!boss) for (const e of this.enemies) if (e.elite && !e.dead && e.def.id === 'champion' && (!boss || e.maxHp > boss.maxHp)) boss = e
        const report = { time: this.time, kills: this.kills, eliteKills: this.eliteKills, bossKills: this.bossKills, level: this.level, shards: this.shards, victory: !!this.ending?.victory }
        const riftXp = riftbornRunXp(riftbornSanitiseReport(report, (this.time + 5) * 1000))
        const next = RIFTBORN_BOSS_TIMES.find(t => t > this.time)
        const p = this.player
        const hud: RunHud = {
            hp: Math.max(0, Math.ceil(p.hp)),
            maxHp: Math.round(this.stats.maxHp),
            xp: Math.floor(this.xp),
            xpNext: this.xpNext,
            level: this.level,
            time: this.time,
            kills: this.kills,
            combo: this.comboT > 0 ? this.combo : 0,
            comboTimer: Math.max(0, this.comboT / COMBO_WINDOW),
            shards: this.shards,
            riftXp,
            weapons: this.weaponItems(),
            passives: this.passiveItems(),
            boss: boss ? { name: boss.def.name, hp: Math.max(0, Math.ceil(boss.hp)), maxHp: Math.ceil(boss.maxHp) } : null,
            dashCooldown: p.dashCdMax > 0 ? Math.min(1, p.dashCd / p.dashCdMax) : 0,
            ultimateCharge: this.ultCharge,
            ultimateName: this.cls.ultimate,
            revivals: this.revivals,
            nextBossIn: next === undefined ? null : next - this.time,
            abilities: this.abilityItems(),
            abilitySlots: this.slots,
            nextSlotAt: this.slots < ABILITY_SLOT_LEVELS.length ? ABILITY_SLOT_LEVELS[this.slots]! : null,
            biome: this.runBiome()
        }
        this.events.onHud(hud)
        try {
            this.sfx.setIntensity(Math.min(1, this.enemies.length / 450 + (boss ? 0.35 : 0)))
        } catch {
            // best effort
        }
    }

    // ─── Main loop ───────────────────────────────────────────────────────

    frame(deltaMS: number): void {
        const realDt = Math.min(0.05, Math.max(0, deltaMS / 1000))
        this.real += realDt
        this.frameAvg += (deltaMS - this.frameAvg) * 0.05
        if (this.frameAvg > 21) this.fx.quality = Math.max(0.35, this.fx.quality - realDt * 0.5)
        else if (this.frameAvg < 17.5) this.fx.quality = Math.min(1, this.fx.quality + realDt * 0.2)

        if (this.slowT > 0) this.slowT -= realDt
        const targetScale = this.ending ? (this.ending.victory ? 0.4 : 0.22) : this.slowT > 0 ? this.slowScale : 1
        this.timeScale += (targetScale - this.timeScale) * Math.min(1, realDt * 12)
        this.hitStopCd = Math.max(0, this.hitStopCd - realDt)

        const running = !this.paused && !this.menu && !this.over
        this.input.blocked = !running
        let simDt = 0
        if (running) {
            if (this.hitStopT > 0) this.hitStopT -= realDt
            else simDt = realDt * this.timeScale
        }
        if (this.levelFxT > 0 && !this.paused && !this.menu && !this.over) {
            this.levelFxT -= realDt
            if (this.levelFxT <= 0) this.openLevelUp()
        }
        if (simDt > 0) {
            this.fx.clearBeams()
            // A content bug must never freeze the run: Pixi only asks for the next frame after this returns
            try {
                this.step(simDt)
            } catch (err) {
                if (!this.stepErrLogged) {
                    this.stepErrLogged = true
                    console.error('[riftborn] step failed', err)
                }
            }
        }
        if (this.ending && !this.over) {
            this.ending.t += realDt
            if (this.ending.t > (this.ending.victory ? 2.2 : 1.8)) this.finish()
        }
        this.fx.update(simDt)
        this.render(realDt, running)
        this.hudT -= realDt
        if (this.hudT <= 0 && !this.over) {
            this.hudT = 1 / 15
            this.emitHud()
        }
    }

    private step(dt: number): void {
        this.time += dt
        const p = this.player

        this.updatePlayer(dt)
        if (this.travel) this.updateTravel(dt)
        this.updateAmbient(dt)
        // Every sim tick, endings included: the content's delayed effects ride on it
        try {
            this.director.update(this.api, dt)
        } catch {
            // the director must never stop the run
        }

        // Timers
        if (this.timers.length) {
            const due = this.timers.filter(t => t.t <= this.time)
            if (due.length) {
                this.timers = this.timers.filter(t => t.t > this.time)
                for (const t of due) {
                    try {
                        t.fn()
                    } catch {
                        // ignore
                    }
                }
            }
        }

        this.updateEnemies(dt)
        this.compactEnemies()
        this.grid.clear()
        for (const e of this.enemies) this.grid.insert(e)
        this.separate()

        if (p.alive && !this.ending) {
            for (let wi = 0; wi < this.weapons.length; wi++) {
                const w = this.weapons[wi]!
                try {
                    const s = weaponStats(this, w)
                    if (w.def.tick) w.def.tick(this, w, s, dt)
                    if (w.def.fire) {
                        w.timer -= dt * this.buffFire
                        if (w.timer <= 0) {
                            w.timer = s.cooldown * (this.combo >= 50 && this.comboT > 0 ? Math.max(0.3, 1 - this.meta.comboHaste) : 1)
                            if (wi === 0) {
                                const d = this.aimDir()
                                this.rig.attack(Math.atan2(d.y, d.x), p.facing)
                            }
                            w.def.fire(this, w, s)
                        }
                    }
                } catch {
                    // one broken weapon must not stop the others
                }
            }
            this.updateAbilities(dt)
        }
        this.updateProjectiles(dt)
        this.updateZones(dt)
        this.updateAllies(dt)
        this.updateShots(dt)
        this.updateTeles(dt)
        this.contactDamage()
        this.updatePickups(dt)
        this.compactEnemies()
        this.updateDying(dt)

        if (this.comboT > 0) {
            this.comboT -= dt
            if (this.comboT <= 0) {
                this.combo = 0
                this.streakIdx = 0
            }
        }
        this.magnetT = Math.max(0, this.magnetT - dt)
        if (this.meta.magnetPulse && p.alive) {
            this.magnetPulseT -= dt
            if (this.magnetPulseT <= 0) {
                this.magnetPulseT = 20
                this.vacuumGems()
                this.play('magnet', { volume: 0.55, pitch: 1.2 })
                this.fx.ring(p.x, p.y, 0x5aa8ff, 20, Math.max(this.view.width, this.view.height) * 0.75, 0.9, 0.8, true)
                this.fx.ring(p.x, p.y, 0x9fd0ff, 10, 140, 0.4, 0.8)
            }
        }
        if (this.bossCine) {
            this.bossCine.t += dt
            if (this.bossCine.t > 2.4 || this.bossCine.e.dead) this.bossCine = null
        }
        if (this.pendingLevels > 0 && !this.menu && this.levelFxT <= 0 && !this.ending && p.alive) this.startLevelFx()
    }

    // ─── Rendering ───────────────────────────────────────────────────────

    private render(dt: number, running: boolean): void {
        const W = this.app.screen.width
        const H = this.app.screen.height
        const p = this.player
        const L = this.L

        // Camera
        const base = Math.max(0.6, Math.min(1.25, Math.sqrt((W * H) / (1280 * 720))))
        let zoomTarget = 1
        let tx = p.x + p.vx * 0.2
        let ty = p.y + p.vy * 0.2
        const cine = this.bossCine
        if (cine && !cine.e.dead) {
            const k = Math.min(1, cine.t / 0.4) * (cine.t > 1.8 ? Math.max(0, (2.4 - cine.t) / 0.6) : 1)
            tx += (cine.e.x - tx) * 0.45 * k
            ty += (cine.e.y - ty) * 0.45 * k
            zoomTarget = 1 + 0.12 * k
        }
        if (this.ending && !this.ending.victory) zoomTarget = 1.15
        if (running || this.ending) {
            const f = 1 - Math.exp(-dt * 6)
            this.cam.x += (tx - this.cam.x) * f
            this.cam.y += (ty - this.cam.y) * f
        }
        this.zoomMul += (1 - this.zoomMul) * Math.min(1, dt * 4)
        const zoom = base * (zoomTarget + (this.zoomMul - 1))
        this.cam.zoom += (zoom - this.cam.zoom) * Math.min(1, dt * 5)
        const z = this.cam.zoom
        this.view.width = W / z
        this.view.height = H / z

        this.trauma = Math.max(0, this.trauma - dt * 1.7)
        const sh = this.trauma * this.trauma * 26
        const t = this.real
        const sx = sh * (Math.sin(t * 71.3) * 0.6 + Math.sin(t * 113.7) * 0.4)
        const sy = sh * (Math.sin(t * 83.1 + 1.3) * 0.6 + Math.sin(t * 127.9) * 0.4)
        const wx = W / 2 - this.cam.x * z + sx
        const wy = H / 2 - this.cam.y * z + sy
        L.world.position.set(wx, wy)
        L.world.scale.set(z)
        L.glowWorld.position.set(wx, wy)
        L.glowWorld.scale.set(z)
        L.worldTop.position.set(wx, wy)
        L.worldTop.scale.set(z)
        if (this.glowFilter) {
            // Bloom is the first thing to go when frames run long
            const want = this.fx.quality > 0.5
            const on = !!(L.glowRoot.filters && (L.glowRoot.filters as Filter[]).length)
            if (want !== on) L.glowRoot.filters = want ? [this.glowFilter] : []
            this.glowArea.width = W
            this.glowArea.height = H
            L.glowRoot.filterArea = this.glowArea
        }
        this.decor.update(this.cam.x, this.cam.y, W / z / 2, H / z / 2, this.real)
        for (const f of this.fogs) {
            f.x += (f.vx * dt) - (this.cam.x - this.lastCamX) * z * 0.6
            f.y += (f.vy * dt) - (this.cam.y - this.lastCamY) * z * 0.6
            const m = f.sc * 40
            f.x = ((f.x + m) % (W + m * 2) + (W + m * 2)) % (W + m * 2) - m
            f.y = ((f.y + m) % (H + m * 2) + (H + m * 2)) % (H + m * 2) - m
            f.s.position.set(f.x, f.y)
            f.s.scale.set(f.sc, f.sc * 0.6)
            f.s.alpha = f.a
        }
        L.floor.width = W
        L.floor.height = H
        L.floor.tileScale.set(z)
        L.floor.tilePosition.set(wx, wy)
        L.patches.width = W
        L.patches.height = H
        L.patches.tileScale.set(z * 4)
        L.patches.tilePosition.set(wx, wy)

        // Motes drift with parallax
        const cdx = this.cam.x - this.lastCamX
        const cdy = this.cam.y - this.lastCamY
        this.lastCamX = this.cam.x
        this.lastCamY = this.cam.y
        const amb = this.biome.ambient
        const fall = amb === 'snow' ? 70 : amb === 'embers' ? -55 : amb === 'spores' ? -14 : amb === 'storm' ? 12 : amb === 'void' ? 0 : 6
        const wind = amb === 'snow' ? 26 : amb === 'storm' ? 90 : 0
        const big = amb === 'snow' ? 1.6 : amb === 'void' ? 0.8 : 1
        const warp = this.travel && this.travel.phase === 'portal' ? Math.min(1, this.travel.t / 1.2) : 0
        for (const m of this.motes) {
            const sway = amb === 'embers' || amb === 'spores' ? Math.sin(t * 1.7 + m.ph) * 14 : 0
            m.x += -cdx * z * m.d + (running ? dt * (wind + sway) * m.d : 0)
            m.y += -cdy * z * m.d + (running ? dt * fall * m.d : 0)
            if (warp > 0) {
                // Streak toward the portal at the screen centre
                m.x += (W / 2 - m.x) * dt * warp * 2.5
                m.y += (H / 2 - m.y) * dt * warp * 2.5
            }
            m.x = ((m.x % W) + W) % W
            m.y = ((m.y % H) + H) % H
            m.s.position.set(m.x, m.y)
            m.s.scale.set((0.12 + m.d * 0.35) * big)
            const flick = amb === 'embers' || amb === 'void' ? 0.5 + 0.5 * Math.sin(t * 5 + m.ph * 3) : 0.6 + 0.4 * Math.sin(t * 1.3 + m.ph)
            m.s.alpha = (0.12 + m.d * 0.35) * flick * (amb === 'snow' ? 1.5 : 1)
        }

        const vw = this.view.width / 2 + 120
        const vh = this.view.height / 2 + 120
        const visible = (x: number, y: number, r = 0) => Math.abs(x - this.cam.x) < vw + r && Math.abs(y - this.cam.y) < vh + r

        this.renderHero(dt, running)
        this.renderEnemies(visible)

        // Projectiles
        for (const pr of this.projectiles) {
            const on = visible(pr.x, pr.y, 60)
            if (pr.sprite.texture !== Texture.EMPTY) {
                pr.sprite.visible = on
                if (on) {
                    pr.sprite.position.set(pr.x, pr.y)
                    pr.sprite.scale.set(pr.scale)
                    if (pr.faceVel) pr.sprite.rotation = Math.atan2(pr.vy, pr.vx)
                    else if (pr.spin && running) pr.sprite.rotation += pr.spin * dt * this.timeScale
                }
            }
            if (pr.glow) {
                pr.glow.visible = on
                if (on) pr.glow.position.set(pr.x, pr.y)
            }
        }

        // Pickups
        for (const k of this.pickups) {
            const on = visible(k.x, k.y, 40)
            k.sprite.visible = on
            if (k.shadow) k.shadow.visible = on
            if (!on) continue
            const bob = k.kind === 'gem' ? 0 : Math.sin(k.age * 4) * 3 - 4
            k.sprite.position.set(k.x, k.y + bob)
            if (k.kind === 'gem') {
                k.sprite.rotation = Math.sin(k.age * 3 + k.x) * 0.18
                const pulse = k.tier >= 2 ? 1 + Math.sin(k.age * 6) * 0.08 : 1
                const grow = Math.min(1, k.age * 6) * pulse
                // Fake spin: the facets turn edge-on and back
                k.sprite.scale.set(grow * (0.55 + 0.45 * Math.abs(Math.cos(k.age * 2.2 + k.y * 0.05))), grow)
                if (running && !k.attract && this.fx.quality > 0.7 && Math.random() < 0.012 * (1 + k.tier)) {
                    this.fx.one(k.x + (Math.random() - 0.5) * 10, k.y - 4 + (Math.random() - 0.5) * 10, 'p.star', 0xffffff, 0, -10, 0.35, 7 + k.tier * 2, { grow: 0.1 })
                }
            } else if (k.kind === 'chest') {
                const drop = Math.min(1, k.age * 3)
                k.sprite.scale.set(easeOutBack(drop) * (1 + Math.sin(k.age * 5) * 0.04))
                k.fxT -= dt
                if (k.fxT <= 0 && running) {
                    k.fxT = 0.12
                    this.fx.one(k.x + (Math.random() - 0.5) * 30, k.y, 'p.star', k.boss ? 0xff6ad5 : 0xffd54f, 0, -80, 0.7, 7)
                }
            } else {
                k.sprite.scale.set(Math.min(1, k.age * 5) * (1 + Math.sin(k.age * 6) * 0.06))
            }
            if (k.shadow) {
                k.shadow.position.set(k.x, k.y + 12)
                k.shadow.scale.set(0.5)
                k.shadow.alpha = 0.6
            }
        }

        // Allies
        for (const a of this.allies) {
            a.sprite.position.set(a.x, a.y - 6 + Math.sin(a.life * 10) * (a.kind === 'wraith' ? 3 : 1))
            a.sprite.scale.set(a.facing, 1)
            a.sprite.zIndex = a.y
            a.sprite.alpha = Math.min(1, a.life * 2) * (a.kind === 'skeleton' ? 1 : 0.85)
            a.shadow.position.set(a.x, a.y + 12)
            a.shadow.scale.set(0.45)
            a.shadow.alpha = a.kind === 'wraith' ? 0.3 : 0.6
        }

        // Enemy shots
        for (const s of this.shots) {
            const on = visible(s.x, s.y, 30)
            s.sprite.visible = on
            s.glow.visible = on
            if (!on) continue
            s.sprite.position.set(s.x, s.y)
            const k = s.kind ?? 'orb'
            if (k === 'orb' || k === 'fire') {
                s.sprite.scale.set((s.radius / 6) * (1 + Math.sin(s.age * 20) * 0.08))
                s.sprite.rotation += dt * 4
            } else {
                s.sprite.rotation = Math.atan2(s.vy, s.vx)
                s.sprite.scale.set(Math.max(0.6, s.radius / 5))
            }
            s.glow.position.set(s.x, s.y)
            if (k === 'fire' && running && Math.random() < 0.3) this.fx.one(s.x, s.y, 'p.flame', s.color, 0, 0, 0.25, 8)
        }

        // Zones
        for (const zn of this.zones) {
            const life = zn.life - zn.age
            const fade = Math.min(1, zn.age / 0.2, life / 0.3)
            const pulse = 1 + Math.sin(zn.age * 6) * 0.03
            zn.sprite.position.set(zn.x, zn.y)
            zn.ring.position.set(zn.x, zn.y)
            if (zn.kind === 'void') {
                const grow = Math.min(1, zn.age / 0.4)
                zn.sprite.scale.set(((zn.radius * 0.7) / 128) * grow * pulse)
                zn.sprite.rotation -= dt * 3
                zn.sprite.alpha = fade
                zn.ring.scale.set((zn.radius / 120) * (1 - ((zn.age * 0.8) % 1) * 0.6))
                zn.ring.rotation += dt * 2
                zn.ring.alpha = fade * 0.8
            } else if (zn.kind === 'storm') {
                zn.sprite.scale.set(((zn.radius * 2) / 128) * pulse)
                zn.sprite.alpha = fade * 0.12
                zn.ring.scale.set(zn.radius / 122)
                zn.ring.rotation += dt
                zn.ring.alpha = fade * 0.55
            } else {
                zn.sprite.scale.set(((zn.radius * 2) / 128) * pulse)
                zn.sprite.alpha = fade * (zn.kind === 'rift' ? 0.5 : 0.38)
                zn.ring.scale.set(zn.radius / 122)
                zn.ring.rotation += dt * 0.8
                zn.ring.alpha = fade * 0.5
            }
        }

        this.renderTeles()

        // Chromatic aberration pulse
        this.chromaAmt = Math.max(0, this.chromaAmt - dt * 3.2)
        if (this.chroma && this.chromaAmt > 0.04) {
            const u = this.chroma.resources.chromaUniforms as UniformGroup
            u.uniforms.uStrength = this.chromaAmt * this.chromaAmt * 6 * this.app.renderer.resolution
            if (!L.scene.filters || (L.scene.filters as Filter[]).length === 0) {
                L.scene.filters = [this.chroma]
            }
            L.scene.filterArea = new Rectangle(0, 0, W, H)
        } else if (L.scene.filters && (L.scene.filters as Filter[]).length) {
            L.scene.filters = []
        }

        const ready = this.ultCharge >= 1 && p.alive
        this.overlay.ultGlow += ((ready ? 1 : 0) - this.overlay.ultGlow) * Math.min(1, dt * 4)
        this.overlay.ultColor = this.cls.color
        this.renderTravel(dt)
        this.renderHurt(dt)
        this.overlay.update(dt, W, H, p.alive ? p.hp / this.stats.maxHp : 0, t)
    }

    // ─── Biomes ──────────────────────────────────────────────────────────

    private applyMotes(): void {
        const b = this.biome
        const tex = this.atlas.get(b.ambient === 'void' ? 'p.star' : 'p.dot')
        for (let i = 0; i < this.motes.length; i++) {
            const m = this.motes[i]!
            m.s.texture = tex
            m.s.tint = b.motes[i % 2]!
        }
        for (let i = 0; i < this.fogs.length; i++) {
            const f = this.fogs[i]!
            f.s.tint = b.fog[i % 2]!
            f.a = (0.16 + (i % 3) * 0.05) * b.fogAlpha
        }
    }

    /** A non-final boss fell: sweep the loot, clear the field and open the portal */
    private beginTravel(bossId: string): void {
        const p = this.player
        if (this.travel || this.ending || this.over || this.victoryLocked || !p.alive) return
        // Another boss still up: fight on here, the next kill moves on
        if (this.enemies.some(o => o.boss && !o.dead)) return
        if (this.biome.id === 'rift') return
        const final = bossId === 'lichKing' || this.biomeIndex >= 3
        this.travel = { phase: 'sweep', t: 0, x: p.x, y: p.y, next: nextBiome(this.visited, final) }
        p.iframes = Math.max(p.iframes, 3)
        let fx = 0
        for (const o of this.enemies) {
            if (o.dead) continue
            o.dead = true
            o.deathT = 0
            if (fx++ < 80 && Math.abs(o.x - p.x) < this.view.width / 2 + 60 && Math.abs(o.y - p.y) < this.view.height / 2 + 60) {
                this.fx.burst(o.x, o.y, { count: 5, color: o.def.glow ?? 0xffffff, tex: 'p.dot', speed: 220, life: 0.45, size: 6 })
            }
        }
        for (const sh of this.shots) sh.life = 0
        this.teles.length = 0
        this.vacuumAll()
        this.play('magnet', { volume: 1, pitch: 0.8 })
        const R = Math.max(this.view.width, this.view.height)
        this.fx.ring(p.x, p.y, this.biome.color, 20, R * 0.8, 0.9, 1, true)
        this.fx.ring(p.x, p.y, 0xffffff, 10, R * 0.5, 0.6, 0.8)
        this.shake(0.4)
    }

    private vacuumAll(): void {
        this.magnetT = 3
        for (const k of this.pickups) {
            if (!k.alive || k.attract) continue
            k.attract = true
            k.speed = 650
            k.age = Math.max(k.age, 0.2)
        }
    }

    private updateTravel(dt: number): void {
        const tr = this.travel!
        const p = this.player
        tr.t += dt
        p.iframes = Math.max(p.iframes, 0.5)
        if (tr.phase === 'sweep') {
            this.vacuumAll()
            // Sparkle trails on the incoming loot
            for (const k of this.pickups) {
                if (k.alive && Math.random() < 0.25) this.fx.one(k.x, k.y, 'p.star', k.kind === 'gem' ? GEM_TIERS[k.tier]!.color : 0xffe27a, 0, 0, 0.3, 7)
            }
            const left = this.pickups.some(k => k.alive)
            if (tr.t > 2.4 || (!left && tr.t > 0.6)) {
                for (const k of this.pickups) if (k.alive) this.collect(k)
                tr.phase = 'portal'
                tr.t = 0
                tr.x = p.x
                tr.y = p.y
                this.play('ultimate', { volume: 0.9, pitch: 0.6 })
                this.play('bossRoar', { volume: 0.5, pitch: 1.6 })
                this.fx.ring(p.x, p.y, tr.next.color, 10, 220, 0.7, 1)
                this.slowMo(0.6, 0.5)
            }
            return
        }
        // Drawn into the portal
        p.x += (tr.x - p.x) * Math.min(1, dt * 6)
        p.y += (tr.y - p.y) * Math.min(1, dt * 6)
        p.vx = 0
        p.vy = 0
        if (tr.phase === 'portal') {
            const k = Math.min(1, tr.t / 1.7)
            this.zoomMul = Math.max(this.zoomMul, 1 + k * 0.3)
            this.trauma = Math.max(this.trauma, k * 0.35)
            const n = Math.floor(6 + k * 14)
            for (let i = 0; i < n; i++) {
                const a = Math.random() * TAU
                const r = 120 + Math.random() * 260
                const x = tr.x + Math.cos(a) * r
                const y = tr.y + Math.sin(a) * r * 0.7
                // Tangential + inward: a swirl
                const sp = 260 + k * 300
                const vx = (-Math.sin(a) * 0.9 - Math.cos(a) * 0.6) * sp
                const vy = (Math.cos(a) * 0.9 - Math.sin(a) * 0.6) * sp * 0.7
                this.fx.one(x, y, i % 3 ? 'p.spark' : 'p.star', i % 2 ? tr.next.color : this.biome.color, vx, vy, 0.45, 7 + k * 6)
            }
            if (Math.random() < dt * 6) {
                const a = Math.random() * TAU
                this.fx.lightning(tr.x, tr.y, tr.x + Math.cos(a) * 200, tr.y + Math.sin(a) * 140, tr.next.color, 2.5, 0.14, 1)
            }
            this.overlay.whiteColor = 0xffffff
            this.overlay.whiteout = Math.max(0, (tr.t - 1.2) / 0.5)
            if (tr.t >= 1.7) {
                tr.phase = 'warp'
                tr.t = 0
                this.overlay.whiteout = 1
                this.swapBiome(tr.next)
                this.play('explosion', { volume: 0.8, pitch: 0.5 })
            }
            return
        }
        if (tr.phase === 'warp') {
            this.overlay.whiteout = 1
            if (tr.t >= 0.3) {
                tr.phase = 'arrive'
                tr.t = 0
                this.overlay.stageBanner(this.biome.name, this.biome.color, '')
                this.play('levelUp', { volume: 0.7, pitch: 0.7 })
                this.fx.ring(p.x, p.y, this.biome.color, 20, 420, 0.9, 1)
                this.fx.burst(p.x, p.y, { count: 60, color: this.biome.color, tex: 'p.star', speed: 520, life: 0.9, size: 9 })
            }
            return
        }
        this.overlay.whiteout = Math.max(0, 1 - tr.t / 0.8)
        if (tr.t >= 2.4) {
            this.overlay.whiteout = 0
            this.travel = null
            p.iframes = Math.max(p.iframes, 1)
        }
    }

    private swapBiome(b: BiomeDef): void {
        this.biome = b
        this.biomeIndex++
        this.visited.push(b.id)
        const old = [this.floorTex, this.patchTex, this.vigTex]
        this.floorTex = Texture.from(makeBiomeFloor(b, 512))
        this.patchTex = Texture.from(makeBiomePatch(b, 256))
        this.vigTex = Texture.from(makeVignetteCanvas(b.vignette, 0.42, 0.95))
        this.floorTex.source.addressMode = 'repeat'
        this.patchTex.source.addressMode = 'repeat'
        this.L.floor.texture = this.floorTex
        this.L.patches.texture = this.patchTex
        this.overlay.setVignette(this.vigTex)
        for (const t of old) {
            const i = this.canvasTextures.indexOf(t)
            if (i >= 0) this.canvasTextures.splice(i, 1)
            t.destroy(true)
        }
        this.canvasTextures.push(this.floorTex, this.patchTex, this.vigTex)
        this.decor.setBiome(b, 7 + this.biomeIndex * 31)
        this.app.renderer.background.color = b.bg
        this.applyMotes()
        this.fx.clear()
        for (const o of this.enemies) o.dead = true
        for (const sh of this.shots) sh.life = 0
        this.teles.length = 0
    }

    /** Cosmetic weather per biome */
    private updateAmbient(dt: number): void {
        if (this.fx.quality < 0.45) return
        const amb = this.biome.ambient
        const p = this.player
        const hw = this.view.width / 2
        const hh = this.view.height / 2
        const rx = () => p.x + (Math.random() * 2 - 1) * hw
        const ry = () => p.y + (Math.random() * 2 - 1) * hh
        const col = this.biome.motes
        if (amb === 'embers' && Math.random() < dt * 14) {
            this.fx.one(rx(), ry(), Math.random() < 0.5 ? 'p.flame' : 'p.spark', col[Math.random() < 0.5 ? 0 : 1]!, (Math.random() - 0.5) * 30, -50 - Math.random() * 60, 1.1, 5 + Math.random() * 4)
        } else if (amb === 'spores' && Math.random() < dt * 8) {
            this.fx.one(rx(), ry(), 'p.dot', col[Math.random() < 0.5 ? 0 : 1]!, (Math.random() - 0.5) * 20, -18, 1.6, 6 + Math.random() * 5, { grow: 0.4 })
        } else if (amb === 'void' && Math.random() < dt * 6) {
            this.fx.one(rx(), ry(), 'p.star', col[Math.random() < 0.5 ? 0 : 1]!, 0, 0, 0.9, 8 + Math.random() * 8, { grow: 0.6 })
        } else if (amb === 'snow' && Math.random() < dt * 3) {
            this.fx.one(rx(), ry(), 'p.star', 0xffffff, 0, 0, 0.5, 6, { grow: 0.3 })
        }
        if (amb === 'storm') {
            this.ambientT -= dt
            if (this.ambientT <= 0 && !this.travel) {
                this.ambientT = 2.5 + Math.random() * 4
                const x = rx()
                const y = ry()
                this.fx.lightning(x + (Math.random() - 0.5) * 80, y - hh - 60, x, y, 0xbfe4ff, 4, 0.22, 1.4)
                this.fx.lightning(x, y - hh * 0.6, x + (Math.random() - 0.5) * 120, y, 0x7fc8ff, 2, 0.18, 1)
                this.fx.sprite('glow', x, y, { life: 0.4, color: 0x9fd8ff, size0: 120, size1: 200, a0: 0.7 })
                this.fx.ring(x, y, 0xbfe4ff, 6, 70, 0.3, 0.8)
                this.fx.scorch(x, y, 26, 0x000000, 4, 'burn')
                this.flash(0xbfe4ff, 0.12)
                this.play('zap', { volume: 0.35, pitch: 0.45, pan: this.pan(x) })
            }
        }
    }

    private renderTravel(dt: number): void {
        const tr = this.travel
        const P = this.portal
        const on = !!tr && tr.phase !== 'sweep'
        P.glow.visible = on
        P.ring.visible = on
        P.ring2.visible = on
        P.core.visible = on
        if (!tr || !on) return
        const open = tr.phase === 'portal' ? Math.min(1, tr.t / 0.6) : tr.phase === 'warp' ? 1 : Math.max(0, 1 - tr.t / 1.4)
        const s = easeOutBack(open) * (1 + Math.sin(this.real * 8) * 0.03)
        const col = tr.phase === 'arrive' ? this.biome.color : tr.next.color
        for (const sp of [P.glow, P.ring, P.ring2, P.core]) sp.position.set(tr.x, tr.y)
        P.glow.tint = col
        P.glow.scale.set(5 * s, 3.4 * s)
        P.glow.alpha = 0.55 * open
        P.ring.tint = col
        P.ring.scale.set(1.5 * s, 1.05 * s)
        P.ring.rotation += dt * 2.5
        P.ring.alpha = 0.9 * open
        P.ring2.tint = 0xffffff
        P.ring2.scale.set(1.1 * s, 0.77 * s)
        P.ring2.rotation -= dt * 4
        P.ring2.alpha = 0.6 * open
        P.core.tint = col
        P.core.scale.set(1.6 * s, 1.1 * s)
        P.core.rotation -= dt * 6
        P.core.alpha = open
    }

    /** HP bar under the hero after a hit, and arcs pointing at the damage source */
    private renderHurt(dt: number): void {
        const g = this.hpBar
        g.clear()
        const p = this.player
        if (!p.alive) {
            this.hurtDirs.length = 0
            return
        }
        const frac = Math.max(0, Math.min(1, p.hp / this.stats.maxHp))
        this.hpBarT = Math.max(0, this.hpBarT - dt)
        if (this.hpGhostT > 0) this.hpGhostT -= dt
        else this.hpGhost += (frac - this.hpGhost) * Math.min(1, dt * 5)
        if (this.hpGhost < frac) this.hpGhost = frac
        const show = frac < 0.35 ? 1 : Math.min(1, this.hpBarT / 0.4)
        if (show > 0.01) {
            const w = 46
            const h = 5
            const x = p.x - w / 2
            const y = p.y + HERO_FEET * 1.18 + 9
            const col = frac > 0.6 ? 0x5aff7a : frac > 0.35 ? 0xffd54f : 0xff3a4a
            g.roundRect(x - 1.5, y - 1.5, w + 3, h + 3, 3).fill({ color: 0x07040c, alpha: 0.8 * show })
            if (this.hpGhost > frac) g.rect(x + w * frac, y, w * (this.hpGhost - frac), h).fill({ color: 0xffe8e0, alpha: 0.85 * show })
            g.rect(x, y, w * frac, h).fill({ color: col, alpha: show })
            g.rect(x, y, w * frac, 1.5).fill({ color: 0xffffff, alpha: 0.35 * show })
        }
        for (let i = this.hurtDirs.length - 1; i >= 0; i--) {
            const d = this.hurtDirs[i]!
            d.t -= dt
            if (d.t <= 0) {
                this.hurtDirs.splice(i, 1)
                continue
            }
            const a = Math.min(1, d.t / 0.6) * Math.min(1, d.k)
            const r = 52
            const span = 0.5
            const cx = p.x
            const cy = p.y - 4
            g.arc(cx, cy, r, d.a - span, d.a + span).stroke({ width: 5, color: 0xff2a3a, alpha: 0.85 * a, cap: 'round' })
            g.arc(cx, cy, r + 5, d.a - span * 0.6, d.a + span * 0.6).stroke({ width: 2, color: 0xffa0a0, alpha: 0.6 * a, cap: 'round' })
            // Chevron at the tip
            const tx = cx + Math.cos(d.a) * (r + 14)
            const ty = cy + Math.sin(d.a) * (r + 14)
            const bx = cx + Math.cos(d.a) * (r + 4)
            const by = cy + Math.sin(d.a) * (r + 4)
            const nx = -Math.sin(d.a) * 8
            const ny = Math.cos(d.a) * 8
            g.poly([tx, ty, bx + nx, by + ny, bx - nx, by - ny]).fill({ color: 0xff3a4a, alpha: 0.9 * a })
        }
    }

    private renderHero(dt: number, running: boolean): void {
        const p = this.player
        const root = this.rig.root
        root.visible = p.alive
        this.heroShadow.visible = p.alive
        this.heroLight.visible = p.alive
        if (!p.alive) {
            this.heroBerserk.visible = false
            this.heroUlt.visible = false
            this.heroUltRing.visible = false
            this.heroShield.visible = false
            this.heroShieldRing.visible = false
            return
        }
        this.levelGlowT = Math.max(0, this.levelGlowT - dt)
        const aim = this.aimDir()
        const ready = this.ultCharge >= 1
        const buffed = this.buffs.length > 0
        this.rig.update(running ? dt : 0, {
            moving: p.moving,
            vx: p.vx * p.facing,
            vy: p.vy,
            speed: this.stats.moveSpeed,
            facing: p.facing,
            dashing: p.dashT > 0,
            hurt: Math.min(1, p.hurtT * 4),
            aim: Math.atan2(aim.y, aim.x),
            glow: Math.min(1, this.levelGlowT / 0.45),
            ultReady: ready,
            buffColor: buffed ? 0xff7a3a : 0,
            time: this.real
        })
        root.position.set(p.x, p.y)
        root.scale.set(p.facing * 1.18, 1.18)
        root.zIndex = p.y
        root.alpha = p.iframes > 0 && p.dashT <= 0 && p.iframes < 2.5 && this.shieldHp <= 0 ? (Math.floor(this.real * 20) % 2 ? 0.5 : 1) : 1
        this.heroShadow.position.set(p.x, p.y + HERO_FEET * 1.18)
        this.heroShadow.scale.set(0.78, 0.7)
        this.heroShadow.alpha = 0.95
        // A soft pool of class light around the hero
        this.heroLight.position.set(p.x, p.y + 10)
        this.heroLight.scale.set(3.6, 2.6)
        this.heroLight.alpha = 0.16 + (ready ? 0.06 : 0) + Math.sin(this.real * 2) * 0.02

        if (buffed && running && Math.random() < 0.5) this.fx.one(p.x + (Math.random() - 0.5) * 30, p.y + 14, 'p.flame', 0xff7a3a, 0, -140, 0.4, 9)

        const sh = this.shieldHp > 0
        this.heroShield.visible = sh
        this.heroShieldRing.visible = sh
        if (sh) {
            const frac = this.shieldMax > 0 ? this.shieldHp / this.shieldMax : 0
            const flick = this.shieldT < 1.2 ? (Math.floor(this.real * 14) % 2 ? 0.4 : 1) : 1
            this.heroShield.position.set(p.x, p.y - 2)
            this.heroShield.tint = 0xffe27a
            this.heroShield.alpha = (0.2 + frac * 0.2) * flick
            this.heroShield.scale.set(0.78 + Math.sin(this.real * 6) * 0.02)
            this.heroShieldRing.position.set(p.x, p.y - 2)
            this.heroShieldRing.tint = 0xfff2b0
            this.heroShieldRing.alpha = (0.5 + frac * 0.4) * flick
            this.heroShieldRing.rotation += dt * 1.2
            this.heroShieldRing.scale.set(0.42)
        }

        const missing = this.meta.berserk ? Math.max(0, 1 - p.hp / this.stats.maxHp) : 0
        this.heroBerserk.visible = missing > 0.05
        if (missing > 0.05) {
            this.heroBerserk.position.set(p.x, p.y)
            this.heroBerserk.tint = 0xff2a2a
            this.heroBerserk.alpha = (0.2 + missing * 0.55) * (0.8 + Math.sin(this.real * (4 + missing * 8)) * 0.2)
            this.heroBerserk.scale.set(0.7 + missing * 0.7)
            if (running && Math.random() < missing * 0.6) this.fx.one(p.x + (Math.random() - 0.5) * 34, p.y + 8, 'p.flame', 0xff3a2a, 0, -110, 0.45, 8)
        }

        this.heroUlt.visible = ready
        this.heroUltRing.visible = ready
        if (ready) {
            const pulse = 0.5 + Math.sin(this.real * 5) * 0.2
            this.heroUlt.position.set(p.x, p.y)
            this.heroUlt.tint = this.cls.color
            this.heroUlt.alpha = pulse
            this.heroUlt.scale.set(1.2 + Math.sin(this.real * 5) * 0.1)
            this.heroUltRing.position.set(p.x, p.y + HERO_FEET - 4)
            this.heroUltRing.tint = this.cls.color
            this.heroUltRing.alpha = 0.6
            this.heroUltRing.rotation += dt * 1.5
            this.heroUltRing.scale.set(0.36, 0.22)
            if (running && Math.random() < 0.45) {
                const a = Math.random() * TAU
                this.fx.one(p.x + Math.cos(a) * 26, p.y + 12 + Math.sin(a) * 10, 'p.star', this.cls.color, 0, -110, 0.6, 6)
            }
        }
    }

    private renderEnemies(visible: (x: number, y: number, r?: number) => boolean): void {
        const draw = (e: EnemyRt, dying: boolean) => {
            const v = e.view
            const on = visible(e.x, e.y, e.radius * 2)
            v.root.visible = on
            v.shadow.visible = on
            if (v.glow) v.glow.visible = on
            if (!on) {
                for (const ring of v.auras) ring.visible = false
                if (v.tag) v.tag.visible = false
                return
            }
            const n = e.frames.length
            const rate = e.def.frameRate || 6
            const f = n > 1 ? Math.floor(e.age * rate) % n : 0
            let scale = e.scale * e.sizeMul
            if (e.spawnT < 0.25 && !dying) scale *= easeOutBack(e.spawnT / 0.25)
            let alpha = e.alpha
            let white = e.flashT > 0
            if (dying) {
                const dur = e.boss ? 0.9 : e.elite ? 0.4 : 0.24
                const k = Math.min(1, e.deathT / dur)
                scale *= k < 0.3 ? 1 + k * 1.2 : 1.36 * (1 - (k - 0.3) / 0.7)
                alpha *= 1 - k * 0.6
                white = k < 0.45
            }
            v.body.texture = white ? e.whites[f]! : e.frames[f]!
            v.root.position.set(e.x, e.y)
            if (e.def.rotate) {
                const sp = Math.hypot(e.vx, e.vy)
                if (sp > 5) v.root.rotation = Math.atan2(e.vy, e.vx)
                v.root.scale.set(scale)
            } else {
                // A little waddle on top of the baked frames
                const wob = dying ? 0 : Math.sin(e.age * 9 + e.uid) * 0.035
                v.root.scale.set(scale * (e.facing < 0 ? -1 : 1) * (1 + wob), scale * (1 - wob))
            }
            v.root.alpha = alpha
            v.root.zIndex = e.y
            let tint = 0xffffff
            if (e.freezeT > 0) tint = 0x8fd0ff
            else if (e.burnT > 0) tint = Math.floor(e.age * 10) % 2 ? 0xffb080 : 0xffd0a0
            else if (e.slowT > 0) tint = 0xc0d8ff
            else if (e.stunT > 0) tint = 0xfff0a0
            v.body.tint = white ? 0xffffff : tint
            if (v.outline.visible) {
                v.outline.texture = e.whites[f]!
                v.outline.scale.set(1.14)
                v.outline.alpha = 0.55 + Math.sin(e.age * 6) * 0.3
            }
            const sr = (e.radius * 2.3) / 64
            v.shadow.position.set(e.x, e.y + e.radius * 0.75 * e.scale)
            v.shadow.scale.set(sr * e.scale, sr * e.scale)
            v.shadow.alpha = 0.55 * alpha * (e.untargetable ? 0.4 : 1)
            if (v.glow) {
                v.glow.position.set(e.x, e.y)
                const gs = (e.radius * (e.boss ? 4 : e.elite ? 4.2 : 3.2) * e.scale) / 128
                v.glow.scale.set(gs * (1 + Math.sin(e.age * 4) * 0.06))
                v.glow.alpha = (e.elite ? 0.55 : 0.4) * alpha
            }
            for (let i = 0; i < v.auras.length; i++) {
                const ring = v.auras[i]!
                ring.visible = true
                ring.position.set(e.x, e.y + e.radius * 0.35)
                const r = e.radius * (1.35 + i * 0.32) * (1 + Math.sin(e.age * 3 + i * 2) * 0.05)
                ring.scale.set(r / 122, (r / 122) * 0.55)
                ring.rotation = 0
                ring.alpha = (0.55 + Math.sin(e.age * 5 + i) * 0.2) * alpha
            }
            if (v.tag) {
                v.tag.visible = !dying
                v.tag.position.set(e.x, e.y - e.radius * e.scale * 1.15 - 10)
                v.tag.alpha = alpha
            }
        }
        for (const e of this.enemies) draw(e, false)
        for (const e of this.dying) draw(e, true)
    }

    private renderTeles(): void {
        const g = this.L.tele
        g.clear()
        for (const t of this.teles) {
            const k = Math.min(1, t.t / t.delay)
            const blink = k > 0.75 ? (Math.floor(t.t * 18) % 2 ? 1 : 0.5) : 1
            if (t.line) {
                const dx = t.x2 - t.x
                const dy = t.y2 - t.y
                const len = Math.hypot(dx, dy) || 1
                const nx = (-dy / len) * (t.w / 2)
                const ny = (dx / len) * (t.w / 2)
                g.poly([t.x + nx, t.y + ny, t.x2 + nx, t.y2 + ny, t.x2 - nx, t.y2 - ny, t.x - nx, t.y - ny]).fill({ color: t.color, alpha: 0.1 * blink })
                g.poly([t.x + nx, t.y + ny, t.x2 + nx, t.y2 + ny, t.x2 - nx, t.y2 - ny, t.x - nx, t.y - ny]).stroke({ width: 2, color: t.color, alpha: 0.7 * blink })
                const fx = t.x + dx * k
                const fy = t.y + dy * k
                g.poly([t.x + nx, t.y + ny, fx + nx, fy + ny, fx - nx, fy - ny, t.x - nx, t.y - ny]).fill({ color: t.color, alpha: 0.28 * blink })
            } else {
                g.circle(t.x, t.y, t.r).fill({ color: t.color, alpha: 0.1 * blink })
                g.circle(t.x, t.y, t.r).stroke({ width: 2.5, color: t.color, alpha: 0.75 * blink })
                g.circle(t.x, t.y, Math.max(1, t.r * k)).fill({ color: t.color, alpha: 0.3 * blink })
            }
        }
    }

    destroy(): void {
        this.over = true
        for (const w of this.weapons) w.def.cleanup?.(this, w)
        for (const a of this.abilities) {
            try {
                if (a.ctx) a.def.cleanup?.(a.ctx, a)
            } catch {
                // ignore
            }
        }
        this.fx.clear()
        this.overlay.destroy()
        this.L.scene.filters = []
        this.chroma?.destroy()
        this.L.glowRoot.filters = []
        this.glowFilter?.destroy()
        this.L.scene.destroy({ children: true })
        this.atlas.destroy()
        for (const t of this.canvasTextures) t.destroy(true)
        this.canvasTextures.length = 0
    }
}

