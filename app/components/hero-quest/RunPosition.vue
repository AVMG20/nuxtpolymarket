<script setup lang="ts">
import { formatHq, formatSeconds } from '#shared/utils/hero-quest/numbers'

const props = defineProps<{
    run: {
        prestige: number
        world: number
        stage: number
        worldName: string
        enemyName: string
        archetype: string
        killCount: number
        killsRequired: number
        atBossGate: boolean
        walled: boolean
        killsBeforeWipe: number | null
        secondsPerKill: number | null
        goldPerHour: number
        partyDps: string
        progress: { cleared: number; total: number }
    }
}>()

const archetypeLabel: Record<string, string> = {
    wave: 'Wave',
    elite: 'Elite wave',
    boss: 'Boss',
    super_boss: 'Super boss'
}

const archetypeColor: Record<string, string> = {
    wave: 'neutral',
    elite: 'warning',
    boss: 'error',
    super_boss: 'error'
}

const killProgress = computed(() => {
    if (props.run.killsRequired <= 0) return 0
    return Math.min(100, (props.run.killCount / props.run.killsRequired) * 100)
})

const runProgress = computed(() => (props.run.progress.cleared / props.run.progress.total) * 100)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <UBadge
        v-if="run.prestige > 0"
        color="primary"
        variant="subtle"
      >
        Prestige {{ run.prestige }}
      </UBadge>
      <span class="text-lg font-semibold text-highlighted">{{ run.worldName }}</span>
      <span class="text-muted">·</span>
      <span class="text-lg font-semibold text-highlighted">Stage {{ run.stage }}</span>
      <UBadge
        :color="(archetypeColor[run.archetype] as any) ?? 'neutral'"
        variant="subtle"
      >
        {{ archetypeLabel[run.archetype] ?? run.archetype }}
      </UBadge>
    </div>

    <div>
      <div class="flex items-center justify-between text-xs text-muted mb-1">
        <span>Run progress</span>
        <span>{{ run.progress.cleared }} / {{ run.progress.total }} stages</span>
      </div>
      <UProgress
        :model-value="runProgress"
        size="sm"
        color="primary"
      />
    </div>

    <div v-if="!run.atBossGate">
      <div class="flex items-center justify-between text-xs text-muted mb-1">
        <span>Foes defeated</span>
        <span>{{ run.killCount }} / {{ run.killsRequired }}</span>
      </div>
      <UProgress
        :model-value="killProgress"
        size="md"
        :color="run.walled ? 'error' : 'success'"
      />
    </div>

    <!--
      The wave wall. Not a fallback and not a dead end: the stage restarts, income keeps
      flowing, and levelling is what breaks it. Worth saying plainly, or a player watching
      the counter reset has no idea why.
    -->
    <UAlert
      v-if="run.walled"
      color="error"
      variant="subtle"
      icon="i-lucide-heart-crack"
      title="Your hero can't survive this stage"
      :description="`It falls after about ${run.killsBeforeWipe ?? 0} of the ${run.killsRequired} kills needed, and the stage restarts. Gold and XP keep coming — level up and you'll break through.`"
    />

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div>
        <div class="text-xs text-muted">
          Party DPS
        </div>
        <div class="font-medium text-highlighted">
          {{ formatHq(run.partyDps) }}
        </div>
      </div>
      <div>
        <div class="text-xs text-muted">
          Per kill
        </div>
        <div class="font-medium text-highlighted">
          {{ run.secondsPerKill === null ? '—' : formatSeconds(run.secondsPerKill) }}
        </div>
      </div>
      <div>
        <div class="text-xs text-muted">
          Gold / hour
        </div>
        <div class="font-medium text-highlighted">
          {{ formatNumber(run.goldPerHour) }}
        </div>
      </div>
      <div>
        <div class="text-xs text-muted">
          Survives
        </div>
        <div class="font-medium text-highlighted">
          {{ run.killsBeforeWipe === null ? '∞ kills' : `${run.killsBeforeWipe} kills` }}
        </div>
      </div>
    </div>
  </div>
</template>
