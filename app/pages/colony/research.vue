<script setup lang="ts">
import { tierColor } from '#shared/utils/xeno'

const colony = useColony()
const { research } = colony

const sacrificing = ref<string | null>(null)

async function handleSacrifice(typeId: string) {
  if (sacrificing.value) return
  sacrificing.value = typeId
  try {
    await colony.sacrificeForResearch(typeId)
  } finally {
    sacrificing.value = null
  }
}
</script>

<template>
  <div class="p-4 md:p-6 w-full space-y-4">
    <div>
      <h1 class="text-lg font-bold flex items-center gap-2">
        <UIcon
          name="i-lucide-flask-conical"
          class="text-primary"
        />
        Research
      </h1>
      <p class="text-sm text-muted">
        Sacrifice a growing pile of a species' own spare bugs to permanently widen the roll range every future purchase of that species uses. Bugs you already own keep whatever they rolled — buy spares in the
        <NuxtLink
          to="/colony/market"
          class="text-primary underline"
        >Market</NuxtLink> to sacrifice here.
      </p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      <UCard
        v-for="species in research"
        :key="species.typeId"
        :ui="{ body: 'p-0' }"
      >
        <div class="p-3 space-y-2.5">
          <div class="flex items-center gap-2.5">
            <div class="flex flex-col items-center leading-none shrink-0 w-9">
              <span class="text-[9px] font-bold text-muted uppercase tracking-wider">Lv</span>
              <span class="text-2xl font-black text-primary tabular-nums">{{ species.level }}</span>
            </div>
            <div class="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-lg">
              {{ species.emoji }}
            </div>
            <div class="min-w-0 flex-1">
              <p class="font-semibold text-sm flex items-center gap-1.5">
                {{ species.name }}
                <span
                  class="text-[10px] font-black"
                  :class="tierColor(species.tier)"
                >T{{ species.tier }}</span>
                <span
                  v-if="species.atMax"
                  class="text-[10px] text-muted font-normal"
                >(max)</span>
              </p>
              <p class="text-xs text-muted mt-0.5">
                Rolls {{ species.speedMin }}–{{ species.speedMax }}% speed · {{ species.yieldMin }}–{{ species.yieldMax }} yield
              </p>
            </div>
          </div>

          <div
            v-if="!species.atMax"
            class="rounded-lg bg-elevated p-2 space-y-1"
          >
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted">Currently</span>
              <span class="font-mono font-medium text-highlighted">{{ species.speedMin }}–{{ species.speedMax }}% · {{ species.yieldMin }}–{{ species.yieldMax }} yield</span>
            </div>
            <div
              v-if="species.nextSpeedRange && species.nextYieldRange"
              class="flex items-center justify-between text-xs"
            >
              <span class="text-muted flex items-center gap-1">
                <UIcon
                  name="i-lucide-arrow-right"
                  class="size-3"
                />
                Next level
              </span>
              <span class="font-mono font-medium text-primary">{{ species.nextSpeedRange[0] }}–{{ species.nextSpeedRange[1] }}% · {{ species.nextYieldRange[0] }}–{{ species.nextYieldRange[1] }} yield</span>
            </div>
          </div>
        </div>

        <template v-if="!species.atMax">
          <USeparator />
          <div class="p-3 space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted">Spare bugs to sacrifice</span>
              <span
                class="font-mono font-semibold"
                :class="species.spareOwned >= (species.sacrificeNeeded ?? 0) ? 'text-success' : 'text-muted'"
              >
                {{ species.spareOwned }} / {{ species.sacrificeNeeded }}
              </span>
            </div>
            <UButton
              block
              size="sm"
              color="primary"
              :loading="sacrificing === species.typeId"
              :disabled="species.spareOwned < (species.sacrificeNeeded ?? 0)"
              @click="handleSacrifice(species.typeId)"
            >
              Sacrifice {{ species.sacrificeNeeded }} {{ species.name }}{{ (species.sacrificeNeeded ?? 0) === 1 ? '' : 's' }}
            </UButton>
          </div>
        </template>
        <template v-else>
          <USeparator />
          <div class="p-3">
            <p class="text-xs text-success text-center flex items-center justify-center gap-1">
              <UIcon
                name="i-lucide-check-circle-2"
                class="size-3.5"
              />
              Max Research level reached
            </p>
          </div>
        </template>
      </UCard>
    </div>
  </div>
</template>
