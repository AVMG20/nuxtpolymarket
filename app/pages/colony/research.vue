<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getBug, getItem, MAX_RESEARCH_LEVEL, MAX_YIELD_LEVEL, RESEARCH_SPEED_MAX } from '#shared/utils/colony'

const colony = useColony()
const { research } = colony

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

const sacrificing = ref<string | null>(null)

async function handleSacrifice(typeId: string) {
  if (sacrificing.value) return
  sacrificing.value = typeId
  try {
    await colony.sacrificeForResearch(typeId)
  } catch {
    // useColony already showed the error
  } finally {
    sacrificing.value = null
  }
}

const SPEED_SCALE = RESEARCH_SPEED_MAX[RESEARCH_SPEED_MAX.length - 1] ?? 75

const levelsDone = computed(() => research.value.reduce((sum: number, species: any) => sum + species.level, 0))
const levelsTotal = computed(() => research.value.length * MAX_RESEARCH_LEVEL)

function forageEmoji(typeId: string): string {
  const type = getBug(typeId)
  if (type?.producesGems) return '💎'
  return getItem(type?.itemId ?? '')?.emoji ?? ''
}

/** Left offset and width (in %) of a [min, max] speed roll on the 0-75% scale. */
function speedSpan([min, max]: [number, number] | number[]) {
  return { left: `${(min! / SPEED_SCALE) * 100}%`, width: `${((max! - min!) / SPEED_SCALE) * 100}%` }
}

/** Yield levels are whole steps: level n fills the nth of MAX_YIELD_LEVEL cells. */
function yieldSpan([min, max]: [number, number] | number[]) {
  return { left: `${((min! - 1) / MAX_YIELD_LEVEL) * 100}%`, width: `${((max! - min! + 1) / MAX_YIELD_LEVEL) * 100}%` }
}

function nodeClass(species: any, i: number) {
  if (i <= species.level) return 'cl-node-on'
  if (i === species.level + 1) return 'cl-node-next'
  return ''
}
</script>

<template>
  <div class="max-w-[1440px] mx-auto px-4 py-4 md:p-6 space-y-4">
    <div class="cl-panel px-4 py-4 sm:px-5 flex gap-4 items-center flex-wrap">
      <span class="text-[44px] hidden sm:block">🧫</span>
      <div class="flex-[1_1_320px] min-w-0">
        <h1 class="cl-display text-2xl sm:text-[26px] font-semibold">
          Research lab
        </h1>
        <p class="text-[13.5px] text-muted">
          Pour coins into a species: future eggs roll faster and fatter, and every bug of that kind you already own forages +25% more per level, right away. Each level costs a multiple of the species' <NuxtLink
            to="/colony/market"
            class="text-amber-400 underline"
          >Hatchery</NuxtLink> price.
        </p>
      </div>
      <div class="flex gap-3 flex-wrap">
        <div class="cl-inset px-3.5 py-2.5">
          <p class="cl-eyebrow text-[10px]">
            Roll range
          </p>
          <p class="font-semibold text-[13px] flex items-center gap-1.5 mt-0.5">
            <span class="inline-block size-2.5 rounded-[3px] bg-green-400" /> now
            <span class="inline-block size-2.5 rounded-[3px] bg-amber-400/35 ring-[1.5px] ring-inset ring-amber-400 ml-1.5" /> next
          </p>
        </div>
        <div class="cl-inset px-3.5 py-2.5">
          <p class="cl-eyebrow text-[10px]">
            Levels done
          </p>
          <p class="cl-display cl-num text-xl font-semibold">
            {{ levelsDone }} / {{ levelsTotal }}
          </p>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
      <article
        v-for="species in research"
        :key="species.typeId"
        class="cl-panel p-4 flex flex-col gap-3"
        :class="species.atMax && 'border-green-400/40'"
      >
        <div class="flex items-center gap-3">
          <div
            class="cl-bug size-16 shrink-0 grid place-items-center rounded-2xl"
            :class="`cl-t${species.tier}`"
          >
            <span class="cl-bug-emoji text-[34px]">{{ species.emoji }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="cl-display text-[19px] font-semibold">
              {{ species.name }}
              <span
                class="text-[13px] cl-tc"
                :class="`cl-t${species.tier}`"
              >T{{ species.tier }}</span>
            </h2>
            <p class="cl-num text-[12.5px] text-muted">
              Forages ×{{ species.resourceMultiplier }} {{ forageEmoji(species.typeId) }}
              <template v-if="species.nextResourceMultiplier">
                → <span class="font-semibold text-green-400">×{{ species.nextResourceMultiplier }}</span>
              </template>
            </p>
          </div>
        </div>

        <!-- Skill path: base, then one node per level -->
        <div
          class="flex items-center gap-1"
          :aria-label="`Research level ${species.level} of ${species.maxLevel}`"
          role="img"
        >
          <template
            v-for="i in species.maxLevel + 1"
            :key="i"
          >
            <span
              class="cl-node"
              :class="nodeClass(species, i - 1)"
            >{{ i === 1 ? 'B' : i - 1 }}</span>
            <span
              v-if="i <= species.maxLevel"
              class="cl-node-line"
              :class="i - 1 < species.level && 'cl-node-line-on'"
            />
          </template>
        </div>

        <div class="grid gap-2">
          <div>
            <div class="cl-num flex justify-between text-xs font-semibold">
              <span class="text-muted">Speed roll</span>
              <span>
                {{ species.speedMin }}–{{ species.speedMax }}%
                <template v-if="species.nextSpeedRange">
                  → <span class="text-amber-400">{{ species.nextSpeedRange[0] }}–{{ species.nextSpeedRange[1] }}%</span>
                </template>
              </span>
            </div>
            <div class="cl-bar h-3.5 mt-1">
              <span
                v-if="species.nextSpeedRange"
                class="cl-bar-next"
                :style="speedSpan(species.nextSpeedRange)"
              />
              <span
                class="cl-bar-fill"
                :style="speedSpan([species.speedMin, species.speedMax])"
              />
            </div>
          </div>
          <div>
            <div class="cl-num flex justify-between text-xs font-semibold">
              <span class="text-muted">Yield roll</span>
              <span>
                Y{{ species.yieldMin }}–{{ species.yieldMax }}
                <template v-if="species.nextYieldRange">
                  → <span class="text-amber-400">Y{{ species.nextYieldRange[0] }}–{{ species.nextYieldRange[1] }}</span>
                </template>
              </span>
            </div>
            <div class="cl-bar h-3.5 mt-1">
              <span
                v-if="species.nextYieldRange"
                class="cl-bar-next"
                :style="yieldSpan(species.nextYieldRange)"
              />
              <span
                class="cl-bar-fill cl-bar-fill-gem"
                :style="yieldSpan([species.yieldMin, species.yieldMax])"
              />
            </div>
          </div>
        </div>

        <button
          v-if="!species.atMax"
          type="button"
          class="cl-btn w-full mt-auto"
          :class="balance >= (species.cost ?? 0) ? 'cl-btn-green' : 'cl-btn-ghost'"
          :disabled="balance < (species.cost ?? 0) || !!sacrificing"
          @click="handleSacrifice(species.typeId)"
        >
          <UIcon
            v-if="sacrificing === species.typeId"
            name="i-lucide-loader-circle"
            class="size-4 animate-spin"
          />
          <ColonyCurrencyIcon
            v-else
            :size="17"
          />
          Research Lv {{ species.level + 1 }} · {{ formatNumber(species.cost ?? 0) }}
        </button>
        <p
          v-else
          class="cl-chip cl-chip-green self-start mt-auto"
        >
          <UIcon
            name="i-lucide-check"
            class="size-3.5"
          />
          Fully researched
        </p>
      </article>
    </div>
  </div>
</template>
