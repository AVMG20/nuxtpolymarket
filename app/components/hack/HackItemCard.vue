<script setup lang="ts">
import {
  RARITY_STYLE, RARITY_ACCENT, MOD_LABEL, MOD_RANGES, formatModValue, rollPct, SLOT_ICON,
  itemPower, sortModsByPriority,
  type HackRarity, type ItemSlot, type ItemMod
} from '#shared/utils/hack-config'

// The one item card used everywhere an item is displayed (Items, Loadout,
// Agents gear). Mirrors mockups/shared.js itemCardHTML: rarity-tinted slot
// icon on the left, rarity-colored title, a "base power / total PWR" sub-line,
// then the rolled mod chips.
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
  /** Render the actions slot always (Items page), not only when selected. */
  actionsAlways?: boolean
  /** Loadout-only: the currently-equipped item's mods in this slot, so each of
   * this item's rolled traits can be colored green/red against it. */
  compare?: { equippedMods: ItemMod[] } | null
}>()

defineEmits<{ select: [] }>()

// Power spec first — power is the one stat every item contributes to.
const sortedMods = computed(() => sortModsByPriority(props.item.mods))

const basePower = computed(() => props.item.itemLevel * 2)
const totalPower = computed(() => itemPower(props.item))

// Per-trait upgrade/downgrade signal vs. the equipped item — only colored when
// both items roll the same mod type, so we're never implying a verdict on a
// trait the equipped item simply doesn't have.
function compareDirFor(mod: ItemMod): 'up' | 'down' | 'same' | null {
  const equipped = props.compare?.equippedMods.find(m => m.type === mod.type)
  if (!equipped) return null
  if (mod.value > equipped.value) return 'up'
  if (mod.value < equipped.value) return 'down'
  return 'same'
}
</script>

<template>
  <HackFrame
    tight
    class="p-3.5 transition-colors"
    :class="[
      selected ? 'hack-frame-accent' : 'hover:border-primary/40',
      !actionsAlways && 'cursor-pointer'
    ]"
    @click="!actionsAlways && $emit('select')"
  >
    <!-- Rarity strip — same treatment as the Agents page's equipped-gear rows,
         so an item's rarity reads identically wherever it's shown. -->
    <span
      class="absolute inset-y-0 left-0 w-1"
      :class="RARITY_ACCENT[item.rarity]"
    />

    <div class="flex items-start gap-3.5">
      <!-- Slot icon, rarity-tinted (the mockup's left icon column) -->
      <div
        class="size-12 shrink-0 flex items-center justify-center border"
        :class="[RARITY_STYLE[item.rarity].bg, RARITY_STYLE[item.rarity].border, RARITY_STYLE[item.rarity].text]"
      >
        <UIcon
          :name="SLOT_ICON[item.slot]"
          class="size-5"
        />
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between gap-2 flex-wrap">
          <span
            class="hack-card-title-lg leading-snug"
            :class="RARITY_STYLE[item.rarity].text"
          >{{ item.name }}</span>
          <UBadge
            v-if="showStatus && item.equippedBy"
            size="xs"
            color="primary"
            variant="subtle"
            label="Equipped"
            class="shrink-0"
          />
        </div>

        <p class="text-sm font-mono font-bold text-zinc-100 mt-0.5">
          Level {{ item.itemLevel }}
        </p>

        <p class="text-xs text-muted font-mono mt-1">
          Base <b class="text-primary">+{{ basePower }}</b> · total <b class="text-primary">{{ totalPower }} PWR</b>
        </p>

        <div class="flex flex-wrap gap-1.5 mt-2.5">
          <HackModChip
            v-for="m in sortedMods"
            :key="m.type"
            :label="MOD_LABEL[m.type]"
            :value="formatModValue(m.type, m.value)"
            :pct="rollPct(MOD_RANGES[m.type], m.value)"
            :value-max="formatModValue(m.type, MOD_RANGES[m.type].max)"
            :compare-dir="compareDirFor(m)"
          />
        </div>
      </div>
    </div>

    <div
      v-if="(selected || actionsAlways) && $slots.actions"
      class="pt-3 mt-3 border-t border-default"
      @click.stop
    >
      <slot name="actions" />
    </div>
  </HackFrame>
</template>
