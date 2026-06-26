<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_ACCENT, MOD_LABEL, formatModValue, MOD_RANGES,
  SLOT_ICON, SLOT_LABEL, SLOT_COLOR,
  type HackRarity, type ItemSlot, type ItemMod, type ModType,
} from '#shared/utils/hack-config'

defineProps<{
  item: {
    name: string
    slot: ItemSlot
    itemLevel: number
    rarity: HackRarity
    mods: ItemMod[]
  } | null
  rarityLabel: string
}>()

const open = defineModel<boolean>('open', { default: false })

// Roll quality: what % of the mod's max value did this roll land at.
function rollQuality(type: ModType, value: number): number {
  const range = MOD_RANGES[type]
  return Math.round((value - range.min) / (range.max - range.min) * 100)
}
function rollQualityColor(pct: number) {
  if (pct < 25) return 'text-error'
  if (pct < 55) return 'text-warning'
  return 'text-primary'
}
function formatRangeValue(type: ModType, val: number): string {
  if (type === 'gem_chance' || type === 'item_chance') return `${(val * 100).toFixed(1)}%`
  if (type === 'xp_flat') return `${val} XP`
  if (type === 'gem_bonus') return `${Math.round(val)} gems`
  if (type === 'power_flat') return `${val}`
  return `${val}%`
}
</script>

<template>
  <UModal v-model:open="open" title="Item Pulled" description="Added to your inventory — equip it to an agent on the Agents tab.">
    <template v-if="item" #body>
      <div class="space-y-4">
        <!-- Reveal banner -->
        <div class="relative overflow-hidden rounded-xl border border-default p-4">
          <span class="absolute inset-y-0 left-0 w-1.5" :class="RARITY_ACCENT[item.rarity]" />
          <div class="flex items-center gap-2 mb-3 pl-1.5">
            <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
            <span class="text-xs font-semibold uppercase tracking-wide text-muted">New gear</span>
            <UBadge :color="RARITY_COLOR[item.rarity]" variant="subtle" :label="rarityLabel" class="ml-auto" />
          </div>

          <div class="flex items-start gap-3 pl-1.5">
            <div class="size-14 rounded-xl flex items-center justify-center shrink-0 ring-1"
              :class="[SLOT_COLOR[item.slot].bg, SLOT_COLOR[item.slot].ring]">
              <UIcon :name="SLOT_ICON[item.slot]" class="size-7" :class="SLOT_COLOR[item.slot].text" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-bold text-xl leading-tight">{{ item.name }}</p>
              <div class="flex items-center gap-1.5 mt-1.5">
                <div class="flex items-center gap-1 px-2 py-0.5 rounded-md border text-sm font-medium"
                  :class="[SLOT_COLOR[item.slot].bg, SLOT_COLOR[item.slot].border, SLOT_COLOR[item.slot].text]">
                  <UIcon :name="SLOT_ICON[item.slot]" class="size-3.5" />
                  <span>{{ SLOT_LABEL[item.slot] }}</span>
                </div>
                <span class="text-sm text-muted">Lv {{ item.itemLevel }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Mods -->
        <div class="space-y-1.5">
          <div v-for="m in item.mods" :key="m.type"
            class="flex items-center justify-between p-2 rounded-lg bg-elevated">
            <span class="text-sm text-muted">{{ MOD_LABEL[m.type] }}</span>
            <div class="flex items-center gap-2">
              <span class="text-sm text-muted">max {{ formatRangeValue(m.type, MOD_RANGES[m.type].max) }}</span>
              <span class="font-bold text-base w-16 text-right" :class="rollQualityColor(rollQuality(m.type, m.value))">
                {{ formatModValue(m.type, m.value) }}
              </span>
              <div class="w-16 h-1.5 rounded-full bg-elevated-2 overflow-hidden">
                <div class="h-full rounded-full transition-all"
                  :class="rollQualityColor(rollQuality(m.type, m.value)).replace('text-', 'bg-')"
                  :style="{ width: `${rollQuality(m.type, m.value)}%` }" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer="{ close }">
      <UButton block color="primary" label="Got it" @click="close" />
    </template>
  </UModal>
</template>
