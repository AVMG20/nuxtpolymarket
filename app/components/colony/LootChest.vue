<script setup lang="ts">
interface Loot { itemTypeId: string, emoji: string, name: string, quantity: number }
interface FloatText { id: number, text: string, x: number }

const props = defineProps<{
  loot: Loot[]
  /** Loot worth a good while of foraging: rays and a bounce. */
  overflowing: boolean
  busy: boolean
  floats: FloatText[]
}>()

const emit = defineEmits<{ collect: [] }>()

const total = computed(() => props.loot.reduce((sum, item) => sum + item.quantity, 0))
const state = computed<'empty' | 'filling' | 'overflowing'>(() => {
  if (!total.value) return 'empty'
  return props.overflowing ? 'overflowing' : 'filling'
})
const lid = computed(() => ({ empty: 0, filling: 0.45, overflowing: 1 })[state.value])

function collect() {
  if (total.value && !props.busy) emit('collect')
}
</script>

<template>
  <div class="flex items-end gap-3">
    <!-- What's inside (sm+) -->
    <div
      v-if="total"
      class="cl-panel cl-pop-in hidden sm:flex flex-col gap-1.5 px-3 py-2.5 mb-3 border-amber-400/55 max-w-80"
    >
      <div class="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[13px] font-semibold cl-num">
        <span
          v-for="item in loot.slice(0, 6)"
          :key="item.itemTypeId"
          :title="item.name"
        >{{ item.emoji }} {{ formatNumber(item.quantity) }}</span>
        <span
          v-if="loot.length > 6"
          class="text-muted"
        >+{{ loot.length - 6 }}</span>
      </div>
      <button
        type="button"
        class="cl-btn cl-btn-gold cl-btn-sm"
        :class="state === 'overflowing' && 'cl-btn-pulse'"
        :disabled="busy"
        @click="collect"
      >
        Collect {{ formatNumber(total, false) }} {{ total === 1 ? 'item' : 'items' }}
      </button>
    </div>

    <!-- The chest itself (sm+) -->
    <button
      type="button"
      class="cl-chest hidden sm:grid"
      :class="state === 'empty' ? 'opacity-60' : 'cl-chest-ready'"
      :disabled="!total || busy"
      :aria-label="total ? `Collect ${formatNumber(total, false)} items from the loot chest` : 'The loot chest is empty'"
      :title="total ? undefined : 'New forage lands here as soon as a cycle completes.'"
      @click="collect"
    >
      <span
        class="relative block"
      >
        <ColonyChestIcon
          :open="lid"
          :width="96"
        />
        <span
          v-if="total"
          class="cl-count-bubble cl-num"
        >{{ formatNumber(total) }}</span>
      </span>
    </button>

    <!-- Phone: a compact chest button -->
    <button
      type="button"
      class="cl-btn cl-btn-sm sm:hidden pl-1.5"
      :class="total ? ['cl-btn-gold', state === 'overflowing' && 'cl-btn-pulse'] : 'cl-btn-ghost'"
      :disabled="!total || busy"
      @click="collect"
    >
      <ColonyChestIcon
        :open="lid"
        :width="30"
      />
      {{ total ? `Collect ${formatNumber(total)}` : 'Chest empty' }}
    </button>

    <span
      v-for="f in floats"
      :key="f.id"
      class="cl-float bottom-full"
      :style="{ left: f.x + '%' }"
    >{{ f.text }}</span>
  </div>
</template>
