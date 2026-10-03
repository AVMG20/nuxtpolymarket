<script setup lang="ts">
import type { BattleDemo, RunParty, StageFight } from '~/utils/hero-quest-art/demo'
import type { Presenter } from '~/utils/hero-quest-art/canvas'
import type { RunFeed } from '~/utils/hero-quest-art/run-director'
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
}>()

const emit = defineEmits<{
    /** Ten times a second while a fight plays: seconds played, and whether its result is up. */
    fightProgress: [progress: { time: number, done: boolean }]
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

onMounted(async () => {
    // started before the engine loads, so the box never paints in its own place first
    const landed = intro && wrap.value ? growFrom(wrap.value, intro) : Promise.resolve()
    const [{ BattleDemo, CAMERAS, PARTY_BAND_H }, { Presenter, startLoop }] = await Promise.all([
        import('~/utils/hero-quest-art/demo'),
        import('~/utils/hero-quest-art/canvas')
    ])
    if (disposed || !canvas.value) return
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
    presenter = new Presenter(canvas.value, CAMERAS.zoom3.w, CAMERAS.zoom3.h + PARTY_BAND_H)
    stop = startLoop(dt => stage!.update(dt), () => {
        if (!props.fight) stage!.feedRun(feed())
        presenter!.present(stage!.renderWithParty())
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
    :class="ready ? '' : 'aspect-[272/205]'"
    :style="opening ? { backgroundColor: INK } : undefined"
  >
    <canvas
      ref="canvas"
      class="block mx-auto"
      :style="{ width: `${cssSize.width}px`, height: `${cssSize.height}px`, imageRendering: 'pixelated' }"
    />
    <div
      v-if="!ready && !opening"
      class="absolute inset-0 flex items-center justify-center text-sm text-muted"
    >
      Loading the battle…
    </div>
  </div>
</template>
