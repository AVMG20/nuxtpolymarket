<script setup lang="ts">
import {
    CATEGORY_COLORS, CATEGORY_ICONS, CATEGORY_NAMES,
    ITEM_SLOTS, MAKE_BY_ID, RARITY_BY_ID, RESOURCES,
    SET_THRESHOLD_GREATER, SET_THRESHOLD_LESSER, SLOT_ICONS, SLOT_NAMES, TIERS
} from '#shared/utils/caravan/config'
import { activeSets, itemScore, makeCounts } from '#shared/utils/caravan/items'
import {
    MAX_WORKER_LEVEL, combatPower, derivedStats, levelProgress, rarityGrowth, xpForLevel
} from '#shared/utils/caravan/workers'
import type { Item, ItemSlot, Worker } from '#shared/utils/caravan/types'

/**
 * The roster.
 *
 * Nobody is assigned to anything here -- work is decided by node priority, so
 * this screen is about who your workers *are*: what they specialise in, what
 * they are wearing, and which of them deserve the good gear. The roster table is
 * the default past a handful of workers because at twenty it is the only view
 * that fits on a screen.
 */

const { state, world, bonuses, equipItem, dismissWorker, autoEquip, renameWorker } = useCaravan()

const workers = computed(() => state.value?.workers ?? [])

const view = ref<'cards' | 'roster'>('cards')
watch(workers, (list, previous) => {
    if (previous?.length === undefined && list.length > 6) view.value = 'roster'
}, { immediate: true })

const picking = ref<{ workerId: string, slot: ItemSlot } | null>(null)
const pickerOpen = computed({
    get: () => picking.value !== null,
    set: (value: boolean) => { if (!value) picking.value = null }
})

/**
 * Dismissing is permanent and irreversible, and the button sits next to rename
 * in a dense roster -- it asks first.
 */
const dismissing = ref<Worker | null>(null)
const dismissOpen = computed({
    get: () => dismissing.value !== null,
    set: (value: boolean) => { if (!value) dismissing.value = null }
})

async function confirmDismiss() {
    if (!dismissing.value) return
    await dismissWorker(dismissing.value.id)
    dismissing.value = null
}

const renaming = ref<{ id: string, name: string } | null>(null)
const renameOpen = computed({
    get: () => renaming.value !== null,
    set: (value: boolean) => { if (!value) renaming.value = null }
})

async function commitRename() {
    if (!renaming.value?.name.trim()) return
    await renameWorker(renaming.value.id, renaming.value.name.trim())
    renaming.value = null
}

/** Items that fit the slot being filled, best first, equipped ones marked. */
const pickable = computed(() => {
    if (!picking.value || !state.value) return []
    const equippedElsewhere = new Set(
        state.value.workers
            .filter(w => w.id !== picking.value!.workerId)
            .flatMap(w => Object.values(w.equipment))
    )
    return state.value.items
        .filter(i => i.slot === picking.value!.slot)
        .map(i => ({ item: i, taken: equippedElsewhere.has(i.id) }))
        .sort((a, b) => itemScore(b.item) - itemScore(a.item))
})

function stats(worker: Worker) {
    if (!state.value || !bonuses.value) return null
    return derivedStats(worker, state.value.items, bonuses.value)
}

function equipped(worker: Worker, slot: ItemSlot): Item | null {
    const id = worker.equipment[slot]
    return id ? state.value?.items.find(i => i.id === id) ?? null : null
}

function wornItems(worker: Worker): Item[] {
    return ITEM_SLOTS.map(slot => equipped(worker, slot)).filter((i): i is Item => Boolean(i))
}

function gearScore(worker: Worker): number {
    return wornItems(worker).reduce((sum, item) => sum + itemScore(item), 0)
}

function emptySlots(worker: Worker): number {
    return ITEM_SLOTS.filter(slot => !worker.equipment[slot]).length
}

function cargoLine(worker: Worker): string | null {
    const entries = Object.entries(worker.cargo).filter(([, count]) => count > 0)
    if (!entries.length) return null
    return entries.map(([id, count]) => `${formatNumber(count)} ${RESOURCES[id]?.name ?? id}`).join(', ')
}

function nodeName(id: number | null) {
    if (id === null) return 'Unassigned'
    return world.value.nodes[id]?.name ?? `Node ${id}`
}

function activityLabel(worker: Worker): string {
    switch (worker.activity.type) {
        case 'travel': return `Walking to ${nodeName(worker.activity.to)}`
        case 'harvest': return `Working ${nodeName(worker.activity.at)}`
        case 'unload': return 'Unloading'
        case 'assault': return `Assaulting ${nodeName(worker.activity.at)}`
        case 'starving': return 'Out of rations'
        default: return worker.assignment === null ? 'Waiting for work' : 'Idle'
    }
}

function activityColor(worker: Worker): string {
    switch (worker.activity.type) {
        case 'starving': return 'text-error'
        case 'assault': return 'text-warning'
        case 'idle': return 'text-muted'
        default: return 'text-default'
    }
}

const starvingCount = computed(() => workers.value.filter(w => w.activity.type === 'starving').length)
const waitingCount = computed(() => workers.value.filter(w => w.assignment === null).length)
const unequippedSlots = computed(() => workers.value.reduce((sum, w) => sum + emptySlots(w), 0))
</script>

<template>
    <div class="absolute inset-0 overflow-y-auto p-5">
        <div class="mx-auto max-w-7xl space-y-5">
            <div class="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 class="text-xl font-semibold">Workers</h1>
                    <p class="text-sm text-muted">
                        {{ workers.length }} of {{ bonuses?.maxWorkers ?? 3 }} slots filled.
                        <span v-if="waitingCount" class="text-warning">{{ waitingCount }} waiting for a free seam.</span>
                        <span v-if="starvingCount" class="text-error"> {{ starvingCount }} out of rations.</span>
                    </p>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                    <UButton
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-shield-check"
                        :label="unequippedSlots ? `Refit everyone (${unequippedSlots} empty)` : 'Refit everyone'"
                        :disabled="!workers.length || !state?.items.length"
                        @click="autoEquip()"
                    />
                    <UButton to="/caravan/market" icon="i-lucide-users-round" label="Recruit" />
                </div>
            </div>

            <!-- Where work comes from now. -->
            <div class="flex flex-wrap items-center gap-3 rounded-xl border border-default/60 bg-elevated/30 px-4 py-3">
                <UIcon name="i-lucide-list-ordered" class="size-5 shrink-0 text-muted" />
                <p class="min-w-56 flex-1 text-xs text-muted">
                    Workers are never assigned by hand. They take the highest-priority seam that still has room, and a
                    specialist reads a seam in their own trade as one step higher than it is set. Steer them from the
                    <NuxtLink to="/caravan" class="cursor-pointer text-primary hover:underline">map</NuxtLink>.
                </p>
            </div>

            <div v-if="workers.length" class="flex flex-wrap items-center gap-3">
                <div class="flex items-center gap-1 rounded-lg bg-elevated/50 p-0.5">
                    <UButton
                        size="xs"
                        color="neutral"
                        :variant="view === 'cards' ? 'soft' : 'ghost'"
                        icon="i-lucide-layout-grid"
                        label="Cards"
                        @click="view = 'cards'"
                    />
                    <UButton
                        size="xs"
                        color="neutral"
                        :variant="view === 'roster' ? 'soft' : 'ghost'"
                        icon="i-lucide-list"
                        label="Roster"
                        @click="view = 'roster'"
                    />
                </div>
            </div>

            <div v-if="!workers.length" class="rounded-xl border border-dashed border-default/60 p-10 text-center text-muted">
                No workers yet. The recruitment market posts a new slate every twelve hours.
            </div>

            <!-- Roster -->
            <div v-else-if="view === 'roster'" class="overflow-hidden rounded-xl border border-default/60">
                <div class="overflow-x-auto">
                    <table class="w-full min-w-[58rem] text-sm">
                        <thead class="bg-elevated/50 text-left text-xs uppercase tracking-wide text-muted">
                            <tr>
                                <th class="px-3 py-2">Worker</th>
                                <th class="px-3 py-2">Trades</th>
                                <th class="px-3 py-2">Doing</th>
                                <th class="px-3 py-2 text-right">Rations</th>
                                <th class="px-3 py-2 text-right">Carry</th>
                                <th class="px-3 py-2 text-right">Strength</th>
                                <th class="px-3 py-2 text-right">Gear</th>
                                <th class="w-20 px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="worker in workers"
                                :key="worker.id"
                                class="border-t border-default/40 transition hover:bg-elevated/40"
                            >
                                <td class="px-3 py-2">
                                    <div class="flex items-center gap-2">
                                        <span
                                            class="grid size-6 shrink-0 place-items-center rounded-full border text-[10px] font-bold"
                                            :style="{ borderColor: TIERS[worker.tier - 1]?.color, color: TIERS[worker.tier - 1]?.glow }"
                                        >{{ worker.level }}</span>
                                        <span class="truncate font-medium">{{ worker.name }}</span>
                                        <span
                                            class="size-1.5 shrink-0 rounded-full"
                                            :style="{ backgroundColor: RARITY_BY_ID[worker.rarity].color }"
                                            :title="RARITY_BY_ID[worker.rarity].name"
                                        />
                                    </div>
                                </td>
                                <td class="px-3 py-2">
                                    <div class="flex items-center gap-1">
                                        <UTooltip
                                            v-for="category in worker.specialties"
                                            :key="category"
                                            :text="CATEGORY_NAMES[category]"
                                        >
                                            <UIcon
                                                :name="CATEGORY_ICONS[category]"
                                                class="size-4"
                                                :style="{ color: CATEGORY_COLORS[category] }"
                                            />
                                        </UTooltip>
                                    </div>
                                </td>
                                <td class="px-3 py-2" :class="activityColor(worker)">
                                    {{ activityLabel(worker) }}
                                    <span v-if="cargoLine(worker)" class="text-xs text-primary">· {{ cargoLine(worker) }}</span>
                                </td>
                                <td class="px-3 py-2 text-right font-mono" :class="worker.food > 40 ? '' : worker.food > 15 ? 'text-warning' : 'text-error'">
                                    {{ Math.round(worker.food) }}%
                                </td>
                                <td class="px-3 py-2 text-right font-mono">{{ stats(worker)?.carry }}</td>
                                <td class="px-3 py-2 text-right font-mono text-error">{{ formatNumber(combatPower(stats(worker)!)) }}</td>
                                <td class="px-3 py-2 text-right">
                                    <span class="font-mono">{{ Math.round(gearScore(worker)) }}</span>
                                    <span v-if="emptySlots(worker)" class="ml-1 text-xs text-warning">
                                        {{ emptySlots(worker) }} empty
                                    </span>
                                </td>
                                <td class="px-3 py-2">
                                    <div class="flex justify-end gap-1">
                                        <UButton
                                            icon="i-lucide-pencil"
                                            size="xs"
                                            color="neutral"
                                            variant="ghost"
                                            aria-label="Rename"
                                            @click="renaming = { id: worker.id, name: worker.name }"
                                        />
                                        <UButton
                                            icon="i-lucide-user-x"
                                            size="xs"
                                            color="neutral"
                                            variant="ghost"
                                            aria-label="Dismiss"
                                            @click="dismissing = worker"
                                        />
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Cards -->
            <div v-else class="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                <div
                    v-for="worker in workers"
                    :key="worker.id"
                    class="overflow-hidden rounded-xl border border-default/60 bg-elevated/30"
                >
                    <div
                        class="flex items-center gap-3 border-b border-default/50 px-4 py-3"
                        :style="{ background: `linear-gradient(120deg, ${TIERS[worker.tier - 1]?.color}22, transparent)` }"
                    >
                        <div
                            class="grid size-10 shrink-0 place-items-center rounded-full border-2"
                            :style="{ borderColor: TIERS[worker.tier - 1]?.color, backgroundColor: TIERS[worker.tier - 1]?.color + '33' }"
                        >
                            <span class="text-xs font-bold">{{ worker.level }}</span>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2">
                                <button
                                    type="button"
                                    class="cursor-pointer truncate font-semibold hover:text-primary"
                                    title="Rename"
                                    @click="renaming = { id: worker.id, name: worker.name }"
                                >{{ worker.name }}</button>
                                <UBadge
                                    size="sm"
                                    variant="subtle"
                                    :label="RARITY_BY_ID[worker.rarity].name"
                                    :style="{ color: RARITY_BY_ID[worker.rarity].color, backgroundColor: RARITY_BY_ID[worker.rarity].color + '1f' }"
                                />
                            </div>
                            <div class="text-xs" :class="activityColor(worker)">
                                {{ activityLabel(worker) }}
                                <span v-if="cargoLine(worker)" class="text-primary"> · carrying {{ cargoLine(worker) }}</span>
                            </div>
                        </div>
                        <UButton
                            icon="i-lucide-user-x"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            aria-label="Dismiss"
                            @click="dismissing = worker"
                        />
                    </div>

                    <div class="space-y-4 px-4 py-3">
                        <!-- Trades -->
                        <div class="flex flex-wrap gap-1.5">
                            <span
                                v-for="category in worker.specialties"
                                :key="category"
                                class="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium"
                                :style="{
                                    color: CATEGORY_COLORS[category],
                                    backgroundColor: CATEGORY_COLORS[category] + '1f'
                                }"
                            >
                                <UIcon :name="CATEGORY_ICONS[category]" class="size-3" />
                                {{ CATEGORY_NAMES[category] }}
                            </span>
                        </div>

                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <div class="flex justify-between text-[11px] text-muted">
                                    <span>Level {{ worker.level }}</span>
                                    <span v-if="worker.level < MAX_WORKER_LEVEL" class="font-mono">{{ worker.xp }}/{{ xpForLevel(worker.level) }}</span>
                                </div>
                                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-default/60">
                                    <div
                                        class="h-full bg-primary"
                                        :style="{ width: `${worker.level >= MAX_WORKER_LEVEL ? 100 : (worker.xp / xpForLevel(worker.level)) * 100}%` }"
                                    />
                                </div>
                            </div>
                            <div>
                                <div class="flex justify-between text-[11px] text-muted">
                                    <span>Rations</span>
                                    <span class="font-mono">{{ Math.round(worker.food) }}%</span>
                                </div>
                                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-default/60">
                                    <div
                                        class="h-full"
                                        :class="worker.food > 40 ? 'bg-success' : worker.food > 15 ? 'bg-warning' : 'bg-error'"
                                        :style="{ width: `${worker.food}%` }"
                                    />
                                </div>
                            </div>
                        </div>

                        <div v-if="stats(worker)" class="grid grid-cols-3 gap-2 text-center">
                            <div class="rounded-lg bg-default/40 py-1.5">
                                <div class="font-mono text-sm font-semibold">{{ stats(worker)!.carry }}</div>
                                <div class="text-[10px] uppercase tracking-wide text-muted">Carry</div>
                            </div>
                            <div class="rounded-lg bg-default/40 py-1.5">
                                <div class="font-mono text-sm font-semibold">×{{ stats(worker)!.speed.toFixed(2) }}</div>
                                <div class="text-[10px] uppercase tracking-wide text-muted">Speed</div>
                            </div>
                            <div class="rounded-lg bg-default/40 py-1.5">
                                <div class="font-mono text-sm font-semibold">×{{ stats(worker)!.strength.toFixed(2) }}</div>
                                <div class="text-[10px] uppercase tracking-wide text-muted">Strength</div>
                            </div>
                        </div>

                        <!-- Growth: rarity sets the ceiling, levelling walks you to it. -->
                        <div class="rounded-lg bg-default/40 px-3 py-2">
                            <div class="mb-1 flex items-baseline justify-between text-[11px]">
                                <span class="text-muted">Grown into their strength</span>
                                <span class="font-mono">
                                    {{ Math.round(levelProgress(worker.level) * 100) }}%
                                    <span class="text-muted">of ×{{ (worker.growth ?? rarityGrowth(worker.rarity)).toFixed(1) }}</span>
                                </span>
                            </div>
                            <div class="h-1.5 overflow-hidden rounded-full bg-default/60">
                                <div
                                    class="h-full rounded-full"
                                    :style="{
                                        width: `${levelProgress(worker.level) * 100}%`,
                                        backgroundColor: RARITY_BY_ID[worker.rarity].color
                                    }"
                                />
                            </div>
                        </div>

                        <!-- Set bonuses -->
                        <div v-if="makeCounts(wornItems(worker)).length" class="space-y-1">
                            <div
                                v-for="entry in makeCounts(wornItems(worker))"
                                :key="entry.make"
                                class="flex items-center justify-between gap-2 text-[11px]"
                            >
                                <span class="flex items-center gap-1.5">
                                    <span class="size-1.5 rounded-full" :style="{ backgroundColor: MAKE_BY_ID[entry.make].color }" />
                                    <span :style="{ color: MAKE_BY_ID[entry.make].color }">{{ MAKE_BY_ID[entry.make].name }}</span>
                                    <span class="text-muted">{{ entry.count }}/{{ ITEM_SLOTS.length }}</span>
                                </span>
                                <span :class="entry.count >= SET_THRESHOLD_LESSER ? 'text-default' : 'text-muted/60'">
                                    {{ entry.count >= SET_THRESHOLD_GREATER
                                        ? MAKE_BY_ID[entry.make].five.label
                                        : MAKE_BY_ID[entry.make].three.label }}
                                </span>
                            </div>
                            <div v-if="activeSets(wornItems(worker)).length === 0" class="text-[11px] text-muted/70">
                                Two of a make unlocks its bonus, all three unlock the greater one.
                            </div>
                        </div>

                        <div class="grid grid-cols-3 gap-1.5">
                            <button
                                v-for="slot in ITEM_SLOTS"
                                :key="slot"
                                type="button"
                                class="group aspect-square cursor-pointer rounded-lg border transition hover:border-primary/60"
                                :style="{
                                    borderColor: equipped(worker, slot) ? RARITY_BY_ID[equipped(worker, slot)!.rarity].color + '99' : undefined,
                                    backgroundColor: equipped(worker, slot) ? RARITY_BY_ID[equipped(worker, slot)!.rarity].color + '18' : undefined
                                }"
                                :class="equipped(worker, slot) ? '' : 'border-dashed border-default/60'"
                                :title="SLOT_NAMES[slot]"
                                @click="picking = { workerId: worker.id, slot }"
                            >
                                <div class="flex h-full flex-col items-center justify-center gap-0.5 px-1">
                                    <UIcon :name="SLOT_ICONS[slot]" class="size-3.5 text-muted" />
                                    <span class="text-[9px] uppercase tracking-wide text-muted">{{ SLOT_NAMES[slot] }}</span>
                                    <span
                                        v-if="equipped(worker, slot)"
                                        class="text-[10px] font-semibold leading-tight"
                                        :style="{ color: RARITY_BY_ID[equipped(worker, slot)!.rarity].color }"
                                    >
                                        {{ Math.round(itemScore(equipped(worker, slot)!)) }}
                                    </span>
                                    <UIcon v-else name="i-lucide-plus" class="size-3 text-muted" />
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <UModal v-model:open="pickerOpen" :title="picking ? `Fit a ${SLOT_NAMES[picking.slot]}` : ''">
            <template #body>
                <div class="space-y-3">
                    <UButton
                        block
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-circle-slash"
                        label="Leave the slot empty"
                        @click="equipItem(picking!.workerId, picking!.slot, null).then(() => picking = null)"
                    />
                    <div v-if="!pickable.length" class="py-8 text-center text-sm text-muted">
                        Nothing in the vault fits this slot. Commission something at the workshop.
                    </div>
                    <div class="grid gap-2 sm:grid-cols-2">
                        <button
                            v-for="entry in pickable"
                            :key="entry.item.id"
                            type="button"
                            class="cursor-pointer text-left"
                            @click="equipItem(picking!.workerId, picking!.slot, entry.item.id).then(() => picking = null)"
                        >
                            <CaravanItemCard :item="entry.item" compact>
                                <div v-if="entry.taken" class="mt-2 text-[11px] text-warning">
                                    Currently worn by another worker
                                </div>
                            </CaravanItemCard>
                        </button>
                    </div>
                </div>
            </template>
        </UModal>

        <UModal v-model:open="dismissOpen" title="Dismiss worker">
            <template #body>
                <div class="space-y-4">
                    <p class="text-sm text-muted">
                        <span class="font-medium text-default">{{ dismissing?.name }}</span>
                        is level {{ dismissing?.level }} and cannot be recovered. Their gear returns to the vault.
                    </p>
                    <div class="flex justify-end gap-2">
                        <UButton color="neutral" variant="ghost" label="Keep them" @click="dismissing = null" />
                        <UButton color="error" label="Dismiss" @click="confirmDismiss" />
                    </div>
                </div>
            </template>
        </UModal>

        <UModal v-model:open="renameOpen" title="Rename worker">
            <template #body>
                <form class="space-y-3" @submit.prevent="commitRename">
                    <UInput
                        v-if="renaming"
                        v-model="renaming.name"
                        autofocus
                        placeholder="Name"
                        maxlength="24"
                        class="w-full"
                    />
                    <div class="flex justify-end gap-2">
                        <UButton color="neutral" variant="ghost" label="Cancel" @click="renaming = null" />
                        <UButton type="submit" label="Rename" :disabled="!renaming?.name.trim()" />
                    </div>
                </form>
            </template>
        </UModal>
    </div>
</template>
