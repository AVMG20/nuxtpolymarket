<script setup lang="ts">
import { D, formatHq } from '#shared/utils/hero-quest/numbers'
import type { StagePack } from '~/utils/hero-quest-art/demo'

/**
 * The live battle. Presentation only — it renders, it never decides, and it does not predict.
 *
 * **Everything on screen derives from one quantity, `killsFloat`** — kills into the current stage
 * attempt, fractional. The enemy bar, the enemy HP figure, the count of bodies still standing and
 * the stage counter are all functions of it, so they cannot disagree with each other. The party's
 * HP is on the stage, in the bars over each body.
 *
 * `killsFloat` and every other field arrive already walked forward by `useHqLiveRun`, which also
 * advances the stage, the world and the Hero's level. Keep the walk there: a second predictor here
 * would drift against it, and the stage rollover has to happen exactly once.
 *
 * **The enemy bar is the exception, and follows the stage instead** (`pack`, from
 * `BattleDemo.runPack`). The run is ahead of the bodies by a march and a fall or two, and a payload
 * moves it by part of a kill either way, so drawn off `killsFloat` the bar started a pack already
 * worn down and refilled when a payload landed behind the projection. Off the stage it empties
 * only as the bodies above it are hit, and fills only as a pack walks in. Before the stage has
 * loaded there is no pack to follow, and the bar falls back to `killsFloat`.
 */
const props = defineProps<{
    run: {
        enemyName: string
        killCount: number
        /** Fractional kills into the attempt — what every bar below is drawn from. */
        killsFloat: number
        killsRequired: number
        atBossGate: boolean
        /** World 10 Stage 10 is already down: the gate stays, but nothing engages it again. */
        runCleared: boolean
        walled: boolean
        killsBeforeWipe: number | null
        packSize: number
        /**
         * The **pack** total, not one body's HP — what the player is actually fighting.
         *
         * `state.get.ts` also serves per-enemy `enemyHp`, `secondsPerPack` and `partyDps`; this
         * component reads none of them, so they are left out of the contract. A per-body figure
         * next to a bar tracking the whole pack reads as inconsistent.
         */
        packHp: string
    }
    /** The pack as the stage above shows it; null before the stage has one. */
    pack?: StagePack | null
}>()

/**
 * Every readout, derived together from one already-projected quantity.
 *
 * The derivation lives in `hero-quest-battle.ts` rather than here so its edge cases — pack
 * rollover, an undying party, a walled stage that restarts instead of clearing — can be pinned by
 * a spec instead of only ever being exercised by looking at the screen.
 */
const view = computed(() => battleReadout({
    killsInStage: props.run.killsFloat,
    killsRequired: props.run.killsRequired,
    killsBeforeWipe: props.run.killsBeforeWipe,
    packSize: props.run.packSize,
    atBossGate: props.run.atBossGate
}))

/** The enemy bar and the bodies counted beside it: the stage's pack, or the run's before there is one. */
const enemyHpPct = computed(() => props.pack ? Math.max(0, Math.min(100, props.pack.left * 100)) : view.value.enemyHpPct)
const enemiesStanding = computed(() => props.pack ? props.pack.standing : view.value.enemiesStanding)

/**
 * HP left across the whole pack, as a Decimal: enemy HP passes `Number.MAX_SAFE_INTEGER` early in
 * the game, so it cannot be float arithmetic even though the percentage driving it is a plain number.
 */
const enemyHpRemaining = computed(() => D(props.run.packHp).mul(enemyHpPct.value / 100))
</script>

<template>
  <div class="rounded-lg border border-default bg-elevated/40 p-5 space-y-5">
    <div
      v-if="run.atBossGate"
      class="text-center py-6 space-y-2"
    >
      <UIcon
        name="i-lucide-skull"
        class="size-10 text-error"
      />
      <p class="text-lg font-semibold text-highlighted">
        {{ run.runCleared ? `${run.enemyName} is beaten` : `${run.enemyName} blocks the way` }}
      </p>
      <!--
        The copy has to match what actually happens, and that depends on whether the run is
        finished. A boss engages itself while this tab is visible; a *cleared* run does
        not, or beating World 10 would re-fight the final boss on a loop.
      -->
      <p class="text-sm text-muted">
        {{ run.runCleared
          ? 'The run is complete — prestige to start the next one.'
          : 'The fight starts on its own while this tab is open, or engage it now.' }}
      </p>
    </div>

    <template v-else>
      <div class="space-y-1.5">
        <div class="flex items-center justify-between text-sm">
          <span class="font-medium text-highlighted">
            {{ run.enemyName }}
            <!-- Counts down as bodies drop, so the pack reads as a group being worn away. -->
            <span
              v-if="run.packSize > 1"
              class="text-muted"
            >×{{ enemiesStanding }}</span>
          </span>
          <!-- The whole pack, remaining over total — the number the bar beside it is showing. -->
          <span class="text-muted tabular-nums">
            {{ formatHq(enemyHpRemaining) }} / {{ formatHq(run.packHp) }} HP
          </span>
        </div>
        <UProgress
          :model-value="enemyHpPct"
          size="sm"
          color="error"
        />
      </div>

      <div class="pt-1">
        <div class="flex items-center justify-between text-xs text-muted mb-1">
          <span>Stage progress</span>
          <span>{{ view.displayKills }} / {{ run.killsRequired }}</span>
        </div>
        <UProgress
          :model-value="view.killProgress"
          size="md"
          :color="run.walled ? 'error' : 'primary'"
        />
      </div>

      <!--
        Only shown when it matters. `killsBeforeWipe` below `killsRequired` is the definition of
        a walled stage, and the party's bars on the stage will visibly empty and refill as each
        attempt restarts — this names what the player is about to watch happen.
      -->
      <p
        v-if="run.walled && run.killsBeforeWipe !== null"
        class="text-xs text-error"
      >
        This stage drops you after {{ run.killsBeforeWipe }} of
        {{ run.killsRequired }} kills — it restarts rather than clearing. Level up to break through.
      </p>
    </template>
  </div>
</template>
