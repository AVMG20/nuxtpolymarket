<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_STYLE, RARITY_LABEL, MOD_LABEL, formatModValue, SLOT_ICON, SLOT_LABEL,
  itemPower,
  type HackRarity, type ItemSlot, type ItemMod
} from '#shared/utils/hack-config'

// The one item card used everywhere an item is displayed (Items, Loadout,
// Agents gear). Per PLAN.md §10.4: base power (from level) is shown as its
// own row, separate from the rolled mod list, even though a power_flat mod
// (if any) contributes to both the "total" figure and its own chip below.
const props = defineProps<{
  item: {
    id: string
    name: string
    slot: ItemSlot
    itemLevel: number
    rarity: HackRarity
    mods: ItemMod[]
    equippedBy?: string | null
  }
  selected?: boolean
  /** Show the "Equipped" badge when the item is on an agent. */
  showStatus?: boolean
}>()

defineEmits<{ select: [] }>()

// Power spec first — power is the one stat every item contributes to.
const sortedMods = computed(() =>
  [...props.item.mods].sort((a, b) => Number(b.type === 'power_flat') - Number(a.type === 'power_flat')))

const basePower = computed(() => props.item.itemLevel * 2)
const totalPower = computed(() => itemPower(props.item))
</script>

<template>
  <HackFrame
    tight
    class="relative pl-4 pr-3.5 py-3.5 cursor-pointer transition-colors"
    :class="selected ? 'hack-frame-accent' : 'hover:border-primary/40'"
    @click="$emit('select')"
  >
    <span
      class="absolute inset-y-0 left-0 w-1"
      :class="RARITY_STYLE[item.rarity].bg"
    />

    <div class="flex items-start justify-between gap-2 mb-1.5">
      <span class="hack-card-title-lg leading-snug">{{ item.name }}</span>
      <UBadge
        size="xs"
        :color="RARITY_COLOR[item.rarity]"
        variant="subtle"
        :label="RARITY_LABEL[item.rarity]"
        class="shrink-0"
      />
    </div>

    <div class="flex items-center gap-1.5 mb-3">
      <div class="flex items-center gap-1 px-2 py-0.5 rounded-md border border-default bg-elevated text-muted text-sm font-medium">
        <UIcon
          :name="SLOT_ICON[item.slot]"
          class="size-3.5"
        />
        <span>{{ SLOT_LABEL[item.slot] }}</span>
      </div>
      <span class="text-sm text-muted">Lv {{ item.itemLevel }}</span>
      <UBadge
        v-if="showStatus && item.equippedBy"
        size="xs"
        color="primary"
        variant="subtle"
        label="Equipped"
        class="ml-auto"
      />
    </div>

    <div class="flex items-baseline justify-between pb-2.5 mb-2.5 border-b border-default">
      <span class="hack-stat-label-md">Base power (Lv × 2)</span>
      <span class="flex items-baseline gap-1.5">
        <span class="text-sm text-muted">+{{ basePower }}</span>
        <b class="hack-stat-value-lg text-primary">{{ totalPower }} PWR</b>
      </span>
    </div>

    <div class="flex flex-wrap gap-1.5">
      <HackModChip
        v-for="m in sortedMods"
        :key="m.type"
        :label="MOD_LABEL[m.type]"
        :value="formatModValue(m.type, m.value)"
      />
    </div>

    <div
      v-if="selected && $slots.actions"
      class="space-y-1.5 pt-3 mt-3 border-t border-default"
      @click.stop
    >
      <slot name="actions" />
    </div>
  </HackFrame>
</template>
