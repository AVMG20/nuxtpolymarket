<script setup lang="ts">
// The cards on one side of a trade, as a wrapping strip of clickable tiles.
// A trade is a judgement call about specific copies, so the offer has to show
// the actual card — clicking a tile hands its viewport rect up so the parent
// can open the 3D lightbox with a proper zoom origin.

import type { TradeCardView } from '~~/server/utils/tcg/trade'
import { legacySetOf } from '#shared/utils/tcg/legacy'

defineProps<{
    cards: TradeCardView[]
    /** Ring colour: what the viewer gains vs. what leaves their collection. */
    tone: 'get' | 'give'
}>()
defineEmits<{ inspect: [card: TradeCardView, event: MouseEvent] }>()

function thumbProps(card: TradeCardView) {
    if (card.render.bundle) return { bundle: card.render.bundle }
    const legacySet = legacySetOf(card.render.plaatjesCardId)
    return legacySet && card.render.assetNumber ? { legacySet, assetNumber: card.render.assetNumber } : null
}
</script>

<template>
    <div class="flex flex-wrap gap-2">
        <button
            v-for="card in cards"
            :key="card.copyId"
            class="w-[74px] cursor-zoom-in rounded text-left transition hover:scale-[1.03]"
            :title="`${card.card.name} · ${card.serial}`"
            @click="$emit('inspect', card, $event)"
        >
            <div
                class="relative rounded ring-1"
                :class="tone === 'get' ? 'ring-success/40' : 'ring-warning/40'"
            >
                <TcgCardThumb
                    v-if="thumbProps(card)"
                    v-bind="thumbProps(card)!"
                />
                <div
                    v-else
                    class="aspect-[0.718] w-full rounded bg-elevated"
                />
                <UBadge
                    v-if="card.grade"
                    color="primary"
                    variant="solid"
                    size="sm"
                    class="absolute bottom-0.5 left-0.5 px-1 py-0 text-[10px] leading-4"
                >{{ card.grade.service }} {{ card.grade.grade }}</UBadge>
            </div>
            <div class="mt-1 truncate text-[11px] font-medium leading-tight text-highlighted">{{ card.card.name }}</div>
            <div class="truncate text-[10px] leading-tight text-muted">{{ card.serial }}</div>
        </button>
    </div>
</template>
