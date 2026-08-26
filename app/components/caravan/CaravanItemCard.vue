<script setup lang="ts">
import { AFFIX_BY_STAT, CATEGORY_COLORS, MAKE_BY_ID, RARITY_BY_ID, TIERS } from '#shared/utils/caravan/config'
import { affixCategory, affixRange, itemBase } from '#shared/utils/caravan/items'
import type { Item } from '#shared/utils/caravan/types'

/**
 * One item. The quality bar behind each affix is the whole point: it shows where
 * this roll landed inside the range it could have hit, so a lucky common reads as
 * clearly good and an unlucky legendary reads as clearly disappointing.
 */

const props = defineProps<{ item: Item, selected?: boolean, compact?: boolean }>()

const rarity = computed(() => RARITY_BY_ID[props.item.rarity])
const base = computed(() => itemBase(props.item))
const tier = computed(() => TIERS[props.item.tier - 1] ?? TIERS[0]!)
const make = computed(() => MAKE_BY_ID[props.item.make] ?? MAKE_BY_ID.dwarven)

const affixes = computed(() => props.item.affixes.map((affix) => {
    const [min, max] = affixRange(affix.stat, props.item.tier, props.item.rarity)
    const category = affixCategory(affix.stat)
    return {
        ...affix,
        label: AFFIX_BY_STAT[affix.stat].name,
        // Category affixes are coloured by their trade, so a wall of items can be
        // scanned for "which of these is an ore piece" at a glance.
        color: category ? CATEGORY_COLORS[category] : null,
        min,
        max,
        // Where the roll sits in its range, for the bar. Guard the degenerate
        // case where min and max collapse onto the same value.
        fill: max > min ? (affix.value - min) / (max - min) : 1
    }
}))
</script>

<template>
    <div
        class="relative overflow-hidden rounded-xl border bg-elevated/40 transition"
        :class="[selected ? 'ring-2 ring-primary' : '', compact ? 'p-2.5' : 'p-3']"
        :style="{ borderColor: rarity.color + '55' }"
    >
        <div
            class="pointer-events-none absolute inset-x-0 top-0 h-16 opacity-25"
            :style="{ background: `radial-gradient(120% 100% at 50% 0%, ${rarity.color}, transparent 70%)` }"
        />

        <div class="relative flex items-start justify-between gap-2">
            <div class="min-w-0">
                <div class="truncate text-sm font-semibold" :style="{ color: rarity.color }">
                    {{ base.name }}
                </div>
                <div class="text-[11px] uppercase tracking-wide text-muted">
                    {{ rarity.name }} · T{{ item.tier }} {{ tier.name }}
                </div>
                <div class="mt-0.5 flex items-center gap-1 text-[11px]">
                    <span class="size-1.5 rounded-full" :style="{ backgroundColor: make.color }" />
                    <span :style="{ color: make.color }">{{ make.name }}</span>
                    <span v-if="item.reforges" class="text-muted">· reforged {{ item.reforges }}×</span>
                </div>
            </div>
            <UBadge size="sm" color="neutral" variant="subtle" :label="base.slot" />
        </div>

        <div class="relative mt-2.5 space-y-1.5">
            <div v-for="affix in affixes" :key="affix.stat">
                <div class="flex items-baseline justify-between gap-2 text-xs">
                    <span :style="affix.color ? { color: affix.color } : {}" :class="affix.color ? '' : 'text-muted'">
                        {{ affix.label }}
                    </span>
                    <span class="font-mono font-semibold text-default">+{{ affix.value }}%</span>
                </div>
                <div class="mt-0.5 h-1 overflow-hidden rounded-full bg-default/60">
                    <div
                        class="h-full rounded-full"
                        :style="{ width: `${Math.max(3, affix.fill * 100)}%`, backgroundColor: affix.color ?? rarity.color }"
                    />
                </div>
            </div>
            <div v-if="!affixes.length" class="text-xs text-muted">No affixes rolled.</div>
        </div>

        <slot />
    </div>
</template>
