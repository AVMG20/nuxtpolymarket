<script setup lang="ts">
import {
    GUARANTEE_COST, ITEM_BASES, MAKES, MASTER_REROLL_GEM_COST, RARITIES,
    SLOT_NAMES, TIERS, craftCost, craftResourceCost, reforgeShardCost, rerollCost,
    salvageValue, shardsPerGem
} from '#shared/utils/caravan/config'
import { itemScore } from '#shared/utils/caravan/items'
import type { Item, ItemSlot, Make, Rarity } from '#shared/utils/caravan/types'

/**
 * The workshop. Coins and refined goods buy a roll, never a specific item -- the
 * only thing shards can guarantee is the rarity floor. Everything else is the
 * dice, which is why salvage and reroll exist as the sinks that let a bad vault
 * become a good one.
 */

const { state, craft, salvage, reroll, setPolicy, reforgeItem, buyShards } = useCaravan()
const { user } = useAuth()

const balance = computed(() => Number.parseFloat(user.value?.balance ?? '0'))
const shards = computed(() => state.value?.shards ?? 0)
const gems = computed(() => user.value?.gems ?? 0)

const tier = ref(state.value?.tier ?? 1)
watch(() => state.value?.tier, t => { if (t) tier.value = t })

const baseId = ref<string | undefined>(undefined)
const guarantee = ref<Rarity | undefined>(undefined)
const batch = ref(1)
const lastRolls = ref<Item[]>([])
const autoSalvageBelow = computed(() => state.value?.policies?.autoSalvageBelow ?? null)
const selection = ref<string[]>([])
const filterSlot = ref<ItemSlot | 'all'>('all')
const filterMake = ref<Make | 'all'>('all')
const sortBy = ref<'score' | 'newest' | 'tier'>('score')

const sortOptions = [
    { value: 'score', label: 'Best first' },
    { value: 'newest', label: 'Newest' },
    { value: 'tier', label: 'Highest tier' }
] as const

const coinCost = computed(() => craftCost(tier.value) * batch.value)
const resourceCost = computed(() =>
    Object.fromEntries(Object.entries(craftResourceCost(tier.value)).map(([id, amount]) => [id, amount * batch.value]))
)
const shardCost = computed(() => (guarantee.value ? GUARANTEE_COST[guarantee.value] : 0) * batch.value)

/** How many commissions the storehouse and the purse could cover right now. */
const affordableBatch = computed(() => {
    if (!state.value) return 0
    const unitResources = craftResourceCost(tier.value)
    const byCoins = Math.floor(balance.value / craftCost(tier.value))
    const byShards = guarantee.value
        ? Math.floor(shards.value / Math.max(1, GUARANTEE_COST[guarantee.value]))
        : Infinity
    const byResources = Math.min(
        ...Object.entries(unitResources).map(([id, amount]) => Math.floor((state.value!.resources[id] ?? 0) / amount))
    )
    return Math.max(0, Math.min(25, byCoins, byShards, byResources))
})

const canAfford = computed(() => {
    if (!state.value) return false
    if (balance.value < coinCost.value) return false
    if (shards.value < shardCost.value) return false
    return Object.entries(resourceCost.value).every(([id, count]) => (state.value!.resources[id] ?? 0) >= count)
})

const equippedIds = computed(() =>
    new Set((state.value?.workers ?? []).flatMap(w => Object.values(w.equipment)))
)

/** Which worker wears each item, so the vault says who rather than just that. */
const wornBy = computed(() => {
    const map = new Map<string, string>()
    for (const worker of state.value?.workers ?? []) {
        for (const id of Object.values(worker.equipment)) {
            if (id) map.set(id, worker.name)
        }
    }
    return map
})

const vault = computed(() => {
    const items = state.value?.items ?? []
    const filtered = items.filter(item =>
        (filterSlot.value === 'all' || item.slot === filterSlot.value)
        && (filterMake.value === 'all' || item.make === filterMake.value))

    // A stable tiebreak on id keeps the grid from reshuffling under the cursor
    // when two items score identically.
    return filtered.slice().sort((a, b) => {
        if (sortBy.value === 'newest') return b.rolledAt - a.rolledAt || a.id.localeCompare(b.id)
        if (sortBy.value === 'tier') return b.tier - a.tier || itemScore(b) - itemScore(a)
        return itemScore(b) - itemScore(a) || a.id.localeCompare(b.id)
    })
})

/** How many of each make are in the vault, for the filter chips. */
const makeTally = computed(() => {
    const counts = new Map<Make, number>()
    for (const item of state.value?.items ?? []) counts.set(item.make, (counts.get(item.make) ?? 0) + 1)
    return MAKES.filter(make => counts.has(make.id)).map(make => ({ ...make, count: counts.get(make.id)! }))
})

const selectionValue = computed(() =>
    selection.value.reduce((sum, id) => {
        const item = state.value?.items.find(i => i.id === id)
        return item ? sum + salvageValue(item.tier, item.rarity) : sum
    }, 0)
)

/** Gems to shards, at this tier's rate. */
const shardRate = computed(() => shardsPerGem(state.value?.tier ?? 1))
const gemsToSpend = ref(5)

function toggle(id: string) {
    if (equippedIds.value.has(id)) return
    selection.value = selection.value.includes(id)
        ? selection.value.filter(x => x !== id)
        : [...selection.value, id]
}

async function commission() {
    const res = await craft(tier.value, baseId.value, guarantee.value, batch.value)
    if (res?.items) lastRolls.value = [...res.items].sort((a, b) => itemScore(b) - itemScore(a))
}

async function salvageSelection() {
    await salvage(selection.value)
    selection.value = []
}

/** Salvage everything that is neither equipped nor the best of its slot. */
function selectJunk() {
    const best = new Map<string, string>()
    for (const item of state.value?.items ?? []) {
        const current = best.get(item.slot)
        const currentItem = current ? state.value!.items.find(i => i.id === current) : null
        if (!currentItem || itemScore(item) > itemScore(currentItem)) best.set(item.slot, item.id)
    }
    selection.value = (state.value?.items ?? [])
        .filter(i => !equippedIds.value.has(i.id) && best.get(i.slot) !== i.id)
        .map(i => i.id)
}
</script>

<template>
    <div class="absolute inset-0 overflow-y-auto p-5">
        <div class="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[24rem_1fr]">
            <!-- Commission -->
            <aside class="space-y-4">
                <div>
                    <h1 class="text-xl font-semibold">Workshop</h1>
                    <p class="text-sm text-muted">Every commission is a roll. Shards only set the floor.</p>
                </div>

                <div class="space-y-4 rounded-xl border border-default/60 bg-elevated/30 p-4">
                    <div>
                        <label class="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">Tier</label>
                        <div class="flex flex-wrap gap-1.5">
                            <UButton
                                v-for="t in TIERS.filter(t => t.tier <= (state?.tier ?? 1))"
                                :key="t.tier"
                                size="xs"
                                color="neutral"
                                :variant="tier === t.tier ? 'soft' : 'ghost'"
                                :style="tier === t.tier ? { color: t.glow } : {}"
                                :label="`T${t.tier}`"
                                @click="tier = t.tier"
                            />
                        </div>
                    </div>

                    <div>
                        <label class="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">Base</label>
                        <USelectMenu
                            v-model="baseId"
                            :items="[{ label: 'Surprise me', value: undefined }, ...ITEM_BASES.map(b => ({ label: `${b.name} (${SLOT_NAMES[b.slot]})`, value: b.id }))]"
                            value-key="value"
                            size="sm"
                            placeholder="Surprise me"
                        />
                    </div>

                    <div>
                        <label class="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">Rarity floor</label>
                        <div class="grid grid-cols-3 gap-1.5">
                            <UButton
                                size="xs"
                                color="neutral"
                                :variant="guarantee === undefined ? 'soft' : 'ghost'"
                                label="None"
                                @click="guarantee = undefined"
                            />
                            <UButton
                                v-for="r in RARITIES.slice(1)"
                                :key="r.id"
                                size="xs"
                                color="neutral"
                                :variant="guarantee === r.id ? 'soft' : 'ghost'"
                                :style="guarantee === r.id ? { color: r.color } : {}"
                                :label="`${r.name} · ${formatNumber(GUARANTEE_COST[r.id])}`"
                                :disabled="shards < GUARANTEE_COST[r.id]"
                                @click="guarantee = r.id"
                            />
                        </div>
                    </div>

                    <div class="space-y-1.5 rounded-lg bg-default/40 p-3 text-sm">
                        <div class="flex items-center justify-between">
                            <span class="text-muted">Coins</span>
                            <CoinBalance :value="coinCost" :danger="balance < coinCost" class="text-sm" />
                        </div>
                        <CaravanResource
                            v-for="(count, id) in resourceCost"
                            :key="id"
                            :id="id"
                            :amount="count"
                            :have="state?.resources[id] ?? 0"
                            class="flex w-full justify-between"
                        />
                        <div v-if="shardCost" class="flex items-center justify-between">
                            <span class="flex items-center gap-1.5 text-muted">
                                <UIcon name="i-lucide-gem" class="size-3.5" />
                                Shards
                            </span>
                            <span class="font-mono" :class="shards >= shardCost ? '' : 'text-error'">{{ shardCost }}</span>
                        </div>
                    </div>

                    <div>
                        <label class="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                            Batch
                        </label>
                        <div class="flex flex-wrap gap-1.5">
                            <UButton
                                v-for="n in [1, 5, 10, 25]"
                                :key="n"
                                size="xs"
                                color="neutral"
                                :variant="batch === n ? 'soft' : 'ghost'"
                                :label="`×${n}`"
                                :disabled="affordableBatch < n"
                                @click="batch = n"
                            />
                            <UButton
                                v-if="affordableBatch > 0 && ![1, 5, 10, 25].includes(affordableBatch)"
                                size="xs"
                                color="neutral"
                                :variant="batch === affordableBatch ? 'soft' : 'ghost'"
                                :label="`Max ×${affordableBatch}`"
                                @click="batch = affordableBatch"
                            />
                        </div>
                    </div>

                    <UButton
                        block
                        icon="i-lucide-hammer"
                        :label="batch > 1 ? `Commission ×${batch}` : 'Commission'"
                        :disabled="!canAfford"
                        @click="commission"
                    />
                </div>

                <!-- Auto-salvage: the rule that stops a bulk-rolling session from
                     leaving three hundred commons to sort by hand. -->
                <div class="space-y-2 rounded-xl border border-default/60 bg-elevated/30 p-4">
                    <div class="flex items-center gap-2">
                        <UIcon name="i-lucide-recycle" class="size-4 text-muted" />
                        <span class="text-sm font-medium">Auto-salvage</span>
                    </div>
                    <p class="text-xs text-muted">
                        Commissions below this rarity go straight to shards. You still see and hear every roll.
                    </p>
                    <div class="grid grid-cols-3 gap-1.5">
                        <UButton
                            size="xs"
                            color="neutral"
                            :variant="autoSalvageBelow === null ? 'soft' : 'ghost'"
                            label="Keep all"
                            @click="setPolicy({ autoSalvageBelow: null })"
                        />
                        <UButton
                            v-for="r in RARITIES.slice(1)"
                            :key="r.id"
                            size="xs"
                            color="neutral"
                            :variant="autoSalvageBelow === r.id ? 'soft' : 'ghost'"
                            :style="autoSalvageBelow === r.id ? { color: r.color } : {}"
                            :label="`< ${r.name}`"
                            @click="setPolicy({ autoSalvageBelow: r.id })"
                        />
                    </div>
                </div>

                <!-- Gems into shards: the only way to top up the workshop's own
                     currency without salvaging something you might want. -->
                <div class="space-y-2 rounded-xl border border-secondary/40 bg-secondary/5 p-4">
                    <div class="flex items-center gap-2">
                        <UIcon name="i-lucide-gem" class="size-4 text-secondary" />
                        <span class="text-sm font-medium">Buy shards</span>
                    </div>
                    <p class="text-xs text-muted">
                        {{ formatNumber(shardRate) }} shards per gem at tier {{ state?.tier ?? 1 }}.
                    </p>
                    <div class="flex flex-wrap gap-1.5">
                        <UButton
                            v-for="n in [1, 5, 10, 25]"
                            :key="n"
                            size="xs"
                            color="neutral"
                            :variant="gemsToSpend === n ? 'soft' : 'ghost'"
                            :label="`${n}`"
                            :disabled="gems < n"
                            @click="gemsToSpend = n"
                        />
                    </div>
                    <UButton
                        block
                        color="secondary"
                        icon="i-lucide-gem"
                        :label="`${gemsToSpend} gems → ${formatNumber(gemsToSpend * shardRate)} shards`"
                        :disabled="gems < gemsToSpend"
                        @click="buyShards(gemsToSpend)"
                    />
                </div>

                <div v-if="lastRolls.length" class="space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-medium uppercase tracking-wide text-muted">
                            {{ lastRolls.length > 1 ? `Last batch · ${lastRolls.length} rolls` : 'Fresh off the bench' }}
                        </span>
                        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" @click="lastRolls = []" />
                    </div>
                    <div class="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
                        <CaravanItemCard
                            v-for="(item, index) in lastRolls"
                            :key="`${item.id}-${index}`"
                            :item="item"
                            :compact="lastRolls.length > 1"
                        />
                    </div>
                </div>
            </aside>

            <!-- Vault -->
            <section class="space-y-3">
                <div class="space-y-2">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="flex flex-wrap gap-1.5">
                            <UButton
                                size="xs"
                                color="neutral"
                                :variant="filterSlot === 'all' ? 'soft' : 'ghost'"
                                label="All"
                                @click="filterSlot = 'all'"
                            />
                            <UButton
                                v-for="(name, slot) in SLOT_NAMES"
                                :key="slot"
                                size="xs"
                                color="neutral"
                                :variant="filterSlot === slot ? 'soft' : 'ghost'"
                                :label="name"
                                @click="filterSlot = slot"
                            />
                        </div>
                        <div class="flex items-center gap-2">
                            <UButton size="xs" color="neutral" variant="ghost" label="Select junk" @click="selectJunk" />
                            <UButton
                                size="xs"
                                color="warning"
                                variant="soft"
                                :label="`Salvage ${selection.length} for ${formatNumber(selectionValue)} shards`"
                                :disabled="!selection.length"
                                @click="salvageSelection"
                            />
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <div class="flex flex-wrap gap-1">
                            <UButton
                                v-for="option in sortOptions"
                                :key="option.value"
                                size="xs"
                                color="neutral"
                                :variant="sortBy === option.value ? 'soft' : 'ghost'"
                                :label="option.label"
                                @click="sortBy = option.value"
                            />
                        </div>
                        <div v-if="makeTally.length > 1" class="flex flex-wrap items-center gap-1">
                            <UButton
                                size="xs"
                                color="neutral"
                                :variant="filterMake === 'all' ? 'soft' : 'ghost'"
                                label="Any make"
                                @click="filterMake = 'all'"
                            />
                            <UButton
                                v-for="make in makeTally"
                                :key="make.id"
                                size="xs"
                                color="neutral"
                                :variant="filterMake === make.id ? 'soft' : 'ghost'"
                                :style="filterMake === make.id ? { color: make.color } : {}"
                                :label="`${make.name} ${make.count}`"
                                @click="filterMake = make.id"
                            />
                        </div>
                        <span class="ml-auto text-[11px] text-muted">{{ vault.length }} shown</span>
                    </div>
                </div>

                <div v-if="!vault.length" class="rounded-xl border border-dashed border-default/60 p-10 text-center text-muted">
                    The vault is empty. Commission something.
                </div>

                <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div v-for="item in vault" :key="item.id" class="relative">
                        <button type="button" class="w-full text-left" @click="toggle(item.id)">
                            <CaravanItemCard :item="item" :selected="selection.includes(item.id)">
                                <!-- Four actions in a narrow card: icons with the
                                     price in the tooltip, rather than four labels
                                     that wrap into a second row. -->
                                <div class="mt-3 flex items-center justify-between gap-2 border-t border-default/40 pt-2">
                                    <span
                                        v-if="equippedIds.has(item.id)"
                                        class="truncate text-[11px] text-primary"
                                        :title="`Worn by ${wornBy.get(item.id)}`"
                                    >{{ wornBy.get(item.id) }}</span>
                                    <span v-else class="text-[11px] text-muted">{{ Math.round(itemScore(item)) }}</span>
                                    <div class="flex items-center gap-0.5">
                                        <UTooltip
                                            :text="`Reforge for ${reforgeShardCost(item.tier, item.rarity)} shards — may gain or lose an affix`"
                                        >
                                            <UButton
                                                size="xs"
                                                color="warning"
                                                variant="soft"
                                                icon="i-lucide-flame"
                                                :disabled="shards < reforgeShardCost(item.tier, item.rarity)"
                                                aria-label="Reforge"
                                                @click.stop="reforgeItem(item.id)"
                                            />
                                        </UTooltip>
                                        <UTooltip :text="`Reroll every affix for ${rerollCost(item.tier, item.rarity)} shards`">
                                            <UButton
                                                size="xs"
                                                color="neutral"
                                                variant="soft"
                                                icon="i-lucide-dices"
                                                :disabled="shards < rerollCost(item.tier, item.rarity)"
                                                aria-label="Reroll"
                                                @click.stop="reroll(item.id)"
                                            />
                                        </UTooltip>
                                        <!-- Protects the item's strongest roll, so a
                                             near-perfect piece can be improved instead
                                             of gambled away. -->
                                        <UTooltip :text="`Reroll but keep the best affix — ${MASTER_REROLL_GEM_COST} gems`">
                                            <UButton
                                                size="xs"
                                                color="secondary"
                                                variant="soft"
                                                icon="i-lucide-gem"
                                                :disabled="shards < rerollCost(item.tier, item.rarity) || gems < MASTER_REROLL_GEM_COST || item.affixes.length < 2"
                                                aria-label="Reroll keeping the best affix"
                                                @click.stop="reroll(item.id, true)"
                                            />
                                        </UTooltip>
                                    </div>
                                </div>
                            </CaravanItemCard>
                        </button>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>
