<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_ACCENT, RARITY_LABEL, MOD_LABEL, formatModValue, SLOT_ICON, SLOT_LABEL,
  itemPower,
  type HackRarity, type ItemSlot, type ItemMod,
} from '#shared/utils/hack-config'

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
  /** Show the "Equipped / Not equipped" line under the mods. */
  showStatus?: boolean
}>()

defineEmits<{ select: [] }>()

// Power spec first — power is the one stat every item contributes to, so it leads.
const sortedMods = computed(() =>
  [...props.item.mods].sort((a, b) => Number(b.type === 'power_flat') - Number(a.type === 'power_flat')))
</script>

<template>
  <div
    class="relative overflow-hidden rounded-lg border pl-3.5 pr-3 py-3 cursor-pointer transition-colors"
    :class="selected ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/40'"
    @click="$emit('select')"
  >
    <!-- Rarity accent strip -->
    <span class="absolute inset-y-0 left-0 w-1" :class="RARITY_ACCENT[item.rarity]" />

    <!-- Name + rarity -->
    <div class="flex items-start justify-between gap-2 mb-1.5">
      <span class="font-medium text-sm leading-snug">{{ item.name }}</span>
      <UBadge size="xs" :color="RARITY_COLOR[item.rarity]" variant="subtle" :label="RARITY_LABEL[item.rarity]" class="shrink-0" />
    </div>

    <!-- Slot + level chips — type is icon-led + neutral; rarity owns the color -->
    <div class="flex items-center gap-1.5 mb-2">
      <div class="flex items-center gap-1 px-2 py-0.5 rounded-md border border-default bg-elevated text-muted text-sm font-medium">
        <UIcon :name="SLOT_ICON[item.slot]" class="size-3.5" />
        <span>{{ SLOT_LABEL[item.slot] }}</span>
      </div>
      <span class="text-sm text-muted">Lv {{ item.itemLevel }}</span>
      <UBadge v-if="showStatus && item.equippedBy" size="xs" color="primary" variant="subtle" label="Equipped" class="ml-auto" />
    </div>

    <!-- Power benefit — every item provides power (level × 2), Power specs add more -->
    <div class="flex justify-between text-sm pb-1 mb-1 border-b border-default">
      <span class="flex items-center gap-1 text-muted">
        <UIcon name="i-lucide-zap" class="size-3.5" /> Power benefit
      </span>
      <span class="font-bold text-primary">+{{ itemPower(item) }}</span>
    </div>

    <!-- Mods (power spec first) -->
    <div class="space-y-0.5">
      <div v-for="m in sortedMods" :key="m.type" class="flex justify-between text-sm">
        <span class="text-muted">{{ MOD_LABEL[m.type] }}</span>
        <span class="font-semibold text-primary">{{ formatModValue(m.type, m.value) }}</span>
      </div>
    </div>

    <!-- Per-page actions, revealed when selected -->
    <div v-if="selected && $slots.actions" class="space-y-1.5 pt-2 mt-2 border-t border-default" @click.stop>
      <slot name="actions" />
    </div>
  </div>
</template>
