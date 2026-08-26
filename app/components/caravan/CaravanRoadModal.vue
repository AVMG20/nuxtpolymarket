<script setup lang="ts">
import {
    BASE_TRAVEL_SPEED, MAX_ROAD_LEVEL, ROAD_COLORS, ROAD_NAMES,
    roadCost, roadResourceCost, roadSpeedMultiplier, roadUpgradeTier
} from '#shared/utils/caravan/config'

/**
 * A single road, opened by clicking it on the map.
 *
 * Roads used to be a list stapled to the bottom of whichever node you had open,
 * which buried the seam you actually came to look at under five stubs of road.
 * A road is its own thing, so it gets its own panel and is reached by clicking
 * the road itself.
 */

const props = defineProps<{ edgeId: string | null }>()
const emit = defineEmits<{ close: [] }>()

const { state, world, bonuses, upgradeRoad } = useCaravan()
const { user } = useAuth()

const balance = computed(() => Number.parseFloat(user.value?.balance ?? '0'))
const passable = computed(() => new Set([...(state.value?.ownedNodes ?? []), ...(state.value?.clearedCamps ?? [])]))

const open = computed({
    get: () => props.edgeId !== null,
    set: (value: boolean) => { if (!value) emit('close') }
})

const road = computed(() => {
    if (!props.edgeId || !state.value) return null
    const edge = world.value.edges.find(e => e.id === props.edgeId)
    if (!edge) return null

    const level = state.value.roads[edge.id] ?? 0
    const maxed = level >= MAX_ROAD_LEVEL
    const resources = maxed ? {} : roadResourceCost(level)
    const coins = maxed ? 0 : roadCost(level)

    return {
        edge,
        level,
        maxed,
        a: world.value.nodes[edge.a]!,
        b: world.value.nodes[edge.b]!,
        linked: passable.value.has(edge.a) && passable.value.has(edge.b),
        name: ROAD_NAMES[level],
        nextName: ROAD_NAMES[Math.min(MAX_ROAD_LEVEL, level + 1)],
        current: roadSpeedMultiplier(level),
        next: roadSpeedMultiplier(level + 1),
        coins,
        resources,
        requiredTier: roadUpgradeTier(level),
        // Travel time at base speed, which is the number the multiplier is
        // actually shaving -- a percentage on its own says nothing about whether
        // this road is worth paving before the next one.
        seconds: edge.length / (BASE_TRAVEL_SPEED * roadSpeedMultiplier(level)),
        nextSeconds: edge.length / (BASE_TRAVEL_SPEED * roadSpeedMultiplier(level + 1)),
        affordable: balance.value >= coins
            && Object.entries(resources).every(([id, count]) => (state.value?.resources[id] ?? 0) >= count)
    }
})

const canBuild = computed(() =>
    Boolean(road.value)
    && !road.value!.maxed
    && road.value!.linked
    && road.value!.affordable
    && (state.value?.tier ?? 1) >= road.value!.requiredTier)

function duration(seconds: number): string {
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
    return `${Math.round(seconds)}s`
}

async function build() {
    if (!road.value) return
    await upgradeRoad(road.value.edge.id)
}
</script>

<template>
    <UModal v-model:open="open" :ui="{ content: 'max-w-md' }">
        <template #content>
            <div v-if="road" class="divide-y divide-default/60">
                <div class="px-5 py-4">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="truncate text-lg font-semibold">
                                {{ road.a.name }} <span class="text-muted">↔</span> {{ road.b.name }}
                            </div>
                            <div class="text-xs uppercase tracking-wide text-muted">
                                {{ road.name }} · stage {{ road.level }} of {{ MAX_ROAD_LEVEL }}
                            </div>
                        </div>
                        <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" @click="emit('close')" />
                    </div>

                    <!-- The ladder, so the stage you are on reads without counting. -->
                    <div class="mt-3 flex items-center gap-1">
                        <span
                            v-for="(stage, index) in ROAD_NAMES"
                            :key="stage"
                            class="h-1.5 flex-1 rounded-full"
                            :style="{
                                backgroundColor: ROAD_COLORS[index],
                                opacity: index <= road.level ? 1 : 0.18
                            }"
                            :title="stage"
                        />
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-px bg-default/60">
                    <div class="bg-elevated/30 px-5 py-3">
                        <div class="text-[11px] uppercase tracking-wide text-muted">Speed</div>
                        <div class="font-mono text-lg font-semibold text-success">×{{ road.current.toFixed(2) }}</div>
                    </div>
                    <div class="bg-elevated/30 px-5 py-3">
                        <div class="text-[11px] uppercase tracking-wide text-muted">Crossing</div>
                        <div class="font-mono text-lg font-semibold">{{ duration(road.seconds) }}</div>
                    </div>
                </div>

                <div class="space-y-3 px-5 py-4">
                    <div v-if="!road.linked" class="rounded-lg border border-default/60 bg-elevated/30 px-3 py-2 text-sm text-muted">
                        Nothing runs down this road yet — you hold only one of its two ends. Claim
                        <span class="text-default">{{ passable.has(road.edge.a) ? road.b.name : road.a.name }}</span>
                        and it joins your network.
                    </div>

                    <div v-else-if="road.maxed" class="rounded-lg border border-success/40 bg-success/5 px-3 py-2 text-sm text-success">
                        An imperial causeway. This road is as fast as roads get.
                    </div>

                    <template v-else>
                        <div class="flex items-baseline justify-between text-sm">
                            <span class="font-medium">Build {{ road.nextName }}</span>
                            <CoinBalance :value="road.coins" :danger="balance < road.coins" class="text-sm" />
                        </div>
                        <div class="flex items-center gap-2 text-xs text-muted">
                            <span class="font-mono text-success">×{{ road.current.toFixed(2) }}</span>
                            <UIcon name="i-lucide-arrow-right" class="size-3" />
                            <span class="font-mono text-success">×{{ road.next.toFixed(2) }}</span>
                            <span class="ml-auto font-mono">
                                {{ duration(road.seconds) }} → {{ duration(road.nextSeconds) }}
                            </span>
                        </div>

                        <CaravanResource
                            v-for="(count, id) in road.resources"
                            :key="id"
                            :id="id"
                            :amount="count"
                            :have="state?.resources[id] ?? 0"
                            class="flex w-full justify-between"
                        />

                        <UButton
                            block
                            icon="i-lucide-hard-hat"
                            :label="(state?.tier ?? 1) < road.requiredTier ? `Requires tier ${road.requiredTier}` : `Build ${road.nextName}`"
                            :disabled="!canBuild"
                            @click="build"
                        />
                    </template>

                    <p v-if="bonuses?.speed" class="text-[11px] text-muted">
                        Research is adding {{ bonuses.speed }}% to every worker's pace on top of whatever this road is worth.
                    </p>
                </div>
            </div>
        </template>
    </UModal>
</template>
