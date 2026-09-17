<template>
    <div class="vc">
        <span v-if="coins && coins > 0" class="vc-item" :class="{ 'vc-short': (balance ?? 0) < coins }">
            <UIcon name="i-lucide-coins" class="size-3" />{{ formatNumber(coins) }}
        </span>
        <span v-if="gems && gems > 0" class="vc-item vc-gem" :class="{ 'vc-short': (gemsHeld ?? 0) < gems }">
            <UIcon name="i-lucide-gem" class="size-3" />{{ formatNumber(gems) }}
        </span>
        <span v-for="item in items" :key="item.id" class="vc-item" :class="{ 'vc-short': item.short }" :title="item.name">
            <i class="vr-gem" :style="{ '--c': item.hex }" />{{ formatNumber(item.amount) }}
        </span>
        <span v-if="!items.length && !coins && !gems" class="vc-free">Free</span>
    </div>
</template>

<script setup lang="ts">
import { VOID_RESOURCE_IDS, voidHex, voidResource, type VoidResourceBundle } from '#shared/utils/gamelogic/void'

const props = defineProps<{
    cost: VoidResourceBundle
    held: VoidResourceBundle
    coins?: number
    balance?: number
    gems?: number
    gemsHeld?: number
}>()

const items = computed(() => VOID_RESOURCE_IDS
    .filter(id => (props.cost[id] ?? 0) > 0)
    .map(id => ({
        id,
        name: voidResource(id).name,
        hex: voidHex(voidResource(id).color),
        amount: props.cost[id]!,
        short: (props.held[id] ?? 0) < props.cost[id]!
    })))
</script>

<style>
.vc { display: flex; flex-wrap: wrap; gap: 4px 10px; }
.vc-item { display: inline-flex; align-items: center; gap: 5px; font: 600 12px 'JetBrains Mono', monospace; }
.vc-gem { color: #d7b8ff; }
.vc-short { color: #ff8095; }
.vc-free { font-size: 12px; color: var(--vr-muted); }
</style>
