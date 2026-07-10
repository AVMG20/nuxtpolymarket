<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_STYLE, MOD_LABEL, formatModValue, SLOT_ICON, SLOT_LABEL,
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
}>()

defineEmits<{ select: [] }>()

// Power spec first — power is the one stat every item contributes to.
const sortedMods = computed(() => sortModsByPriority(props.item.mods))

const basePower = computed(() => props.item.itemLevel * 2)
const totalPower = computed(() => itemPower(props.item))
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
            size="xs"
            :color="RARITY_COLOR[item.rarity]"
            variant="subtle"
            :label="`${SLOT_LABEL[item.slot]} · Lv ${item.itemLevel}`"
            class="shrink-0"
          />
        </div>

        <p class="text-xs text-muted font-mono mt-1">
          Base <b class="text-primary">+{{ basePower }}</b> · total <b class="text-primary">{{ totalPower }} PWR</b>
          <UBadge
            v-if="showStatus && item.equippedBy"
            size="xs"
            color="primary"
            variant="subtle"
            label="Equipped"
            class="ml-1.5 align-middle"
          />
        </p>

        <div class="flex flex-wrap gap-1.5 mt-2.5">
          <HackModChip
            v-for="m in sortedMods"
            :key="m.type"
            :label="MOD_LABEL[m.type]"
            :value="formatModValue(m.type, m.value)"
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
