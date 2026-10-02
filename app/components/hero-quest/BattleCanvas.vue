<script setup lang="ts">
import type { BattleDemo, RunParty, StageFight } from '~/utils/hero-quest-art/demo'
import type { Presenter } from '~/utils/hero-quest-art/canvas'
import type { RunFeed } from '~/utils/hero-quest-art/run-director'

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
        enemyHp: string
        secondsPerKill: number | null
    }
    hero: {
        classId: string
        level: number
        stats: { critChance: number, critMultiplier: string }
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
        packSize: run.packSize,
        atBossGate: run.atBossGate,
        walled: run.walled,
        enemyHp: run.enemyHp,
        secondsPerKill: run.secondsPerKill,
        critChance: props.hero.stats.critChance,
        critMultiplier: props.hero.stats.critMultiplier,
        heroHpPct: readout.heroHpPct,
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

defineExpose({ skipFight })

onMounted(async () => {
    const [{ BattleDemo, CAMERAS, PARTY_BAND_H }, { Presenter, startLoop }] = await Promise.all([
        import('~/utils/hero-quest-art/demo'),
        import('~/utils/hero-quest-art/canvas')
    ])
    if (disposed || !canvas.value) return
    stage = new BattleDemo()
    build()
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
  >
    <canvas
      ref="canvas"
      class="block mx-auto"
      :style="{ width: `${cssSize.width}px`, height: `${cssSize.height}px`, imageRendering: 'pixelated' }"
    />
    <div
      v-if="!ready"
      class="absolute inset-0 flex items-center justify-center text-sm text-muted"
    >
      Loading the battle…
    </div>
  </div>
</template>
