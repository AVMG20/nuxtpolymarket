<script setup lang="ts">
import type { BattleDemo, RunParty, StageFight } from '~/utils/hero-quest-art/demo'
import type { Presenter } from '~/utils/hero-quest-art/canvas'
import type { RunFeed } from '~/utils/hero-quest-art/run-director'
import type { BandedFrame, SceneBackdrops } from '~/utils/hero-quest-art/menu-band'
import type { CollectionsHover, CollectionsScene, CollectionsView, DetailButton } from '~/utils/hero-quest-art/collections-scene'
import type { LoadoutButton, LoadoutsHover, LoadoutsScene, LoadoutsView } from '~/utils/hero-quest-art/loadouts-scene'
import type { PrestigeScene, PrestigeView } from '~/utils/hero-quest-art/prestige-scene'
import { LOADOUT_NAME_MAX_LENGTH } from '#shared/utils/hero-quest/constants'
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
    }
    party: Omit<RunParty, 'classId'>
    fight?: StageFight | null
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
}>()

const emit = defineEmits<{
    /** Ten times a second while a fight plays: seconds played, and whether its result is up. */
    fightProgress: [progress: { time: number, done: boolean }]
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
    /** A prestige-shop track's Buy button was pressed. */
    shopBuy: [upgradeId: string]
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

let stage: BattleDemo | null = null
let backdrops: SceneBackdrops | null = null
let banded: BandedFrame | null = null
let collectionsScene: CollectionsScene | null = null
let collectionsHit: typeof import('~/utils/hero-quest-art/collections-scene') | null = null
let loadoutsScene: LoadoutsScene | null = null
let loadoutsHit: typeof import('~/utils/hero-quest-art/loadouts-scene') | null = null
let prestigeScene: PrestigeScene | null = null
let prestigeHit: typeof import('~/utils/hero-quest-art/prestige-scene') | null = null
let band: typeof import('~/utils/hero-quest-art/menu-band') | null = null
let presenter: Presenter | null = null
let stop: (() => void) | null = null
let observer: ResizeObserver | null = null
let disposed = false

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
        heroLevel: props.hero.level
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

// a party changed mid-fight waits for the fight to be put away
watch(partyKey, () => {
    if (!props.fight) build()
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
    const time = skipped ? end : Math.min(end, (performance.now() - fallbackStart) / 1000)
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
    | `card:${number}` | `loadout:${LoadoutButton}` | `buy:${number}` | 'shop:prev' | 'shop:next'

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
})

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
    const item = band?.menuItemAt(presenter.w, presenter.h, x, y) ?? null
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
    return openScene.value === 'battle' && props.challenge && stage?.onChallenge(x, y) ? 'challenge' : null
}

function onPointerMove(e: PointerEvent) {
    const was = hover.value
    hover.value = targetAt(e)
    if (hover.value !== was) pressed.value = false
}

function onPointerDown(e: PointerEvent) {
    if (renaming.value) {
        draftAtPress = { ...renaming.value }
        renaming.value = null
    }
    onPointerMove(e)
    pressed.value = hover.value !== null
}

function onPointerUp(e: PointerEvent) {
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
/** The shop's open page; it keeps its place while the scene is closed and reopened. */
const shopPage = ref(0)
const shopHover = computed(() => {
    const h = hover.value
    if (h === 'shop:prev' || h === 'shop:next') return h.slice(5) as 'prev' | 'next'
    // the hit is by track index; the scene marks cards by their place on the page
    return h?.startsWith('buy:') ? Number(h.slice(4)) - shopPage.value * (prestigeHit?.SHOP_PAGE_SIZE ?? 6) : null
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
    const [{ BattleDemo, CAMERAS }, { Presenter, startLoop }, menuBand, collectionsArt, loadoutsArt, prestigeArt] = await Promise.all([
        import('~/utils/hero-quest-art/demo'),
        import('~/utils/hero-quest-art/canvas'),
        import('~/utils/hero-quest-art/menu-band'),
        import('~/utils/hero-quest-art/collections-scene'),
        import('~/utils/hero-quest-art/loadouts-scene'),
        import('~/utils/hero-quest-art/prestige-scene')
    ])
    if (disposed || !canvas.value) return
    band = menuBand
    backdrops = new menuBand.SceneBackdrops(CAMERAS.zoom3)
    banded = new menuBand.BandedFrame(CAMERAS.zoom3.w, CAMERAS.zoom3.h)
    collectionsScene = new collectionsArt.CollectionsScene(backdrops)
    collectionsHit = collectionsArt
    loadoutsScene = new loadoutsArt.LoadoutsScene(backdrops)
    loadoutsHit = loadoutsArt
    prestigeScene = new prestigeArt.PrestigeScene(backdrops)
    prestigeHit = prestigeArt
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
    // the scene and the menu band under it: HP rides over every body (`BattleDemo.drawBars`), so there is no party band
    presenter = new Presenter(canvas.value, banded.frame.w, banded.frame.h)
    let t = 0
    stop = startLoop((dt) => {
        t += dt
        stage!.update(dt)
    }, () => {
        stage!.challenge = challengeState.value
        if (!props.fight) stage!.feedRun(feed())
        // under a scene the battle still runs and takes its feed, but is not drawn
        const scene = openScene.value
        const view = scene === 'battle'
            ? stage!.render()
            : scene === 'collections'
                ? collectionsScene!.render(t, props.collections ?? { tab: 'gear', entries: [], essence: '0' }, collectionsHover.value, pressed.value, detail.value, !!props.collectionsBusy)
                : scene === 'loadouts'
                    ? loadoutsScene!.render(t, props.loadouts ?? { slots: [], unlocked: 0, max: 0 }, loadoutsHover.value, pressed.value, loadoutDetail.value, !!props.loadoutsBusy)
                    : prestigeScene!.render(t, props.prestige ?? { tracks: [], voidShards: '0', gems: '0' }, shopPage.value, shopHover.value, pressed.value, !!props.prestigeBusy)
        presenter!.present(banded!.compose(view, scene, bandHover.value, pressed.value))
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
        :class="hover ? 'cursor-pointer' : ''"
        :style="{ width: `${cssSize.width}px`, height: `${cssSize.height}px`, imageRendering: 'pixelated' }"
        @pointermove="onPointerMove"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
        @pointerleave="onPointerLeave"
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
