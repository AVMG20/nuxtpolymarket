<script setup lang="ts">
import { voidResource } from '#shared/utils/gamelogic/void'

definePageMeta({ title: 'Void Log' })

const { data: runs } = await useFetch('/api/void/history')

function clockLabel(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}

function haulLines(haul: Record<string, number | undefined> | null | undefined) {
  return Object.entries(haul ?? {})
    .map(([id, amount]) => ({ id, amount: amount ?? 0, def: voidResource(id) }))
    .filter(line => line.amount > 0)
}

const reasonLabel: Record<string, string> = {
  extracted: 'Docked',
  destroyed: 'Destroyed',
  timeout: 'Lost to the storm',
  cancelled: 'Aborted'
}
</script>

<template>
  <UContainer class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold">
        Run log
      </h1>
      <p class="mt-0.5 text-sm text-muted">
        Your last fifty sorties.
      </p>
    </div>

    <UCard v-if="!runs?.length" :ui="{ body: 'p-10' }">
      <div class="text-center text-sm text-muted">
        <UIcon name="i-lucide-radar" class="mx-auto mb-2 size-8 text-muted" />
        No runs yet. Undock and find out how it goes.
      </div>
    </UCard>

    <div v-else class="space-y-2">
      <UCard v-for="run in runs" :key="run.id" :ui="{ body: 'p-3 sm:p-4' }">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-full"
              :class="run.extracted ? 'bg-success/15 text-success' : 'bg-error/15 text-error'"
            >
              <UIcon :name="run.extracted ? 'i-lucide-badge-check' : 'i-lucide-skull'" class="size-5" />
            </div>
            <div>
              <p class="font-bold">
                {{ run.sectorName }}
                <span class="ml-1 text-xs font-medium text-muted">{{ reasonLabel[run.reason] ?? run.reason }}</span>
              </p>
              <p class="text-xs text-muted">
                {{ run.shipName }} · {{ clockLabel(run.durationMs) }} · power {{ run.power }}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <UBadge color="neutral" variant="subtle" :label="`${run.kills} kills`" icon="i-lucide-skull" />
            <UBadge color="neutral" variant="subtle" :label="`${run.rocksMined} rocks`" icon="i-lucide-pickaxe" />
            <UBadge
              v-for="line in haulLines(run.haul)"
              :key="line.id"
              color="success"
              variant="subtle"
              :icon="line.def.icon"
              :label="String(line.amount)"
            />
            <UBadge color="warning" variant="subtle">
              <CoinBalance :value="run.credits" />
            </UBadge>
          </div>
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
