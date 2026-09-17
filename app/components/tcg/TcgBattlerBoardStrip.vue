<script setup lang="ts">
/**
 * A finished battler board as a compact trophy strip (§12.10): stadium
 * first, then the units active-to-bench with level and item badges.
 */
import type { BattleUnit } from '#shared/utils/battler/combat'
import type { BattlerStadiumEffect } from '#shared/utils/battler/items'
import { levelFor } from '#shared/utils/battler/shop'
import { legacySetOf } from '#shared/utils/tcg/legacy'

interface Render { bundle: string | null, plaatjesCardId: string | null, assetNumber: string | null }

const props = defineProps<{
    units: (BattleUnit & { render: Render })[]
    stadium: { name: string, effect: BattlerStadiumEffect } | null
}>()

function renderThumb(render: Render) {
    if (render.bundle) return { bundle: render.bundle }
    const legacySet = render.plaatjesCardId ? legacySetOf(render.plaatjesCardId) : null
    return legacySet && render.assetNumber ? { legacySet, assetNumber: render.assetNumber } : null
}

const stadiumUnit = computed(() => {
    if (!props.stadium) return null
    // The stadium card's render travels on the units' snapshots only for
    // itself — it has no unit entry, so show a labeled tile.
    return props.stadium
})
</script>

<template>
    <div class="flex flex-wrap items-start gap-1.5">
        <UTooltip
            v-if="stadiumUnit"
            :text="`${stadiumUnit.name} — affected both teams`"
        >
            <div class="flex aspect-[0.718] w-14 flex-col items-center justify-center gap-0.5 rounded border border-info/50 bg-info/10 text-info">
                <span class="text-base">🏟️</span>
                <span class="w-full truncate px-0.5 text-center text-[8px] leading-tight">{{ stadiumUnit.name }}</span>
            </div>
        </UTooltip>
        <div
            v-for="unit in units"
            :key="unit.key"
            class="relative w-14"
        >
            <template v-if="renderThumb(unit.render)">
                <TcgCardThumb v-bind="renderThumb(unit.render)!" />
            </template>
            <div
                v-else
                class="flex aspect-[0.718] w-full items-center justify-center rounded bg-elevated px-0.5 text-center text-[8px] text-muted"
            >
                {{ unit.spec.name }}
            </div>
            <UBadge
                v-if="levelFor(unit.instances) > 1"
                color="secondary"
                size="sm"
                class="absolute -left-1 -top-1 z-10 px-1 py-0 text-[9px]"
            >
                L{{ levelFor(unit.instances) }}
            </UBadge>
            <UTooltip
                v-if="(unit.items ?? []).length > 0"
                :text="(unit.items ?? []).map(item => item.name).join(', ')"
            >
                <span class="absolute -right-0.5 bottom-0 z-10 text-[10px] drop-shadow">🔧</span>
            </UTooltip>
        </div>
    </div>
</template>
