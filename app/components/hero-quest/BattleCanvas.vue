<script setup lang="ts">
import type { BattleDemo, RunParty, StageArena, StageFight, StageRaid } from '~/utils/hero-quest-art/demo'
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
import type { TreeCamera, TreeScene, TreeTarget, TreeView } from '~/utils/hero-quest-art/tree-scene'
import type { RaidLoadoutOption, RaidRewardView, RaidRowView, RaidsHover, RaidsScene, RaidsView } from '~/utils/hero-quest-art/raids-scene'
import type { WelcomeView } from '~/utils/hero-quest-art/welcome-card'
import type { GiftReveal, HolidayGiftIconView, HolidayRevealView } from '~/utils/hero-quest-art/holiday-gift'
import type { SceneTab } from '~/utils/hero-quest-art/scene-tabs'
import type { ArenaResultView, ArenaScene, ArenaTarget, ArenaView } from '~/utils/hero-quest-art/arena-scene'
import type { PartyStatsTarget, PartyStatsView } from '~/utils/hero-quest-art/party-stats'
import type { RaidId } from '#shared/utils/hero-quest/content/raids'
import { LOADOUT_NAME_MAX_LENGTH } from '#shared/utils/hero-quest/constants'
import { HQ_SETTING_DEFAULTS } from '#shared/utils/hero-quest/settings'
import { D } from '#shared/utils/hero-quest/numbers'
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
        /** XP toward the next level, Decimal strings, for the badge's XP strip. */
        xp?: string
        xpToNextLevel?: string
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
    /** The Shop's open tab. */
    shopTab?: HqShopTab
    /** The Calendar's open tab. */
    calendarTab?: HqCalendarTab
    /** The Milestones are open, so their Calendar tab can be pressed. */
    milestonesOpen?: boolean
    /** Battle Speed is open, so its Shop tab can be pressed. */
    speedOpen?: boolean
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
    /** The saved Loadouts, for the Raids scene's preferred-Loadout picker. */
    raidLoadouts?: readonly RaidLoadoutOption[]
    /** A holiday gift waiting to be opened, for the battle view's corner; null with none. */
    holidayGift?: HolidayGiftIconView | null
    /** The holiday gift being opened, over everything; null when none is. */
    holidayReveal?: HolidayRevealView | null
    /** A raid round to play in place of the run; the stage goes back to the run once it is cleared. */
    raidRound?: StageRaid | null
    /** What a raid round or quick-clear paid, shown over the stage until its button is pressed. */
    raidReward?: RaidRewardView | null
    /** The welcome-back card: what the last stretch away banked, over the battle until it is put away. */
    welcome?: WelcomeView | null
    /** The Arena scene, less the tab and page the stage keeps itself. */
    arena?: Omit<ArenaView, 'tab' | 'page' | 'pickerOpen' | 'rewardsOpen'>
    /** An Arena attack to play in place of the run; the stage goes back to the run once it is cleared. */
    arenaRound?: StageArena | null
    /** What an Arena attack came to, shown over the stage until its button is pressed. */
    arenaResult?: ArenaResultView | null
    /** The party's stats, open over the battle; null when shut. */
    partyStats?: PartyStatsView | null
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
    /** Something in Collections can be levelled or beats what is worn: its button carries the red dot. */
    collectionsUpgrade?: boolean
    /** The guide's dialog, while a tutorial is due. */
    guide?: GuideView | null
    /** The Traits scene: the board, the Sets and the save slots. */
    traits?: TraitsView
    /** A Roll, lock, store, load or save-slot purchase is on its way. */
    traitsBusy?: boolean
    /** The Passive Skill Tree scene: every node's level, the points and the respec. */
    tree?: TreeView
}>()

const emit = defineEmits<{
    /** Ten times a second while a fight plays: seconds played, and whether its result is up. */
    fightProgress: [progress: { time: number, done: boolean }]
    /** The challenge button was pressed: fight the boss again. */
    challenge: []
    /** A menu band button was pressed: the scene to show, or the battle when the open one closes. */
    scene: [scene: HqScene]
    /** A Shop tab was pressed. */
    shopTab: [tab: HqShopTab]
    /** A Calendar tab was pressed. */
    calendarTab: [tab: HqCalendarTab]
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
    /** A line of a raid's preferred-Loadout list was pressed: the slot to point at, or null for none. */
    raidLoadout: [raidId: RaidId, slotIndex: number | null]
    /** The reward popup's button was pressed. */
    raidRewardClose: []
    welcomeClose: []
    /** An Arena button was pressed: an attack, a purchase, a defence copy or a claim. */
    arenaAction: [target: ArenaTarget]
    /** An Arena tab was opened. */
    arenaTab: [tab: HqArenaTab]
    /** The Arena result popup's button was pressed. */
    arenaResultClose: []
    /** The profile badge's portrait was pressed: the party's stats open. */
    partyStatsOpen: []
    /** The party's stats were shut: their close button, or a press beside them. */
    partyStatsClose: []
    /** A base stat's cell was pressed: its sources open; back shuts them. */
    partyStatsCell: [cell: { row: number, unit: number }]
    partyStatsBack: []
    /** Today's calendar cell, or the make-up button, was pressed. */
    claimCalendar: [makeup: boolean]
    /** The holiday gift in the battle view's corner was pressed. */
    holidayOpen: []
    /** The holiday reveal's button was pressed once everything was out. */
    holidayRevealClose: []
    /** A milestone card with steps waiting was pressed. */
    claimMilestones: [track: string]
    /** The guide's panel was pressed: the next page, or the tutorial closed on the last. */
    guideNext: []
    /** A Traits button was pressed: Roll, a lock, a board's Save or Load, or a save slot's Buy. */
    traitAction: [target: TraitsTarget]
    /** A picked tree node's Buy was pressed. */
    treeBuy: [nodeId: string]
    /** The tree's Respec was pressed. */
    treeRespec: []
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
    saveCost: 0, saveAffordable: false, boardFull: false, gems: 0, armed: null, roll: null,
    autoGrade: 'S', gradePickerOpen: false
}
/** What the tree scene draws before its payload lands. */
const EMPTY_TREE: TreeView = { nodes: [], points: '0', respecFree: false, respecGems: 0, respecAffordable: false, armed: false, busy: false }

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
let sceneTabsHit: typeof import('~/utils/hero-quest-art/scene-tabs') | null = null
let gachaScene: GachaScene | null = null
let gachaHit: typeof import('~/utils/hero-quest-art/gacha-scene') | null = null
let settingsScene: SettingsScene | null = null
let settingsHit: typeof import('~/utils/hero-quest-art/settings-scene') | null = null
let raidsScene: RaidsScene | null = null
let raidsHit: typeof import('~/utils/hero-quest-art/raids-scene') | null = null
let welcomeHit: typeof import('~/utils/hero-quest-art/welcome-card') | null = null
let calendarScene: CalendarScene | null = null
let calendarHit: typeof import('~/utils/hero-quest-art/calendar-scene') | null = null
let milestonesScene: MilestonesScene | null = null
let milestonesHit: typeof import('~/utils/hero-quest-art/milestones-scene') | null = null
let guideHit: typeof import('~/utils/hero-quest-art/guide') | null = null
let traitsScene: TraitsScene | null = null
let traitsHit: typeof import('~/utils/hero-quest-art/traits-scene') | null = null
let treeScene: TreeScene | null = null
let treeHit: typeof import('~/utils/hero-quest-art/tree-scene') | null = null
let arenaScene: ArenaScene | null = null
let arenaHit: typeof import('~/utils/hero-quest-art/arena-scene') | null = null
let giftHit: typeof import('~/utils/hero-quest-art/holiday-gift') | null = null
let partyStatsHit: typeof import('~/utils/hero-quest-art/party-stats') | null = null
let giftReveal: GiftReveal | null = null
/** The stage's clock, for the scene that times its own animation (the gacha reveal). */
let sceneTime = 0
let band: typeof import('~/utils/hero-quest-art/menu-band') | null = null
let presenter: Presenter | null = null
let stop: (() => void) | null = null
let observer: ResizeObserver | null = null
let disposed = false
/** How far the Hero is toward the next level, 0 to 1. */
function xpShareOf(hero: { xp?: string, xpToNextLevel?: string }): number {
    if (!hero.xp || !hero.xpToNextLevel) return 0
    const need = D(hero.xpToNextLevel)
    return need.lte(0) ? 0 : Math.max(0, Math.min(1, D(hero.xp).div(need).toNumber()))
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
        xpShare: xpShareOf(props.hero),
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

// a party changed mid-fight, mid-raid or mid-Arena-round, waits for it to be put away
watch(partyKey, () => {
    if (!props.fight && !props.raidRound && !props.arenaRound) build()
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

/** An Arena attack plays in place of the run, reporting how far it has played as a raid round does; cleared, the run comes back. */
watch(() => props.arenaRound, (round) => {
    if (progressTimer) clearInterval(progressTimer)
    progressTimer = null
    if (!round) {
        stage?.endArena()
        if (partyKey.value !== builtKey && !props.fight && !props.raidRound) build()
        return
    }
    skipped = false
    stage?.playArena(round)
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
    if (!stage || !box || calm.value) return Promise.resolve(null)
    return new Promise(resolve => stage!.closeIris(() => resolve(rectOf(box))))
}

defineExpose({ skipFight, closeIris })

/**
 * The challenge button and the menu band live in the canvas, so the pointer is hit-tested against
 * them in the view's own pixels. The page's own Fight button stays the keyboard's way in.
 */
type Target = 'challenge' | 'gift' | 'gift:ok' | 'gift:skip' | HqMenuScene | `scenetab:${string}` | `tab:${HqCollectionTab}` | `tile:${number}` | 'close' | DetailButton
    | `card:${number}` | `loadout:${LoadoutButton}` | `buy:${number}` | 'shop:prev' | 'shop:next' | `class:${string}` | KitTarget | `speed:${number}:${number}`
    | `gacha:${GachaSystemId}:${GachaButton | 'emblem'}` | 'reveal' | `setting:${SettingsTarget}` | `raid:${Exclude<RaidsHover, null>}` | 'reward:ok' | 'welcome:ok' | `cal:${CalendarTarget}` | `ms:${MilestonesTarget}` | GuideTarget
    | `trait:${TraitsTarget}` | `tree:${TreeTarget}`
    | `arena:${ArenaTarget}` | 'result:ok' | 'stats:open' | 'stats:close' | 'stats:back' | `stats:cell:${number}:${number}`

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
    // the holiday reveal takes every press: before the end a press shows it all, after it the button closes it
    if (props.holidayReveal) {
        if (!giftReveal || !giftHit) return null
        if (!giftReveal.done(props.holidayReveal, sceneTime)) return 'gift:skip'
        return giftHit.onRevealButton(presenter.w, sceneH, x, y) ? 'gift:ok' : null
    }
    // the reward popup takes every press: only its button does anything
    if (props.raidReward) return raidsHit?.onRaidRewardButton(presenter.w, sceneH, x, y) ? 'reward:ok' : null
    if (props.welcome) return welcomeHit?.onWelcomeButton(presenter.w, sceneH, props.welcome, x, y) ? 'welcome:ok' : null
    if (props.arenaResult) return arenaHit?.onArenaResultButton(presenter.w, sceneH, x, y) ? 'result:ok' : null
    // the party's stats take every press: their close button, or anywhere beside them, shuts them
    if (props.partyStats) {
        const at = partyStatsHit?.partyStatsTargetAt(presenter.w, sceneH, props.partyStats, x, y) ?? 'inside'
        if (at === 'inside') return null
        return at === 'outside' ? 'stats:close' : `stats:${at}`
    }
    // a tutorial is forced: only its bar answers, or for an unlock only the button it points at
    if (props.guide) {
        if (props.guide.focus) {
            const item = band?.menuItemAt(presenter.w, presenter.h, x, y, props.menuScenes) ?? null
            return item === props.guide.focus ? item : null
        }
        return guideHit?.guideTargetAt(presenter.w, sceneH, x, y, props.guide) ?? null
    }
    // a raid or Arena round hides the menu, so a stray press can't walk out of it mid-fight
    const item = props.raidRound || props.arenaRound ? null : band?.menuItemAt(presenter.w, presenter.h, x, y, props.menuScenes) ?? null
    if (item) return item
    if (openScene.value === 'battle' && stage?.onBadgePortrait(x, y)) return 'stats:open'
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
    // the Shop's tabs sit over both of its tabs' scenes; a tab not open yet is only pointed at
    // a scene with tabs (the Shop, the Calendar): the tabs sit over every tab's scene; a tab not open yet is only pointed at
    if (sceneTabs.value && sceneTabsHit) {
        const id = sceneTabsHit.sceneTabAt(sceneTabs.value.tabs, x, y)
        if (id) {
            const tab = sceneTabs.value.tabs.find(t => t.id === id)!
            return id !== sceneTabs.value.open && !tab.locked ? `scenetab:${id}` : null
        }
    }
    if (openScene.value === 'shop' && shopTab.value === 'upgrades' && prestigeHit) {
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
        const at = raidsHit.raidsHoverAt(raidsView.value, x, y)
        // the enter button waits for the fights; until then only the rows are pressed
        if (at === 'enter' || at === 'quick') return raidsHit.raidButtonEnabled(raidsView.value, at) ? `raid:${at}` : null
        if (at === 'loadout') return raidsHit.raidLoadoutEnabled(raidsView.value) || raidPicker.value ? 'raid:loadout' : null
        if (at?.startsWith('pick:') && props.raidsBusy) return null
        return at ? `raid:${at}` : null
    }
    if (openScene.value === 'arena' && arenaHit && props.arena) {
        const at = arenaHit.arenaTargetAt(arenaView.value, presenter.w, sceneH, x, y)
        // a button that cannot be pressed is no target
        return at && arenaHit.arenaTargetEnabled(arenaView.value, at) ? `arena:${at}` : null
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
    if (openScene.value === 'calendar' && calendarTab.value === 'milestones' && milestonesHit && props.milestones) {
        const at = milestonesHit.milestonesTargetAt(props.milestones, presenter.w, x, y)
        return at ? `ms:${at}` : null
    }
    if (openScene.value === 'traits' && traitsHit && traitsView.value) {
        // an Auto Roll going answers only STOP; a Roll still spinning or landing takes every press, to show it all
        if (traitsHit.autoRolling(traitsView.value)) {
            const at = traitsHit.traitsTargetAt(traitsView.value, presenter.w, x, y)
            return at ? `trait:${at}` : null
        }
        if (traitsScene?.rollRevealing(traitsView.value, sceneTime)) return 'trait:skip'
        // anything on the board is pointed at for what it is; only what can be pressed is pressed
        const at = traitsHit.traitsTargetAt(traitsView.value, presenter.w, x, y)
        return at ? `trait:${at}` : null
    }
    if (openScene.value === 'tree' && treeHit) {
        if (y >= sceneH) return null
        const at = treeHit.treeTargetAt(treeCamera(), presenter.w, sceneH, x, y)
        return at ? `tree:${at}` : null
    }
    if (openScene.value === 'calendar' && calendarTab.value === 'calendar' && calendarHit && props.calendar) {
        const at = calendarHit.calendarTargetAt(props.calendar, presenter.w, x, y)
        // the make-up button is no target with nothing to make up; a day is pointed at for what it pays
        if (at === 'makeup') return !props.calendarBusy && calendarHit.calendarMakeupEnabled(props.calendar) ? 'cal:makeup' : null
        if (at === 'claim') return props.calendarBusy ? null : 'cal:claim'
        return at ? `cal:${at}` : null
    }
    if (openScene.value === 'shop' && shopTab.value === 'speed' && speedHit && props.speedView) {
        const block = speedHit.speedBlockAt(props.speedView, x, y)
        // a block that cannot be bought (too dear, or another speed running) is no target
        return block && !props.speedBusy && speedHit.speedBlockOpen(props.speedView, block) ? `speed:${block.speed}:${block.minutes}` : null
    }
    if (openScene.value === 'battle' && giftShows() && giftHit?.onGiftIcon(presenter.w, x, y)) return 'gift'
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

function stageX(e: PointerEvent | WheelEvent): number {
    const r = canvas.value!.getBoundingClientRect()
    return (e.clientX - r.left) / r.width * presenter!.w
}

function onWheel(e: WheelEvent) {
    if (!canvas.value || !presenter) return
    // lines and pages become pixels
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * canvas.value.clientHeight : e.deltaY
    if (panZoomHere.value && treeHit && stageY(e) < sceneH) {
        e.preventDefault()
        treeCam.value = treeHit.zoomTreeAt(treeCamera(), presenter.w, sceneH, stageX(e), stageY(e), Math.exp(-px * TREE_WHEEL_RATE))
        return
    }
    if (!scrollsHere.value) return
    e.preventDefault()
    // the page's pixels become the stage's
    scrollSettings(settingsScroll.value + px / canvas.value.getBoundingClientRect().height * presenter.h)
}

/**
 * The Passive Skill Tree's camera, in the scene's world units; null until it is first moved, when
 * the scene opens on the root. It keeps its place while the scene is closed and reopened.
 */
const treeCam = ref<TreeCamera | null>(null)
/** The node picked in the tree, whose Buy the panel shows; leaving the scene drops it. */
const treeSelected = ref<string | null>(null)
watch(openScene, () => { treeSelected.value = null })
const panZoomHere = computed(() => openScene.value === 'tree' && ready.value)
/** How far a wheel's pixel zooms the tree, as an exponent. */
const TREE_WHEEL_RATE = 0.002

function treeCamera(): TreeCamera {
    return treeCam.value ?? treeHit!.TREE_HOME
}

/**
 * A drag across the tree pans it; two fingers pinch it. Every pointer on the tree is tracked in
 * stage pixels. A drag past `DRAG_SLOP`, or any pinch, presses nothing where it lets go.
 */
const treePointers = new Map<number, { x: number, y: number }>()
let treeDrag: { pointer: number, x: number, y: number, cam: TreeCamera, moved: boolean } | null = null
let treePinch: { dist: number, mid: { x: number, y: number }, cam: TreeCamera } | null = null
const treeDragging = ref(false)

function pinchOf(): { dist: number, mid: { x: number, y: number } } {
    const [a, b] = [...treePointers.values()] as [{ x: number, y: number }, { x: number, y: number }]
    return { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
}

/** Follow the tree's pointers: true when a pan or a pinch took the move. */
function moveTree(e: PointerEvent): boolean {
    if (!treePointers.has(e.pointerId) || !presenter || !treeHit) return false
    treePointers.set(e.pointerId, { x: stageX(e), y: stageY(e) })
    if (treePinch && treePointers.size >= 2) {
        const now = pinchOf()
        const zoomed = treeHit.zoomTreeAt(treePinch.cam, presenter.w, sceneH, treePinch.mid.x, treePinch.mid.y, now.dist / treePinch.dist)
        // the pinch's middle carries the world point it started over
        treeCam.value = treeHit.clampTreeCamera({
            ...zoomed,
            x: zoomed.x - (now.mid.x - treePinch.mid.x) / zoomed.zoom,
            y: zoomed.y - (now.mid.y - treePinch.mid.y) / zoomed.zoom
        })
        return true
    }
    if (!treeDrag || treeDrag.pointer !== e.pointerId) return false
    const dx = stageX(e) - treeDrag.x
    const dy = stageY(e) - treeDrag.y
    if (!treeDrag.moved && Math.hypot(dx, dy) > DRAG_SLOP) {
        treeDrag.moved = true
        treeDragging.value = true
        pressed.value = false
        hover.value = null
    }
    if (!treeDrag.moved) return false
    treeCam.value = treeHit.clampTreeCamera({ zoom: treeDrag.cam.zoom, x: treeDrag.cam.x - dx / treeDrag.cam.zoom, y: treeDrag.cam.y - dy / treeDrag.cam.zoom })
    return true
}

/** A pointer comes down on the tree: a drag starts from open sky or a node, a second finger pinches. */
function downOnTree(e: PointerEvent, hit: Target | null) {
    if (!panZoomHere.value || !presenter || stageY(e) >= sceneH) return
    treePointers.set(e.pointerId, { x: stageX(e), y: stageY(e) })
    canvas.value?.setPointerCapture(e.pointerId)
    if (treePointers.size >= 2) {
        treePinch = { ...pinchOf(), cam: treeCamera() }
        // a pinch is never a press
        if (treeDrag) treeDrag.moved = true
        treeDragging.value = true
        pressed.value = false
        return
    }
    if (hit === null || hit.startsWith('tree:node:')) {
        treeDrag = { pointer: e.pointerId, x: stageX(e), y: stageY(e), cam: treeCamera(), moved: false }
    }
}

/** A pointer lifts off the tree: whether its gesture moved the tree, so its release presses nothing. */
function upOffTree(e: PointerEvent): boolean {
    if (!treePointers.has(e.pointerId)) return false
    const moved = !!treePinch || (treeDrag?.pointer === e.pointerId && treeDrag.moved)
    treePointers.delete(e.pointerId)
    if (treePointers.size < 2) treePinch = null
    if (treeDrag?.pointer === e.pointerId || treePointers.size === 0) treeDrag = null
    if (treePointers.size === 0) treeDragging.value = false
    return moved
}

// a fresh visit starts at the top
watch(openScene, () => { settingsScroll.value = 0 })

function onPointerMove(e: PointerEvent) {
    if (moveTree(e)) return
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
    downOnTree(e, hover.value)
    pressed.value = hover.value !== null && !treePinch
}

function onPointerUp(e: PointerEvent) {
    const dragged = upOffTree(e) || (drag?.moved ?? false)
    drag = null
    // a drag scrolled the list or moved the tree; it presses nothing where it let go
    if (dragged) {
        pressed.value = false
        hover.value = null
        return
    }
    const wasPressed = pressed.value
    onPointerMove(e)
    pressed.value = false
    const hit = hover.value
    // a press on the tree's open sky puts the picked node down
    if (openScene.value === 'tree' && hit === null && stageY(e) < sceneH) treeSelected.value = null
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
    else if (hit === 'gift') emit('holidayOpen')
    else if (hit === 'gift:ok') emit('holidayRevealClose')
    else if (hit === 'gift:skip') {
        if (props.holidayReveal) giftReveal?.skip(props.holidayReveal)
    }
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
    else if (hit === 'welcome:ok') emit('welcomeClose')
    else if (hit === 'result:ok') emit('arenaResultClose')
    else if (hit === 'stats:open') emit('partyStatsOpen')
    else if (hit === 'stats:close') emit('partyStatsClose')
    else if (hit === 'stats:back') emit('partyStatsBack')
    else if (hit.startsWith('stats:cell:')) {
        const [row, unit] = hit.slice('stats:cell:'.length).split(':').map(Number) as [number, number]
        emit('partyStatsCell', { row, unit })
    }
    else if (hit.startsWith('arena:')) {
        const at = hit.slice(6) as ArenaTarget
        if (at.startsWith('tab:')) {
            arenaTab.value = at.slice(4) as HqArenaTab
            arenaPage.value = 0
            emit('arenaTab', arenaTab.value)
        } else if (at === 'prev' || at === 'next') arenaPage.value += at === 'next' ? 1 : -1
        else if (at === 'loadout') arenaPicker.value = !arenaPicker.value
        else if (at === 'shut') arenaPicker.value = false
        else if (at === 'rewards') arenaRewards.value = !arenaRewards.value
        else {
            if (at.startsWith('pick:')) arenaPicker.value = false
            emit('arenaAction', at)
        }
    }
    else if (hit === 'cal:claim' || hit === 'cal:makeup') emit('claimCalendar', hit === 'cal:makeup')
    // a day other than today is only pointed at, for what it pays
    else if (hit.startsWith('cal:')) return
    else if (hit === 'guide:next') emit('guideNext')
    else if (hit.startsWith('tree:')) onTreePress(hit.slice(5) as TreeTarget)
    else if (hit.startsWith('trait:')) {
        const target = hit.slice(6) as TraitsTarget
        if (target === 'skip') {
            if (traitsView.value) traitsScene?.skipRoll(traitsView.value)
        }
        else if (target === 'grade') traitGradePicker.value = !traitGradePicker.value
        else if (target === 'shut') traitGradePicker.value = false
        else if (traitsHit && traitsView.value && traitsHit.traitsTargetEnabled(traitsView.value, target, !!props.traitsBusy)) {
            if (target.startsWith('grade:')) traitGradePicker.value = false
            emit('traitAction', target)
        }
    }
    else if (hit.startsWith('ms:row:')) {
        // a card with nothing waiting is only pointed at, for what its next step pays
        const row = milestoneRowOf(hit)
        if (row?.claimable.length && !props.milestonesBusy) emit('claimMilestones', row.id)
    }
    else if (hit.startsWith('raid:')) {
        const id = hit.slice(5) as Exclude<RaidsHover, null>
        if (id === 'enter') emit('raidEnter', raidSelected.value)
        else if (id === 'quick') emit('raidQuick', raidSelected.value)
        else if (id === 'loadout') raidPicker.value = !raidPicker.value
        else if (id === 'shut') raidPicker.value = false
        else if (id.startsWith('pick:')) {
            const key = id.slice(5)
            raidPicker.value = false
            emit('raidLoadout', raidSelected.value, key === 'none' ? null : Number(key))
        }
        else raidSelected.value = id as RaidId
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
    else if (hit.startsWith('scenetab:')) {
        const id = hit.slice(9)
        if (openScene.value === 'shop') emit('shopTab', id as HqShopTab)
        else emit('calendarTab', id as HqCalendarTab)
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
        if (slot?.locked) emit('scene', 'shop')
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

function onTreePress(target: TreeTarget) {
    if (!treeHit || !props.tree) return
    if (target.startsWith('node:')) treeSelected.value = target.slice(5)
    else if (target === 'zoomIn' || target === 'zoomOut') {
        const cam = treeCamera()
        treeCam.value = treeHit.clampTreeCamera({ ...cam, zoom: cam.zoom * (target === 'zoomIn' ? treeHit.TREE_ZOOM_STEP : 1 / treeHit.TREE_ZOOM_STEP) })
    }
    else if (target === 'center') treeCam.value = treeHit.TREE_HOME
    else if (!treeHit.treeTargetEnabled(props.tree, target, treeSelected.value)) return
    else if (target === 'buy' && treeSelected.value) emit('treeBuy', treeSelected.value)
    else if (target === 'respec') emit('treeRespec')
}

function onPointerLeave(e?: PointerEvent) {
    // a captured pointer keeps its gesture past the edge; only a cancel ends it here
    if (e && treePointers.has(e.pointerId)) {
        if (e.type !== 'pointercancel') return
        upOffTree(e)
    }
    drag = null
    hover.value = null
    pressed.value = false
    // a press that left the canvas still committed the name it took the focus from
    if (draftAtPress) sendRename(draftAtPress)
    draftAtPress = null
}

/** The gift waits in the battle view's corner, but not over a fight, a raid round or its own reveal. */
function giftShows(): boolean {
    return !!props.holidayGift && !props.fight && !props.raidRound && !props.holidayReveal
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
    if (h.startsWith('trait:')) return !!traitsHit && !!traitsView.value && traitsHit.traitsTargetEnabled(traitsView.value, h.slice(6) as TraitsTarget, !!props.traitsBusy)
    if (h.startsWith('tree:')) return !!treeHit && !!props.tree && treeHit.treeTargetEnabled(props.tree, h.slice(5) as TreeTarget, treeSelected.value)
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
/** The Arena's open tab and page; the tab keeps its place while the scene is closed and reopened. */
const arenaTab = ref<HqArenaTab>('fight')
const arenaPage = ref(0)
const ARENA_EMPTY: Omit<ArenaView, 'tab' | 'page' | 'pickerOpen' | 'rewardsOpen'> = {
    busy: false, rating: 0, medals: 0, season: 1, seasonLeft: '', attemptsLeft: 0, attemptsFree: 0, attemptPrice: 0, refreshPrice: 0, refreshesLeft: 0, armed: null,
    gems: 0, rewards: [], candidates: null, defense: null, shop: [], log: null, board: null,
    loadout: null, loadoutLive: false, loadoutSlot: null, loadoutOptions: []
}
/** The Arena's preferred-Loadout list is open; leaving the scene or the Fight tab puts it away. */
const arenaPicker = ref(false)
const arenaRewards = ref(false)
watch([openScene, arenaTab], () => {
    arenaPicker.value = false
    arenaRewards.value = false
})
const arenaView = computed<ArenaView>(() => ({ ...(props.arena ?? ARENA_EMPTY), tab: arenaTab.value, page: arenaPage.value, pickerOpen: arenaPicker.value, rewardsOpen: arenaRewards.value }))
// a list that shrank under the page shown takes it back to its last
watch(() => arenaHit && arenaView.value ? arenaHit.arenaPages(arenaView.value) : 1, (pages) => {
    if (arenaPage.value >= pages) arenaPage.value = Math.max(0, pages - 1)
})
// opening the scene tells the screen which tab it lands on, so that tab's reads go out; a page
// loaded straight onto the Arena opens it too
watch(openScene, (scene) => {
    if (scene === 'arena') emit('arenaTab', arenaTab.value)
}, { immediate: true })
const arenaHover = computed<ArenaTarget | null>(() => hover.value?.startsWith('arena:') ? hover.value.slice(6) as ArenaTarget : null)

/** The raid shown in the Raids scene; it keeps its place while the scene is closed and reopened. */
const raidSelected = ref<RaidId>('raid_training_grounds')
/** The preferred-Loadout list is down; leaving the scene puts it away. */
const raidPicker = ref(false)
watch(openScene, () => { raidPicker.value = false })
/** The list of grades Auto Roll stops at is open; leaving the scene puts it away. */
const traitGradePicker = ref(false)
watch(openScene, () => { traitGradePicker.value = false })
const traitsView = computed<TraitsView | null>(() => props.traits ? { ...props.traits, gradePickerOpen: traitGradePicker.value } : null)
const raidsView = computed<RaidsView>(() => ({
    selected: raidSelected.value,
    raids: props.raids ?? [],
    busy: !!props.raidsBusy,
    loadouts: props.raidLoadouts ?? [],
    pickerOpen: raidPicker.value
}))
const raidsHover = computed<RaidsHover>(() => hover.value?.startsWith('raid:') ? hover.value.slice(5) as RaidsHover : null)
const settingsHover = computed<SettingsTarget | null>(() => hover.value?.startsWith('setting:') ? hover.value.slice(8) as SettingsTarget : null)
const calendarHover = computed<CalendarTarget | null>(() => hover.value?.startsWith('cal:') ? hover.value.slice(4) as CalendarTarget : null)
const milestonesHover = computed<MilestonesTarget | null>(() => hover.value?.startsWith('ms:') ? hover.value.slice(3) as MilestonesTarget : null)
const traitsHover = computed<TraitsTarget | null>(() => hover.value?.startsWith('trait:') ? hover.value.slice(6) as TraitsTarget : null)
const treeHover = computed<TreeTarget | null>(() => hover.value?.startsWith('tree:') ? hover.value.slice(5) as TreeTarget : null)
/** The track a `ms:row:N` target points at. */
function milestoneRowOf(target: string) {
    return props.milestones?.rows[Number(target.slice(7))]
}
const guideHover = computed<GuideTarget | null>(() => hover.value === 'guide:next' ? hover.value : null)
/** The band's red dots: a scene opened and not visited yet, today's calendar reward, a milestone step, a free pull, an upgrade or a tree node waiting. */
const bandAlerts = computed<ReadonlySet<HqMenuScene>>(() => new Set<HqMenuScene>([
    ...(props.newScenes ?? []),
    ...(prefs.value.dotRewards && (calendarWaiting.value || milestonesWaiting.value) ? ['calendar' as const] : []),
    ...(prefs.value.dotFreePulls && props.gacha?.banners.some(b => b.free.state === 'ready') ? ['gacha' as const] : []),
    ...(prefs.value.dotUpgrades && props.collectionsUpgrade ? ['collections' as const] : []),
    ...(prefs.value.dotTreeNodes && props.tree?.nodes.some(n => n.block === null) ? ['tree' as const] : []),
    // a season's rank reward waiting to be claimed
    ...(prefs.value.dotRewards && props.arena?.rewards.length ? ['arena' as const] : [])
]))
/** The player's settings, the defaults until the first read. */
const prefs = computed(() => props.settings?.settings ?? HQ_SETTING_DEFAULTS)
/** Less motion, asked for in Settings or by the device. */
const calm = computed(() => prefs.value.reduceMotion || prefersReducedMotion())
/** Today's calendar reward waits, and a milestone step: each dots its Calendar tab, either the button. */
const calendarWaiting = computed(() => props.calendar?.days[props.calendar.today]?.state === 'today')
const milestonesWaiting = computed(() => !!props.milestones?.rows.some(r => r.claimable.length > 0))
/** The Shop's and the Calendar's open tabs. */
const shopTab = computed<HqShopTab>(() => props.shopTab ?? 'upgrades')
const calendarTab = computed<HqCalendarTab>(() => props.calendarTab ?? 'calendar')
/** The open scene's tabs, and which is open; null for a scene without any. */
const sceneTabs = computed<{ tabs: SceneTab[], open: string } | null>(() => {
    if (openScene.value === 'shop') {
        return {
            open: shopTab.value,
            tabs: HQ_SHOP_TABS.map(id => ({ id, label: HQ_SHOP_TAB_LABELS[id], locked: id === 'speed' && !props.speedOpen }))
        }
    }
    if (openScene.value === 'calendar') {
        return {
            open: calendarTab.value,
            tabs: HQ_CALENDAR_TABS.map(id => ({
                id,
                label: HQ_CALENDAR_TAB_LABELS[id],
                locked: id === 'milestones' && !props.milestonesOpen,
                alert: id === 'calendar' ? calendarWaiting.value : milestonesWaiting.value
            }))
        }
    }
    return null
})
const sceneTabHover = computed<string | null>(() => hover.value?.startsWith('scenetab:') ? hover.value.slice(9) : null)
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
    const [{ BattleDemo, CAMERAS }, { Presenter, startLoop }, menuBand, collectionsArt, loadoutsArt, prestigeArt, classesArt, speedArt, gachaArt, settingsArt, raidsArt, calendarArt, milestonesArt, guideArt, giftArt, traitsArt, sceneTabsArt, arenaArt, partyStatsArt, treeArt, welcomeArt] = await Promise.all([
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
        import('~/utils/hero-quest-art/holiday-gift'),
        import('~/utils/hero-quest-art/traits-scene'),
        import('~/utils/hero-quest-art/scene-tabs'),
        import('~/utils/hero-quest-art/arena-scene'),
        import('~/utils/hero-quest-art/party-stats'),
        import('~/utils/hero-quest-art/tree-scene'),
        import('~/utils/hero-quest-art/welcome-card')
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
    sceneTabsHit = sceneTabsArt
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
    arenaScene = new arenaArt.ArenaScene(backdrops)
    arenaHit = arenaArt
    partyStatsHit = partyStatsArt
    treeScene = new treeArt.TreeScene(backdrops)
    treeHit = treeArt
    giftHit = giftArt
    giftReveal = new giftArt.GiftReveal()
    welcomeHit = welcomeArt
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
    if (props.arenaRound) stage.playArena(props.arenaRound)
    // the scene and the menu band under it: HP rides over every body (`BattleDemo.drawBars`), so there is no party band
    presenter = new Presenter(canvas.value, banded.frame.w, banded.frame.h)
    let t = 0
    stop = startLoop((dt) => {
        t += dt
        sceneTime = t
        stage!.update(dt)
    }, () => {
        stage!.challenge = challengeState.value
        // Battle Speed never touches an Arena round (`arena.md` §1)
        stage!.speed = props.fight ? props.fight.playbackSpeed ?? 1 : props.arenaRound ? 1 : props.speed ?? 1
        stage!.speedTag = props.speedTag ?? ''
        stage!.calm = calm.value
        stage!.cinematics = prefs.value.skillCinematics
        stage!.numbers = prefs.value.combatNumbers
        if (!props.fight) stage!.feedRun(feed())
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
                        : scene === 'shop'
                            ? shopTab.value === 'speed'
                                ? speedScene!.render(t, props.speedView ?? { multiplier: 1, left: null, gems: '0', gemCount: 0, offlineEfficiency: 1, tiers: [] }, speedHover.value, pressed.value, !!props.speedBusy)
                                : prestigeScene!.render(t, props.prestige ?? { tracks: [], voidShards: '0', gems: '0', gold: '0' }, shopPage.value, shopHover.value, pressed.value, !!props.prestigeBusy)
                            : scene === 'gacha'
                                ? gachaScene!.render(t, props.gacha ?? { banners: [], gold: '0', reveal: null, armed: null }, gachaHover.value, pressed.value, !!props.gachaBusy, prefs.value.fastReveals, calm.value)
                                : scene === 'raids'
                                    ? raidsScene!.render(t, raidsView.value, raidsHover.value, pressed.value)
                                    : scene === 'traits'
                                    ? traitsScene!.render(t, traitsView.value ?? EMPTY_TRAITS, traitsHover.value, pressed.value, !!props.traitsBusy)
                                    : scene === 'arena'
                                    ? arenaScene!.render(t, arenaView.value, arenaHover.value, pressed.value)
                                    : scene === 'tree'
                                    ? treeScene!.render(t, props.tree ?? EMPTY_TREE, treeCamera(), treeSelected.value, treeHover.value, pressed.value)
                                    : scene === 'calendar' && calendarTab.value === 'milestones'
                                    ? milestonesScene!.render(t, props.milestones ?? { rows: [] }, milestonesHover.value, pressed.value, !!props.milestonesBusy)
                                    : scene === 'calendar'
                                    ? calendarScene!.render(t, props.calendar ?? { today: 0, days: [], makeupsLeft: 0, makeupsPerCycle: 0, makeupDay: null, nextDayIn: '', cycleDaysLeft: 0 }, calendarHover.value, pressed.value, !!props.calendarBusy)
                                    : settingsScene!.render(t, props.settings ?? { settings: { ...HQ_SETTING_DEFAULTS }, tutorialsReady: false }, settingsHover.value, pressed.value, !!props.settingsBusy, settingsScroll.value)
        if (sceneTabs.value && sceneTabsHit) sceneTabsHit.drawSceneTabs(view, sceneTabs.value.tabs, sceneTabs.value.open, sceneTabHover.value)
        if (scene === 'battle' && giftShows() && giftHit) giftHit.drawGiftIcon(view, t, props.holidayGift!, hover.value === 'gift')
        if (props.holidayReveal && giftReveal) giftReveal.render(view, t, props.holidayReveal, hover.value === 'gift:ok', pressed.value)
        else if (props.raidReward && raidsHit) raidsHit.drawRaidReward(view, props.raidReward, hover.value === 'reward:ok', pressed.value)
        else if (props.welcome && welcomeHit) welcomeHit.drawWelcome(view, props.welcome, hover.value === 'welcome:ok', pressed.value)
        if (props.arenaResult && arenaHit) arenaHit.drawArenaResult(view, props.arenaResult, hover.value === 'result:ok', pressed.value)
        if (props.partyStats && partyStatsHit) partyStatsHit.drawPartyStats(view, props.partyStats, hover.value?.startsWith('stats:') ? hover.value.slice(6) as PartyStatsTarget : null)
        const frame = banded!.compose(view, scene, bandHover.value, pressed.value, !!props.raidRound || !!props.arenaRound, bandAlerts.value, props.menuScenes)
        // over the whole frame, so the band dims with the scene; it waits out a raid's or an Arena round's popup and a holiday reveal
        if (props.guide && guideHit && !props.raidReward && !props.welcome && !props.arenaResult && !props.holidayReveal) guideHit.drawGuide(frame, view.h, t, props.guide, guideHover.value)
        // a GPN change shows over everything, whatever scene is open, so a change made there shows what it did
        stage!.drawGpnOverlay(frame)
        presenter!.present(frame)
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
        :class="treeDragging ? 'cursor-grabbing' : pointer ? 'cursor-pointer' : panZoomHere ? 'cursor-grab' : ''"
        :style="{ width: `${cssSize.width}px`, height: `${cssSize.height}px`, imageRendering: 'pixelated', touchAction: panZoomHere ? 'none' : scrollsHere ? 'pan-x' : undefined }"
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
