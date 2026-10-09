<script setup lang="ts">
import type { BattleDemo, RunParty, StagePack, StageFight, StageRaid } from '~/utils/hero-quest-art/demo'
import type { Presenter } from '~/utils/hero-quest-art/canvas'
import type { RunFeed } from '~/utils/hero-quest-art/run-director'
import type { BandedFrame, SceneBackdrops } from '~/utils/hero-quest-art/menu-band'
import type { CollectionsHover, CollectionsScene, CollectionsView, DetailButton } from '~/utils/hero-quest-art/collections-scene'
import type { LoadoutButton, LoadoutsHover, LoadoutsScene, LoadoutsView } from '~/utils/hero-quest-art/loadouts-scene'
import type { PrestigeScene, PrestigeView } from '~/utils/hero-quest-art/prestige-scene'
import type { ClassesScene, ClassesView, KitTarget } from '~/utils/hero-quest-art/classes-scene'
import type { SpeedBlock, SpeedScene, SpeedView } from '~/utils/hero-quest-art/speed-scene'
import type { GachaButton, GachaHover, GachaScene, GachaSystemId, GachaView } from '~/utils/hero-quest-art/gacha-scene'
import type { SettingsScene, SettingsTarget, SettingsView } from '~/utils/hero-quest-art/settings-scene'
import type { CalendarScene, CalendarTarget, CalendarView } from '~/utils/hero-quest-art/calendar-scene'
import type { MilestonesScene, MilestonesTarget, MilestonesView } from '~/utils/hero-quest-art/milestones-scene'
import type { GuideTarget, GuideView } from '~/utils/hero-quest-art/guide'
import type { TraitsScene, TraitsTarget, TraitsView } from '~/utils/hero-quest-art/traits-scene'
import type { RaidRewardView, RaidRowView, RaidsHover, RaidsScene, RaidsView } from '~/utils/hero-quest-art/raids-scene'
import type { RaidId } from '#shared/utils/hero-quest/content/raids'
import { LOADOUT_NAME_MAX_LENGTH } from '#shared/utils/hero-quest/constants'
import { HQ_SETTING_DEFAULTS } from '#shared/utils/hero-quest/settings'
import { C, PALETTE } from '~/utils/hero-quest-art/palette'
import type { HqIntroRect } from '~/composables/useHqIntro'

/**
 * The battle, drawn. Presentation only: the projected run (`useHqLiveRun`) says where the run is,
 * and the stage plays it, every body dropping when `killsFloat` crosses its kill.
 *
 * A boss fight is the server's: while `fight` is set the stage stops following the run and acts
 * out the fight's log instead, reporting how far it has played so the readout beside it keeps
 * pace. Clearing `fight` hands the stage back to the run, which by then has moved on.
 *
 * The stage is also the game's navigation: a band of icons under it opens the menu scenes.
 * An open scene draws over the battle, which plays on unseen beneath it, so closing the scene
 * shows the battle where it has got to rather than rebuilding it.
 *
 * The art is drawn from code, not loaded as images (`build-log.md` #33): the stage bakes the
 * world's strips when it is built, so it is rebuilt only when the world or the party changes,
 * and fed the run every frame otherwise. The engine is loaded on mount, as its own chunk, so no
 * other page carries the drawers.
 */
const props = defineProps<{
    run: {
        prestige: number
        world: number
        stage: number
        archetype: RunFeed['archetype']
        killsFloat: number
        killsRequired: number
        killsBeforeWipe: number | null
        packSize: number
        atBossGate: boolean
        farming: boolean
        walled: boolean
        recoverySeconds: number
        enemyHp: string
        secondsPerKill: number | null
    }
    hero: {
        classId: string
        level: number
        stats: { critChance: number, critMultiplier: string }
        /** The HP share `useHqLiveRun` keeps from rising mid-attempt; the readout's own when absent. */
        hpPct?: number
        /** The payload's power, for the profile badge's GPN. */
        power?: { gpn: string }
    }
    party: Omit<RunParty, 'classId'>
    fight?: StageFight | null
    /** Battle Speed in force now; a fight plays at its own speed from engage instead. */
    speed?: number
    /** A lost boss is back at its gate: the stage shows the button that fights it again. */
    challenge?: boolean
    /** The scene on the stage; the battle when none is open. */
    scene?: HqScene
    /** The Collections scene's open tab, that roster's entries in order, and that gacha's Essence. */
    collections?: CollectionsView
    /** A Collections equip or craft is on its way: the detail's buttons wait for it. */
    collectionsBusy?: boolean
    /** The Loadouts scene's slots, every one up to the maximum, locked ones included. */
    loadouts?: LoadoutsView
    /** A loadout save, apply or rename is on its way. */
    loadoutsBusy?: boolean
    /** The Prestige scene's shop: every track, and the two balances it spends. */
    prestige?: PrestigeView
    /** A shop purchase is on its way. */
    prestigeBusy?: boolean
    /** The Classes scene: the tree, and whether a class token is held. */
    classes?: ClassesView
    /** A class pick is on its way. */
    classesBusy?: boolean
    /** The Battle Speed scene: the running block and every block for sale. */
    speedView?: SpeedView
    /** A Battle Speed purchase is on its way. */
    speedBusy?: boolean
    /** The running block on the battle's HUD, e.g. `3X 12:04`; empty when none runs. */
    speedTag?: string
    /** The Gacha scene: the four banners, and the pull being revealed. */
    gacha?: GachaView
    /** A pull or a Seal purchase is on its way. */
    gachaBusy?: boolean
    /** Every raid's Keys and best, for the Raids scene. */
    raids?: readonly RaidRowView[]
    /** A raid round or quick-clear is on its way. */
    raidsBusy?: boolean
    /** Any Loadout is saved, for the Raids scene's preferred-Loadout picker. */
    loadoutsSaved?: boolean
    /** A raid round to play in place of the run; the stage goes back to the run once it is cleared. */
    raidRound?: StageRaid | null
    /** What a raid round or quick-clear paid, shown over the stage until its button is pressed. */
    raidReward?: RaidRewardView | null
    /** The Settings scene: every setting's current value. */
    settings?: SettingsView
    /** A setting change is on its way. */
    settingsBusy?: boolean
    /** The Calendar scene: every day's reward and state, and the make-ups. */
    calendar?: CalendarView
    /** A calendar claim is on its way. */
    calendarBusy?: boolean
    /** The Milestones scene: every track's next step and what's waiting. */
    milestones?: MilestonesView
    /** A milestone claim is on its way. */
    milestonesBusy?: boolean
    /** The menu buttons shown: Battle's ground aside, only the scenes open so far (`tutorials.ts`). */
    menuScenes?: readonly HqMenuScene[]
    /** Scenes opened and not visited yet: their buttons carry the red dot until they are. */
    newScenes?: readonly HqMenuScene[]
    /** The guide's dialog, while a tutorial is due. */
    guide?: GuideView | null
    /** The Traits scene: the board, the Sets and the save slots. */
    traits?: TraitsView
    /** A Roll, lock, store, load or save-slot purchase is on its way. */
    traitsBusy?: boolean
}>()

const emit = defineEmits<{
    /** Ten times a second while a fight plays: seconds played, and whether its result is up. */
    fightProgress: [progress: { time: number, done: boolean }]
    /** The run's pack as the stage shows it, when it changes; null outside a run's wave. */
    pack: [pack: StagePack | null]
    /** The challenge button was pressed: fight the boss again. */
    challenge: []
    /** A menu band button was pressed: the scene to show, or the battle when the open one closes. */
    scene: [scene: HqScene]
    /** A Collections detail button was pressed, for the entry it shows. */
    collectionAction: [action: DetailButton, id: string]
    /** A Collections tab was pressed. */
    collectionTab: [tab: HqCollectionTab]
    /** A loadout detail's Save or Apply was pressed, for its slot; a Save pressed mid-rename carries the typed name. */
    loadoutAction: [action: 'save' | 'apply', slotIndex: number, name?: string]
    /** A loadout's new name was entered. */
    loadoutRename: [slotIndex: number, name: string]
    /** A class in the tree was pressed: switch the Hero to it. */
    pickClass: [classId: string]
    /** The Ascendant's picks, after a skill in its kit was pressed. */
    setAscendantKit: [skillIds: string[]]
    /** A prestige-shop track's Buy button was pressed. */
    shopBuy: [upgradeId: string]
    /** A Battle Speed block's Buy button was pressed. */
    buySpeed: [speed: number, minutes: number]
    /** A gacha banner's button was pressed. */
    gachaAction: [system: GachaSystemId, button: GachaButton]
    /** The reveal board was pressed once every card had turned over. */
    gachaClose: []
    /** A setting's control was pressed. */
    setting: [target: SettingsTarget]
    /** A raid's enter or quick-clear button was pressed. */
    raidEnter: [raidId: RaidId]
    raidQuick: [raidId: RaidId]
    /** A raid's preferred-Loadout picker was pressed. */
    raidLoadout: [raidId: RaidId]
    /** The reward popup's button was pressed. */
    raidRewardClose: []
    /** Today's calendar cell, or the make-up button, was pressed. */
    claimCalendar: [makeup: boolean]
    /** The Calendar scene's holiday gift button was pressed. */
    claimHoliday: []
    /** A milestone card with steps waiting was pressed, or claim-all (null). */
    claimMilestones: [track: string | null]
    /** The guide's panel was pressed: the next page, or the tutorial closed on the last. */
    guideNext: []
    /** The guide's Skip button: the tutorial closed unread. */
    guideSkip: []
    /** A Traits button was pressed: Roll, a lock, a board's Save or Load, or a save slot's Buy. */
    traitAction: [target: TraitsTarget]
}>()

const wrap = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const cssSize = ref({ width: 0, height: 0 })
const ready = ref(false)

/**
 * Coming in from the splash or the prestige bridge: the box its iris shut on, read once here as
 * the stage mounts. The stage grows out of it, black, and opens its own iris once it has landed
 * and loaded.
 */
const intro = import.meta.client ? takeHqIntro() : null
const opening = ref(intro !== null)
const INK = PALETTE[C.ink]!
/** What the Traits scene draws before its payload lands. */
const EMPTY_TRAITS: TraitsView = {
    traitGems: '0', slots: [], rollCost: 0, rerolls: 0, affordable: false, sets: [], saves: [],
    saveCost: 0, saveAffordable: false, boardFull: false, gems: 0, armed: null
}
/** The smallest move in the pack's HP share worth a re-render of the readout: half a percent. */
const PACK_REPORT_STEP = 0.005

let stage: BattleDemo | null = null
let backdrops: SceneBackdrops | null = null
let banded: BandedFrame | null = null
let collectionsScene: CollectionsScene | null = null
let collectionsHit: typeof import('~/utils/hero-quest-art/collections-scene') | null = null
let loadoutsScene: LoadoutsScene | null = null
let loadoutsHit: typeof import('~/utils/hero-quest-art/loadouts-scene') | null = null
let prestigeScene: PrestigeScene | null = null
let prestigeHit: typeof import('~/utils/hero-quest-art/prestige-scene') | null = null
let classesScene: ClassesScene | null = null
let classesHit: typeof import('~/utils/hero-quest-art/classes-scene') | null = null
let speedScene: SpeedScene | null = null
let speedHit: typeof import('~/utils/hero-quest-art/speed-scene') | null = null
let gachaScene: GachaScene | null = null
let gachaHit: typeof import('~/utils/hero-quest-art/gacha-scene') | null = null
let settingsScene: SettingsScene | null = null
let settingsHit: typeof import('~/utils/hero-quest-art/settings-scene') | null = null
let raidsScene: RaidsScene | null = null
let raidsHit: typeof import('~/utils/hero-quest-art/raids-scene') | null = null
let calendarScene: CalendarScene | null = null
let calendarHit: typeof import('~/utils/hero-quest-art/calendar-scene') | null = null
let milestonesScene: MilestonesScene | null = null
let milestonesHit: typeof import('~/utils/hero-quest-art/milestones-scene') | null = null
let guideHit: typeof import('~/utils/hero-quest-art/guide') | null = null
let traitsScene: TraitsScene | null = null
let traitsHit: typeof import('~/utils/hero-quest-art/traits-scene') | null = null
/** The stage's clock, for the scene that times its own animation (the gacha reveal). */
let sceneTime = 0
let band: typeof import('~/utils/hero-quest-art/menu-band') | null = null
let presenter: Presenter | null = null
let stop: (() => void) | null = null
let observer: ResizeObserver | null = null
let disposed = false
/** What `pack` last said, so the readout hears of a change rather than every frame. */
let lastPack: StagePack | null = null

/** Pass the stage's pack on, once it has moved by a step the readout's bar can show. */
function reportPack() {
    const pack = props.fight ? null : stage!.runPack()
    const same = pack === null || lastPack === null
        ? pack === lastPack
        : pack.standing === lastPack.standing && Math.abs(pack.left - lastPack.left) < PACK_REPORT_STEP
    if (same) return
    lastPack = pack
    emit('pack', pack)
}

function feed(): RunFeed {
    const run = props.run
    const readout = battleReadout({
        killsInStage: run.killsFloat,
        killsRequired: run.killsRequired,
        killsBeforeWipe: run.killsBeforeWipe,
        packSize: run.packSize,
        atBossGate: run.atBossGate
    })
    return {
        prestige: run.prestige,
        world: run.world,
        stage: run.stage,
        archetype: run.archetype,
        killsFloat: run.killsFloat,
        killsRequired: run.killsRequired,
        packSize: run.packSize,
        atBossGate: run.atBossGate,
        farming: run.farming,
        walled: run.walled,
        recoverySeconds: run.recoverySeconds,
        enemyHp: run.enemyHp,
        secondsPerKill: run.secondsPerKill,
        critChance: props.hero.stats.critChance,
        critMultiplier: props.hero.stats.critMultiplier,
        heroHpPct: props.hero.hpPct ?? readout.heroHpPct,
        heroLevel: props.hero.level,
        gpn: props.hero.power?.gpn ?? null
    }
}

function fit() {
    if (!wrap.value || !presenter) return
    const width = wrap.value.getBoundingClientRect().width
    cssSize.value = presenter.fit(width, width * presenter.h / presenter.w, window.devicePixelRatio || 1)
}

// a new class or a changed party rebuilds the stage; everything else arrives through the feed
const partyKey = computed(() => [
    props.hero.classId,
    props.party.heroRow,
    ...props.party.champions.map(c => `${c.id}:${c.row}:${c.level}`)
].join('|'))

let builtKey = ''

function build() {
    if (!stage) return
    builtKey = partyKey.value
    stage.setupRun({ ...props.party, classId: props.hero.classId }, feed())
}

// a party changed mid-fight, or mid-raid, waits for it to be put away
watch(partyKey, () => {
    if (!props.fight && !props.raidRound) build()
})

// a level or an equip moves cooldowns; they change in place, without rebuilding the stage
watch(() => props.party.kits, (kits) => {
    if (kits) stage?.setKits(kits)
})

/**
 * How far the fight has played, reported to the readout. Read off the stage, or, before the
 * stage has loaded, off a clock of its own, so a fight never waits on the art to finish.
 */
let progressTimer: ReturnType<typeof setInterval> | null = null
let fallbackStart = 0
let skipped = false

function progress(): { time: number, done: boolean } {
    const fight = props.fight
    if (stage) return { time: stage.fightTime, done: stage.fightDone }
    const end = fight?.secondsElapsed ?? 0
    const time = skipped ? end : Math.min(end, (performance.now() - fallbackStart) / 1000 * (fight?.playbackSpeed ?? 1))
    return { time, done: time >= end }
}

watch(() => props.fight, (fight) => {
    if (progressTimer) clearInterval(progressTimer)
    progressTimer = null
    if (!fight) {
        stage?.endFight()
        if (partyKey.value !== builtKey) build()
        return
    }
    fallbackStart = performance.now()
    skipped = false
    stage?.playFight(fight)
    progressTimer = setInterval(() => emit('fightProgress', progress()), 100)
})

/** A raid round plays in place of the run, reporting how far it has played as a boss fight does; cleared, the run comes back. */
watch(() => props.raidRound, (round) => {
    if (progressTimer) clearInterval(progressTimer)
    progressTimer = null
    if (!round) {
        stage?.endRaid()
        return
    }
    skipped = false
    stage?.playRaid(round)
    progressTimer = setInterval(() => emit('fightProgress', progress()), 100)
})

/** Play the rest of the fight out at once. */
function skipFight() {
    skipped = true
    stage?.skipFight()
    emit('fightProgress', progress())
}

/**
 * Going out: close the stage's iris on the Hero and resolve with its box, for the next screen to
 * grow out of. Null when there is no stage up to close, or the player asked for less motion.
 */
function closeIris(): Promise<HqIntroRect | null> {
    const box = wrap.value
    if (!stage || !box || prefersReducedMotion()) return Promise.resolve(null)
    return new Promise(resolve => stage!.closeIris(() => resolve(rectOf(box))))
}

defineExpose({ skipFight, closeIris })

/**
 * The challenge button and the menu band live in the canvas, so the pointer is hit-tested against
 * them in the view's own pixels. The page's own Fight button stays the keyboard's way in.
 */
type Target = 'challenge' | HqMenuScene | `tab:${HqCollectionTab}` | `tile:${number}` | 'close' | DetailButton
    | `card:${number}` | `loadout:${LoadoutButton}` | `buy:${number}` | 'shop:prev' | 'shop:next' | `class:${string}` | KitTarget | `speed:${number}:${number}`
    | `gacha:${GachaSystemId}:${GachaButton | 'emblem'}` | 'reveal' | `setting:${SettingsTarget}` | `raid:${RaidId | 'enter' | 'quick' | 'loadout'}` | 'reward:ok' | `cal:${CalendarTarget}` | `ms:${MilestonesTarget}` | GuideTarget
    | `trait:${TraitsTarget}`

const DETAIL_BUTTONS: readonly DetailButton[] = ['equip', 'front', 'back', 'bench', 'craft']
const isDetailButton = (t: Target): t is DetailButton => DETAIL_BUTTONS.includes(t as DetailButton)
const hover = ref<Target | null>(null)
const pressed = ref(false)
const openScene = computed<HqScene>(() => props.scene ?? 'battle')

/** The Collections entry open in the detail view, by id; the grid when null. A tab or scene change shuts it. */
const detail = ref<string | null>(null)
watch([openScene, () => props.collections?.tab], () => {
    detail.value = null
})

/** The loadout slot open in the detail view; the cards when null. Leaving the scene shuts it, and any rename. */
const loadoutDetail = ref<number | null>(null)
watch(openScene, () => {
    loadoutDetail.value = null
    renaming.value = null
    kitOpen.value = false
})

/** The Ascendant's kit is open over the Classes scene. Leaving the scene, or the class, shuts it. */
const kitOpen = ref(false)
watch(() => props.classes?.classes.find(c => c.current)?.tier, (tier) => {
    if (tier !== 'capstone') kitOpen.value = false
})
const classesView = computed<ClassesView>(() => ({ ...(props.classes ?? { classes: [], token: false }), kitOpen: kitOpen.value }))

const openLoadout = computed(() => props.loadouts?.slots.find(slot => slot.slotIndex === loadoutDetail.value && !slot.locked) ?? null)

/**
 * Renaming takes a real text field, laid over the slot's name on the canvas (`renameBox`, in view
 * pixels, placed here as shares of the frame). Enter saves it; Escape or leaving the field drops it.
 */
const renaming = ref<{ slotIndex: number, text: string } | null>(null)
const renameInput = ref<HTMLInputElement | null>(null)
const renameStyle = ref<Record<string, string>>({})

async function startRename() {
    const slot = openLoadout.value
    if (!slot || !presenter || !loadoutsHit) return
    const box = loadoutsHit.renameBox()
    const scale = cssSize.value.height / presenter.h
    renameStyle.value = {
        left: `${box.x / presenter.w * 100}%`,
        top: `${box.y / presenter.h * 100}%`,
        width: `${box.w / presenter.w * 100}%`,
        height: `${box.h / presenter.h * 100}%`,
        fontSize: `${Math.max(10, box.h * scale * 0.6)}px`,
        backgroundColor: INK
    }
    renaming.value = { slotIndex: slot.slotIndex, text: slot.name }
    await nextTick()
    renameInput.value?.focus()
    renameInput.value?.select()
}

/** Send a typed name as a rename, unless it is blank or unchanged. */
function sendRename(r: { slotIndex: number, text: string }) {
    const name = r.text.trim()
    const current = props.loadouts?.slots.find(slot => slot.slotIndex === r.slotIndex)?.name
    if (name && name !== current) emit('loadoutRename', r.slotIndex, name)
}

function commitRename() {
    const r = renaming.value
    renaming.value = null
    if (r) sendRename(r)
}

/**
 * A press on the canvas takes the focus from the name field before the press is resolved, so the
 * typed name is held here until it is: a Save saves with it, anything else commits it as a rename.
 */
let draftAtPress: { slotIndex: number, text: string } | null = null

function targetAt(e: PointerEvent): Target | null {
    if (!canvas.value || !presenter) return null
    const r = canvas.value.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width * presenter.w
    const y = (e.clientY - r.top) / r.height * presenter.h
    // the reward popup takes every press: only its button does anything
    if (props.raidReward) return raidsHit?.onRaidRewardButton(presenter.w, sceneH, x, y) ? 'reward:ok' : null
    // the guide's panel sits over the scene: a press on it is the guide's
    const guideAt = props.guide && guideHit ? guideHit.guideTargetAt(x, y) : null
    if (guideAt) return guideAt
    // a raid round hides the menu, so a stray press can't walk out of it mid-fight
    const item = props.raidRound ? null : band?.menuItemAt(presenter.w, presenter.h, x, y, props.menuScenes) ?? null
    if (item) return item
    if (openScene.value === 'collections' && collectionsHit) {
        const tab = collectionsHit.collectionTabAt(presenter.w, x, y)
        // the open tab is a button only while the detail is up, back to the grid
        if (tab) return tab !== props.collections?.tab || detail.value ? `tab:${tab}` : null
        // the scene is the frame above the menu band
        const h = presenter.h - (band?.BAND_H ?? 0)
        if (detail.value) {
            if (collectionsHit.onDetailClose(presenter.w, h, x, y)) return 'close'
            const open = props.collections?.entries.find(e => e.id === detail.value)
            const button = open ? collectionsHit.detailButtonAt(presenter.w, h, open, x, y) : null
            // a button that cannot be pressed is no target
            return button?.enabled && !props.collectionsBusy ? button.id : null
        }
        const i = collectionsHit.collectionTileAt(presenter.w, h, props.collections?.entries.length ?? 0, x, y)
        return i === null ? null : `tile:${i}`
    }
    if (openScene.value === 'loadouts' && loadoutsHit) {
        const slot = openLoadout.value
        if (slot) {
            const button = loadoutsHit.loadoutButtonAt(x, y)
            // a button that cannot be pressed is no target
            return button && loadoutsHit.loadoutButtonEnabled(button, slot) && (button === 'close' || !props.loadoutsBusy) ? `loadout:${button}` : null
        }
        const i = loadoutsHit.loadoutCardAt(presenter.w, props.loadouts?.slots.length ?? 0, x, y)
        // a locked card does not open; the next one to buy goes to the prestige shop that sells it
        const card = i === null ? undefined : props.loadouts?.slots[i]
        return i !== null && card && (!card.locked || card.price) ? `card:${i}` : null
    }
    if (openScene.value === 'classes' && classesHit) {
        // the open kit covers the tree: only its skills and its done button
        if (kitOpen.value) return classesHit.kitTargetAt(classesView.value, x, y)
        // any class can be pointed at, for its description; only a pickable one is pressed
        const id = classesHit.classNodeAt(props.classes?.classes ?? [], x, y)
        return id ? `class:${id}` : null
    }
    if (openScene.value === 'prestige' && prestigeHit) {
        const tracks = props.prestige?.tracks ?? []
        const pages = Math.max(1, Math.ceil(tracks.length / prestigeHit.SHOP_PAGE_SIZE))
        const pager = pages > 1 ? prestigeHit.shopPagerAt(presenter.w, x, y) : null
        if (pager) return (pager === 'prev' ? shopPage.value > 0 : shopPage.value < pages - 1) ? `shop:${pager}` : null
        const first = shopPage.value * prestigeHit.SHOP_PAGE_SIZE
        const i = prestigeHit.shopBuyAt(presenter.w, Math.max(0, Math.min(prestigeHit.SHOP_PAGE_SIZE, tracks.length - first)), x, y)
        const track = i === null ? undefined : tracks[first + i]
        // a track that cannot be bought (maxed, or too dear) is no target
        return i !== null && track?.affordable && track.cost !== null && !props.prestigeBusy ? `buy:${first + i}` : null
    }
    if (openScene.value === 'raids' && raidsHit) {
        const at = raidsHit.raidsHoverAt(x, y)
        // the enter button waits for the fights; until then only the rows are pressed
        if (at === 'enter' || at === 'quick') return raidsHit.raidButtonEnabled(raidsView.value, at) ? `raid:${at}` : null
        if (at === 'loadout') return raidsHit.raidLoadoutEnabled(raidsView.value) ? 'raid:loadout' : null
        return at ? `raid:${at}` : null
    }
    if (openScene.value === 'settings' && settingsHit && props.settings) {
        const id = settingsHit.settingsTargetAt(presenter.w, x, y, settingsScroll.value)
        // a control that cannot be pressed is no target
        return id && !props.settingsBusy && settingsHit.settingsTargetEnabled(props.settings, id) ? `setting:${id}` : null
    }
    if (openScene.value === 'gacha' && gachaHit && props.gacha) {
        const at = gachaHit.gachaHoverAt(props.gacha, presenter.w, x, y)
        if (at === 'reveal') return 'reveal'
        if (!at) return null
        // the emblem is pointed at for the rates; a button that cannot be pressed is no target
        if (at.part === 'emblem') return `gacha:${at.system}:emblem`
        const banner = props.gacha.banners.find(b => b.system === at.system)
        return banner && !props.gachaBusy && gachaHit.gachaButtonEnabled(banner, at.part) ? `gacha:${at.system}:${at.part}` : null
    }
    if (openScene.value === 'milestones' && milestonesHit && props.milestones) {
        const at = milestonesHit.milestonesTargetAt(props.milestones, presenter.w, x, y)
        // claim-all is no target with nothing waiting; a card is pointed at for what it pays
        if (at === 'all') return !props.milestonesBusy && milestonesHit.milestonesClaimAllEnabled(props.milestones) ? 'ms:all' : null
        return at ? `ms:${at}` : null
    }
    if (openScene.value === 'traits' && traitsHit && props.traits) {
        // anything on the board is pointed at for what it is; only what can be pressed is pressed
        const at = traitsHit.traitsTargetAt(props.traits, presenter.w, x, y)
        return at ? `trait:${at}` : null
    }
    if (openScene.value === 'calendar' && calendarHit && props.calendar) {
        const at = calendarHit.calendarTargetAt(props.calendar, presenter.w, x, y)
        // the make-up button is no target with nothing to make up; a day is pointed at for what it pays
        if (at === 'makeup') return !props.calendarBusy && calendarHit.calendarMakeupEnabled(props.calendar) ? 'cal:makeup' : null
        if (at === 'claim') return props.calendarBusy ? null : 'cal:claim'
        // an open gift is a button; a claimed one is pointed at for what it paid, the next one for nothing
        if (at === 'gift') return props.calendar.gift?.state === 'claimed' || (props.calendar.gift?.state === 'open' && !props.calendarBusy) ? 'cal:gift' : null
        return at ? `cal:${at}` : null
    }
    if (openScene.value === 'speed' && speedHit && props.speedView) {
        const block = speedHit.speedBlockAt(props.speedView, x, y)
        // a block that cannot be bought (too dear, or another speed running) is no target
        return block && !props.speedBusy && speedHit.speedBlockOpen(props.speedView, block) ? `speed:${block.speed}:${block.minutes}` : null
    }
    return openScene.value === 'battle' && props.challenge && stage?.onChallenge(x, y) ? 'challenge' : null
}

/**
 * The Settings list's scroll, in stage pixels. A wheel scrolls it on a desktop; on a touch screen
 * a finger dragged more than `DRAG_SLOP` scrolls it instead of pressing what it started on.
 */
const settingsScroll = ref(0)
const DRAG_SLOP = 3
let drag: { pointer: number, y: number, scroll: number, moved: boolean } | null = null
/** The scene's height under the band, set once the stage is built. */
let sceneH = 0

const settingsScrollMax = () => settingsHit && presenter ? settingsHit.settingsMaxScroll(presenter.w, sceneH) : 0
const scrollsHere = computed(() => openScene.value === 'settings' && ready.value && settingsScrollMax() > 0)

function scrollSettings(to: number) {
    settingsScroll.value = Math.min(settingsScrollMax(), Math.max(0, to))
}

/** The pointer's height on the stage, in stage pixels. */
function stageY(e: PointerEvent | WheelEvent): number {
    const r = canvas.value!.getBoundingClientRect()
    return (e.clientY - r.top) / r.height * presenter!.h
}

function onWheel(e: WheelEvent) {
    if (!scrollsHere.value || !canvas.value || !presenter) return
    e.preventDefault()
    // lines and pages become pixels, then the page's pixels the stage's
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * canvas.value.clientHeight : e.deltaY
    scrollSettings(settingsScroll.value + px / canvas.value.getBoundingClientRect().height * presenter.h)
}

// a fresh visit starts at the top
watch(openScene, () => { settingsScroll.value = 0 })

function onPointerMove(e: PointerEvent) {
    if (drag && e.pointerId === drag.pointer && presenter) {
        const dy = stageY(e) - drag.y
        if (!drag.moved && Math.abs(dy) > DRAG_SLOP) {
            drag.moved = true
            pressed.value = false
            hover.value = null
        }
        if (drag.moved) {
            scrollSettings(drag.scroll - dy)
            return
        }
    }
    const was = hover.value
    hover.value = targetAt(e)
    if (hover.value !== was) pressed.value = false
}

function onPointerDown(e: PointerEvent) {
    // a finger on the list may be a scroll rather than a press: follow it, wherever it goes
    if (e.pointerType !== 'mouse' && scrollsHere.value && presenter && stageY(e) < sceneH) {
        drag = { pointer: e.pointerId, y: stageY(e), scroll: settingsScroll.value, moved: false }
        canvas.value?.setPointerCapture(e.pointerId)
    }
    if (renaming.value) {
        draftAtPress = { ...renaming.value }
        renaming.value = null
    }
    onPointerMove(e)
    pressed.value = hover.value !== null
}

function onPointerUp(e: PointerEvent) {
    const dragged = drag?.moved ?? false
    drag = null
    // a drag scrolled the list; it presses nothing where it let go
    if (dragged) {
        pressed.value = false
        hover.value = null
        return
    }
    const wasPressed = pressed.value
    onPointerMove(e)
    pressed.value = false
    const hit = hover.value
    const draft = draftAtPress
    draftAtPress = null
    if (draft) {
        // Save with the typed name in the one request; any other press keeps the name as a rename first
        if (wasPressed && hit === 'loadout:save' && openLoadout.value?.slotIndex === draft.slotIndex) {
            emit('loadoutAction', 'save', draft.slotIndex, draft.text.trim() || undefined)
            return
        }
        sendRename(draft)
    }
    if (!wasPressed || !hit) return
    const item = HQ_MENU_SCENES.find(s => s === hit)
    if (hit === 'challenge') emit('challenge')
    else if (item) emit('scene', item === openScene.value ? 'battle' : item)
    else if (hit === 'close') detail.value = null
    else if (hit === 'shop:prev' || hit === 'shop:next') shopPage.value += hit === 'shop:next' ? 1 : -1
    else if (hit.startsWith('class:')) {
        const node = props.classes?.classes.find(c => c.id === hit.slice(6))
        // the Ascendant, pressed as the current class, opens its kit
        if (node?.current && node.tier === 'capstone') kitOpen.value = true
        else if (node?.pickable && !node.current && !props.classesBusy) emit('pickClass', node.id)
    }
    else if (hit === 'kit:done') kitOpen.value = false
    else if (hit.startsWith('kit:')) {
        const ascendant = props.classes?.ascendant
        if (!ascendant || props.classesBusy || !classesHit) return
        const picks = classesHit.togglePick(ascendant, hit.slice(4))
        if (picks !== ascendant.picks) emit('setAscendantKit', [...picks])
    }
    else if (hit.startsWith('setting:')) emit('setting', hit.slice(8) as SettingsTarget)
    else if (hit === 'reward:ok') emit('raidRewardClose')
    else if (hit === 'cal:claim' || hit === 'cal:makeup') emit('claimCalendar', hit === 'cal:makeup')
    else if (hit === 'cal:gift') {
        if (props.calendar?.gift?.state === 'open' && !props.calendarBusy) emit('claimHoliday')
    }
    // a day other than today is only pointed at, for what it pays
    else if (hit.startsWith('cal:')) return
    else if (hit === 'guide:next') emit('guideNext')
    else if (hit === 'guide:skip') emit('guideSkip')
    else if (hit.startsWith('trait:')) {
        const target = hit.slice(6) as TraitsTarget
        if (traitsHit && props.traits && traitsHit.traitsTargetEnabled(props.traits, target, !!props.traitsBusy)) emit('traitAction', target)
    }
    else if (hit === 'ms:all') emit('claimMilestones', null)
    else if (hit.startsWith('ms:row:')) {
        // a card with nothing waiting is only pointed at, for what its next step pays
        const row = milestoneRowOf(hit)
        if (row?.claimable.length && !props.milestonesBusy) emit('claimMilestones', row.id)
    }
    else if (hit.startsWith('raid:')) {
        const id = hit.slice(5) as RaidId | 'enter' | 'quick' | 'loadout'
        if (id === 'enter') emit('raidEnter', raidSelected.value)
        else if (id === 'quick') emit('raidQuick', raidSelected.value)
        else if (id === 'loadout') emit('raidLoadout', raidSelected.value)
        else raidSelected.value = id
    }
    else if (hit === 'reveal') {
        // a press while the cards deal turns them all over; once they have, it puts the board away
        if (gachaScene && props.gacha && gachaScene.revealDone(props.gacha, sceneTime)) emit('gachaClose')
        else gachaScene?.skipReveal()
    }
    else if (hit.startsWith('gacha:')) {
        const [, system, part] = hit.split(':') as [string, GachaSystemId, GachaButton | 'emblem']
        if (part !== 'emblem') emit('gachaAction', system, part)
    }
    else if (hit.startsWith('speed:')) {
        const [, speed, minutes] = hit.split(':')
        emit('buySpeed', Number(speed), Number(minutes))
    }
    else if (hit.startsWith('buy:')) {
        const track = props.prestige?.tracks[Number(hit.slice(4))]
        if (track) emit('shopBuy', track.id)
    }
    else if (hit.startsWith('card:')) {
        const slot = props.loadouts?.slots[Number(hit.slice(5))]
        if (slot?.locked) emit('scene', 'prestige')
        else loadoutDetail.value = slot?.slotIndex ?? null
    }
    else if (hit.startsWith('loadout:')) {
        const button = hit.slice(8) as LoadoutButton
        const slot = openLoadout.value
        if (button === 'close') loadoutDetail.value = null
        else if (button === 'rename') void startRename()
        else if (slot) emit('loadoutAction', button, slot.slotIndex)
    }
    else if (isDetailButton(hit)) {
        if (detail.value) emit('collectionAction', hit, detail.value)
    }
    else if (hit.startsWith('tile:')) detail.value = props.collections?.entries[Number(hit.slice(5))]?.id ?? null
    else {
        const tab = hit.slice(4) as HqCollectionTab
        if (tab === props.collections?.tab) detail.value = null
        else emit('collectionTab', tab)
    }
}

function onPointerLeave() {
    drag = null
    hover.value = null
    pressed.value = false
    // a press that left the canvas still committed the name it took the focus from
    if (draftAtPress) sendRename(draftAtPress)
    draftAtPress = null
}

const challengeState = computed(() => !props.challenge ? 'off' as const : hover.value !== 'challenge' ? 'idle' as const : pressed.value ? 'pressed' as const : 'hover' as const)
const bandHover = computed(() => HQ_MENU_SCENES.find(s => s === hover.value) ?? null)
const collectionsHover = computed<CollectionsHover>(() => {
    const h = hover.value
    if (h === 'close' || (h && isDetailButton(h))) return h
    if (h?.startsWith('tile:')) return Number(h.slice(5))
    return HQ_COLLECTION_TABS.find(t => h === `tab:${t}`) ?? null
})
/** Whether a press on what the pointer is over does anything: a class that cannot be taken is only described. */
const pointer = computed(() => {
    const h = hover.value
    if (!h) return false
    if (h.endsWith(':emblem') || h.startsWith('cal:day:')) return false
    if (h.startsWith('ms:row:')) return !!milestoneRowOf(h)?.claimable.length
    if (h.startsWith('kit:') && h !== 'kit:done') {
        const ascendant = props.classes?.ascendant
        return !!ascendant && classesHit !== null && classesHit.togglePick(ascendant, h.slice(4)) !== ascendant.picks
    }
    if (h.startsWith('trait:')) return !!traitsHit && !!props.traits && traitsHit.traitsTargetEnabled(props.traits, h.slice(6) as TraitsTarget, !!props.traitsBusy)
    if (!h.startsWith('class:')) return true
    const node = props.classes?.classes.find(c => c.id === h.slice(6))
    return (!!node?.pickable && !node.current) || (!!node?.current && node.tier === 'capstone')
})
const classHover = computed(() => hover.value?.startsWith('class:') ? hover.value.slice(6) : hover.value?.startsWith('kit:') ? hover.value : null)

/** The shop's open page; it keeps its place while the scene is closed and reopened. */
const shopPage = ref(0)
const shopHover = computed(() => {
    const h = hover.value
    if (h === 'shop:prev' || h === 'shop:next') return h.slice(5) as 'prev' | 'next'
    // the hit is by track index; the scene marks cards by their place on the page
    return h?.startsWith('buy:') ? Number(h.slice(4)) - shopPage.value * (prestigeHit?.SHOP_PAGE_SIZE ?? 6) : null
})
const gachaHover = computed<GachaHover>(() => {
    const h = hover.value
    if (h === 'reveal') return 'reveal'
    if (!h?.startsWith('gacha:')) return null
    const [, system, part] = h.split(':') as [string, GachaSystemId, GachaButton | 'emblem']
    return { system, part }
})
/** The raid shown in the Raids scene; it keeps its place while the scene is closed and reopened. */
const raidSelected = ref<RaidId>('raid_training_grounds')
const raidsView = computed<RaidsView>(() => ({ selected: raidSelected.value, raids: props.raids ?? [], busy: !!props.raidsBusy, loadoutsSaved: !!props.loadoutsSaved }))
const raidsHover = computed<RaidsHover>(() => hover.value?.startsWith('raid:') ? hover.value.slice(5) as RaidsHover : null)
const settingsHover = computed<SettingsTarget | null>(() => hover.value?.startsWith('setting:') ? hover.value.slice(8) as SettingsTarget : null)
const calendarHover = computed<CalendarTarget | null>(() => hover.value?.startsWith('cal:') ? hover.value.slice(4) as CalendarTarget : null)
const milestonesHover = computed<MilestonesTarget | null>(() => hover.value?.startsWith('ms:') ? hover.value.slice(3) as MilestonesTarget : null)
const traitsHover = computed<TraitsTarget | null>(() => hover.value?.startsWith('trait:') ? hover.value.slice(6) as TraitsTarget : null)
/** The track a `ms:row:N` target points at. */
function milestoneRowOf(target: string) {
    return props.milestones?.rows[Number(target.slice(7))]
}
const guideHover = computed<GuideTarget | null>(() => hover.value === 'guide:next' || hover.value === 'guide:skip' ? hover.value : null)
/** The band's red dots: a scene opened and not visited yet, today's calendar reward or a holiday gift, or a milestone step waiting. */
const bandAlerts = computed<ReadonlySet<HqMenuScene>>(() => new Set<HqMenuScene>([
    ...(props.newScenes ?? []),
    ...(props.calendar?.days[props.calendar.today]?.state === 'today' || props.calendar?.gift?.state === 'open' ? ['calendar' as const] : []),
    ...(props.milestones?.rows.some(r => r.claimable.length > 0) ? ['milestones' as const] : [])
]))
const speedHover = computed<SpeedBlock | null>(() => {
    const h = hover.value
    if (!h?.startsWith('speed:')) return null
    const [, speed, minutes] = h.split(':')
    return { speed: Number(speed), minutes: Number(minutes) }
})
const loadoutsHover = computed<LoadoutsHover>(() => {
    const h = hover.value
    if (h?.startsWith('card:')) return Number(h.slice(5))
    if (h?.startsWith('loadout:')) return h.slice(8) as LoadoutButton
    return null
})

onMounted(async () => {
    // started before the engine loads, so the box never paints in its own place first
    const landed = intro && wrap.value ? growFrom(wrap.value, intro) : Promise.resolve()
    const [{ BattleDemo, CAMERAS }, { Presenter, startLoop }, menuBand, collectionsArt, loadoutsArt, prestigeArt, classesArt, speedArt, gachaArt, settingsArt, raidsArt, calendarArt, milestonesArt, guideArt, traitsArt] = await Promise.all([
        import('~/utils/hero-quest-art/demo'),
        import('~/utils/hero-quest-art/canvas'),
        import('~/utils/hero-quest-art/menu-band'),
        import('~/utils/hero-quest-art/collections-scene'),
        import('~/utils/hero-quest-art/loadouts-scene'),
        import('~/utils/hero-quest-art/prestige-scene'),
        import('~/utils/hero-quest-art/classes-scene'),
        import('~/utils/hero-quest-art/speed-scene'),
        import('~/utils/hero-quest-art/gacha-scene'),
        import('~/utils/hero-quest-art/settings-scene'),
        import('~/utils/hero-quest-art/raids-scene'),
        import('~/utils/hero-quest-art/calendar-scene'),
        import('~/utils/hero-quest-art/milestones-scene'),
        import('~/utils/hero-quest-art/guide'),
        import('~/utils/hero-quest-art/traits-scene')
    ])
    if (disposed || !canvas.value) return
    band = menuBand
    backdrops = new menuBand.SceneBackdrops(CAMERAS.zoom3)
    sceneH = CAMERAS.zoom3.h
    banded = new menuBand.BandedFrame(CAMERAS.zoom3.w, CAMERAS.zoom3.h)
    collectionsScene = new collectionsArt.CollectionsScene(backdrops)
    collectionsHit = collectionsArt
    loadoutsScene = new loadoutsArt.LoadoutsScene(backdrops)
    loadoutsHit = loadoutsArt
    prestigeScene = new prestigeArt.PrestigeScene(backdrops)
    prestigeHit = prestigeArt
    classesScene = new classesArt.ClassesScene(backdrops)
    classesHit = classesArt
    speedScene = new speedArt.SpeedScene(backdrops)
    speedHit = speedArt
    gachaScene = new gachaArt.GachaScene(backdrops)
    gachaHit = gachaArt
    settingsScene = new settingsArt.SettingsScene(backdrops)
    settingsHit = settingsArt
    raidsScene = new raidsArt.RaidsScene(backdrops)
    raidsHit = raidsArt
    calendarScene = new calendarArt.CalendarScene(backdrops)
    calendarHit = calendarArt
    milestonesScene = new milestonesArt.MilestonesScene(backdrops)
    milestonesHit = milestonesArt
    guideHit = guideArt
    traitsScene = new traitsArt.TraitsScene(backdrops)
    traitsHit = traitsArt
    stage = new BattleDemo()
    build()
    if (intro) {
        stage.holdIris()
        void landed.then(() => {
            if (disposed) return
            stage?.openIris()
            opening.value = false
        })
    }
    // a fight that arrived while the stage loaded starts now, from its beginning
    if (props.fight) stage.playFight(props.fight)
    // a raid round that arrived while the stage loaded plays now
    if (props.raidRound) stage.playRaid(props.raidRound)
    // the scene and the menu band under it: HP rides over every body (`BattleDemo.drawBars`), so there is no party band
    presenter = new Presenter(canvas.value, banded.frame.w, banded.frame.h)
    let t = 0
    stop = startLoop((dt) => {
        t += dt
        sceneTime = t
        stage!.update(dt)
    }, () => {
        stage!.challenge = challengeState.value
        stage!.speed = props.fight ? props.fight.playbackSpeed ?? 1 : props.speed ?? 1
        stage!.speedTag = props.speedTag ?? ''
        if (!props.fight) stage!.feedRun(feed())
        reportPack()
        // under a scene the battle still runs and takes its feed, but is not drawn
        const scene = openScene.value
        const view = scene === 'battle'
            ? stage!.render()
            : scene === 'collections'
                ? collectionsScene!.render(t, props.collections ?? { tab: 'gear', entries: [], essence: '0' }, collectionsHover.value, pressed.value, detail.value, !!props.collectionsBusy)
                : scene === 'loadouts'
                    ? loadoutsScene!.render(t, props.loadouts ?? { slots: [], unlocked: 0, max: 0 }, loadoutsHover.value, pressed.value, loadoutDetail.value, !!props.loadoutsBusy)
                    : scene === 'classes'
                        ? classesScene!.render(t, classesView.value, classHover.value, !!props.classesBusy, pressed.value)
                        : scene === 'prestige'
                            ? prestigeScene!.render(t, props.prestige ?? { tracks: [], voidShards: '0', gems: '0' }, shopPage.value, shopHover.value, pressed.value, !!props.prestigeBusy)
                            : scene === 'gacha'
                                ? gachaScene!.render(t, props.gacha ?? { banners: [], gold: '0', reveal: null, armed: null }, gachaHover.value, pressed.value, !!props.gachaBusy)
                                : scene === 'raids'
                                    ? raidsScene!.render(t, raidsView.value, raidsHover.value, pressed.value)
                                    : scene === 'traits'
                                    ? traitsScene!.render(t, props.traits ?? EMPTY_TRAITS, traitsHover.value, pressed.value, !!props.traitsBusy)
                                    : scene === 'milestones'
                                    ? milestonesScene!.render(t, props.milestones ?? { rows: [] }, milestonesHover.value, pressed.value, !!props.milestonesBusy)
                                    : scene === 'calendar'
                                    ? calendarScene!.render(t, props.calendar ?? { today: 0, days: [], makeupsLeft: 0, makeupsPerCycle: 0, makeupDay: null, nextDayIn: '', cycleDaysLeft: 0, gift: null }, calendarHover.value, pressed.value, !!props.calendarBusy)
                                    : scene === 'settings'
                                    ? settingsScene!.render(t, props.settings ?? { settings: { ...HQ_SETTING_DEFAULTS }, tutorialsReady: false }, settingsHover.value, pressed.value, !!props.settingsBusy, settingsScroll.value)
                                    : speedScene!.render(t, props.speedView ?? { multiplier: 1, left: null, gems: '0', gemCount: 0, offlineEfficiency: 1, tiers: [] }, speedHover.value, pressed.value, !!props.speedBusy)
        if (props.raidReward && raidsHit) raidsHit.drawRaidReward(view, props.raidReward, hover.value === 'reward:ok', pressed.value)
        // the guide waits out a raid's reward popup rather than covering it
        else if (props.guide && guideHit) guideHit.drawGuide(view, t, props.guide, guideHover.value, pressed.value)
        presenter!.present(banded!.compose(view, scene, bandHover.value, pressed.value, !!props.raidRound, bandAlerts.value, props.menuScenes))
    })
    observer = new ResizeObserver(fit)
    observer.observe(wrap.value!)
    fit()
    ready.value = true
})

onBeforeUnmount(() => {
    disposed = true
    stop?.()
    if (progressTimer) clearInterval(progressTimer)
    // without its frames an unmounted stage the dev tools hold on to costs next to nothing
    stage?.dispose()
    observer?.disconnect()
})
</script>

<template>
  <div
    ref="wrap"
    class="relative w-full overflow-hidden rounded-lg border border-default bg-elevated"
    :class="ready ? '' : 'aspect-[272/175]'"
    :style="opening ? { backgroundColor: INK } : undefined"
  >
    <div
      class="relative mx-auto"
      :style="{ width: `${cssSize.width}px`, height: `${cssSize.height}px` }"
    >
      <canvas
        ref="canvas"
        class="block"
        :class="pointer ? 'cursor-pointer' : ''"
        :style="{ width: `${cssSize.width}px`, height: `${cssSize.height}px`, imageRendering: 'pixelated', touchAction: scrollsHere ? 'pan-x' : undefined }"
        @pointermove="onPointerMove"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
        @pointerleave="onPointerLeave"
        @pointercancel="onPointerLeave"
        @wheel="onWheel"
      />
      <input
        v-if="renaming"
        ref="renameInput"
        v-model="renaming.text"
        class="absolute px-1 font-mono uppercase text-white outline-none border border-primary"
        :style="renameStyle"
        :maxlength="LOADOUT_NAME_MAX_LENGTH"
        aria-label="Loadout name"
        @keydown.enter.prevent="commitRename"
        @keydown.esc.prevent="renaming = null"
        @blur="commitRename"
      >
    </div>
    <div
      v-if="!ready && !opening"
      class="absolute inset-0 flex items-center justify-center text-sm text-muted"
    >
      Loading the battle…
    </div>
  </div>
</template>
