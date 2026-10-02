<script setup lang="ts">
import { formatHq } from '#shared/utils/hero-quest/numbers'
import { AUTO_ENGAGE_REPLAY_HOLD_SECONDS } from '#shared/utils/hero-quest/constants'
import type { FightEvent, FightOutcome } from '#shared/utils/hero-quest/fight'

/**
 * The readout under the stage while it replays a boss fight the server already resolved.
 *
 * The stage acts the fight out; this tracks it: the encounter's HP, the clock and the result, all
 * read from the server's event log at the point the stage has reached (`time`). It never
 * recomputes a damage figure and cannot change the outcome.
 */
const props = defineProps<{
    fight: {
        outcome: FightOutcome
        secondsElapsed: number
        damageDealtPct: number
        enemyMaxHp: string
        /** Each body's starting HP, escort first, boss last. */
        enemyMaxHps: string[]
        events: FightEvent[]
        runComplete: boolean
    }
    enemyName: string
    bossTimerSeconds: number
    /** Seconds the stage has played, and whether its result is up. */
    time: number
    done: boolean
    /**
     * This fight started on its own, so it closes on its own.
     *
     * A boss the player asked for waits on Continue — they chose that moment and they choose
     * when it ends. A boss that fired because the tab was visible cannot wait on a click, or
     * automatic engagement would only ever resolve one fight and then sit behind it, which is the
     * same stall it exists to remove. It still plays in full and holds on the outcome for
     * `AUTO_ENGAGE_REPLAY_HOLD_SECONDS` before dismissing itself.
     */
    autoClose?: boolean
}>()

const emit = defineEmits<{ close: [], skip: [] }>()

/**
 * HP across the **whole encounter** — a boss stands with an escort, so the bar tracks every
 * body, not whichever one is currently being hit.
 *
 * Each enemy's latest `remainingHp` is kept per `enemyIndex` and summed. Reading only the last
 * event would make the bar jump *up* the moment the party finishes a minion and turns to the
 * boss, since it would switch to reporting a fresh body's HP.
 */
const enemyHpPct = computed(() => {
    const max = Number(props.fight.enemyMaxHp)
    if (!Number.isFinite(max) || max <= 0) return 0

    // Seeded at full HP so a body nobody has struck yet counts as alive, not as zero.
    const remainingPer = props.fight.enemyMaxHps.map(Number)
    for (const event of props.fight.events) {
        if (event.at > props.time) break
        // `enemy_attack` carries the *defender's* HP, so it must never be read as enemy HP.
        if (event.kind === 'enemy_attack' || event.remainingHp === undefined) continue
        if (event.enemyIndex === undefined || event.onEnemy === false) continue
        if (event.enemyIndex < remainingPer.length) remainingPer[event.enemyIndex] = Number(event.remainingHp)
    }

    const remaining = remainingPer.reduce((total, hp) => total + hp, 0)
    return Math.max(0, Math.min(100, (remaining / max) * 100))
})

const outcomeCopy = computed(() => {
    switch (props.fight.outcome) {
        case 'win':
            return { title: 'Victory', color: 'success' as const, icon: 'i-lucide-trophy' }
        case 'wipe':
            return { title: 'Your hero fell', color: 'error' as const, icon: 'i-lucide-skull' }
        default:
            return { title: 'Out of time', color: 'warning' as const, icon: 'i-lucide-timer-off' }
    }
})

/** The self-dismiss, armed once the result is up. */
let closeTimer: ReturnType<typeof setTimeout> | null = null

watch([() => props.done, () => props.autoClose], ([done, auto]) => {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = null
    if (!done || !auto) return
    closeTimer = setTimeout(() => emit('close'), AUTO_ENGAGE_REPLAY_HOLD_SECONDS * 1000)
}, { immediate: true })

onUnmounted(() => {
    if (closeTimer) clearTimeout(closeTimer)
})
</script>

<template>
  <div class="rounded-lg border border-default bg-elevated/40 p-5 space-y-4">
    <div class="space-y-1.5">
      <div class="flex items-center justify-between text-sm">
        <span class="font-medium text-highlighted">{{ enemyName }}</span>
        <span class="text-muted tabular-nums">{{ formatHq(fight.enemyMaxHp) }} HP</span>
      </div>
      <UProgress
        :model-value="enemyHpPct"
        size="sm"
        color="error"
      />
    </div>

    <div class="flex items-center justify-between text-sm text-muted tabular-nums">
      <span>{{ time.toFixed(1) }}s / {{ bossTimerSeconds }}s</span>
      <span>{{ Math.round(100 - enemyHpPct) }}% down</span>
    </div>

    <UAlert
      v-if="done"
      :color="outcomeCopy.color"
      variant="subtle"
      :icon="outcomeCopy.icon"
      :title="outcomeCopy.title"
      :description="fight.outcome === 'win'
        ? (fight.runComplete ? 'World 10 cleared — you can prestige now.' : 'The way forward is open.')
        : `You took the boss to ${Math.round(fight.damageDealtPct * 100)}%. Fall back a stage, level up, and try again.`"
    />

    <div class="flex justify-end gap-2">
      <UButton
        v-if="!done"
        variant="ghost"
        color="neutral"
        @click="emit('skip')"
      >
        Skip
      </UButton>
      <UButton
        :disabled="!done"
        @click="emit('close')"
      >
        {{ autoClose ? 'Back to the fight' : 'Continue' }}
      </UButton>
    </div>
  </div>
</template>
