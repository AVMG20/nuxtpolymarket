<script setup lang="ts">
/**
 * The order book for one slab identity (§7.1): aggregated bid levels, a
 * place-bid form, and — when the viewer owns the shown copy — the "sell
 * instantly" button that fills the best standing bid.
 */
import { sellerProceeds } from '#shared/utils/tcg/market'

const props = defineProps<{
    printingId: string
    gradeService: string
    grade: string
    gradeDesignation?: string | null
    /** The viewer's own slabbed copy in this identity — enables instant sell. */
    ownCopyId?: string | null
}>()

const emit = defineEmits<{ changed: [] }>()

interface BookView {
    levels: { price: number, quantity: number, orders: number }[]
    own: { id: string, price: number, quantity: number, filled: number }[]
}

const toast = useToast()
const { fetchSession } = useAuth()
const book = ref<BookView | null>(null)

async function refreshBook() {
    try {
        book.value = await apiFetch<BookView>('/api/tcg/book', {
            query: {
                printingId: props.printingId,
                gradeService: props.gradeService,
                grade: props.grade,
                gradeDesignation: props.gradeDesignation ?? undefined
            }
        })
    } catch {
        book.value = null
    }
}
watch(() => [props.printingId, props.gradeService, props.grade, props.gradeDesignation], refreshBook, { immediate: true })

const bestBid = computed(() => book.value?.levels[0] ?? null)

// Place a bid.
const bidOpen = ref(false)
const bidPrice = ref(100)
const bidQuantity = ref(1)
const placing = ref(false)
async function placeBid() {
    if (placing.value) return
    placing.value = true
    try {
        await apiFetch('/api/tcg/book/place', {
            method: 'POST',
            body: {
                printingId: props.printingId,
                gradeService: props.gradeService,
                grade: props.grade,
                gradeDesignation: props.gradeDesignation ?? null,
                price: Number(bidPrice.value),
                quantity: Number(bidQuantity.value)
            }
        })
        toast.add({ title: 'Buy order placed — coins escrowed', color: 'success' })
        bidOpen.value = false
        await Promise.all([refreshBook(), fetchSession()])
        emit('changed')
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not place order'), color: 'error' })
    } finally {
        placing.value = false
    }
}

async function cancelBid(orderId: string) {
    try {
        await apiFetch('/api/tcg/book/cancel', { method: 'POST', body: { orderId } })
        toast.add({ title: 'Order cancelled — escrow refunded', color: 'success' })
        await Promise.all([refreshBook(), fetchSession()])
        emit('changed')
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not cancel'), color: 'error' })
    }
}

// Instant sell: two-step arm, the card leaves immediately.
const sellArmed = ref(false)
const selling = ref(false)
watch(() => props.ownCopyId, () => {
    sellArmed.value = false
})
async function sellInstantly() {
    if (!props.ownCopyId || selling.value) return
    if (!sellArmed.value) {
        sellArmed.value = true
        return
    }
    selling.value = true
    try {
        const fill = await apiFetch<{ price: number, proceeds: number }>('/api/tcg/book/sell', {
            method: 'POST',
            body: { copyId: props.ownCopyId }
        })
        toast.add({ title: `Sold into the best bid — ${formatNumber(fill.proceeds, false)} coins`, color: 'success' })
        sellArmed.value = false
        await Promise.all([refreshBook(), fetchSession()])
        emit('changed')
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not sell'), color: 'error' })
        sellArmed.value = false
    } finally {
        selling.value = false
    }
}
</script>

<template>
    <div class="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-950/90 p-3">
        <div class="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Buy orders · {{ gradeService }} {{ grade }}
        </div>
        <template v-if="book && book.levels.length">
            <div
                v-for="level in book.levels.slice(0, 4)"
                :key="level.price"
                class="flex items-center justify-between text-xs"
            >
                <span class="flex items-center gap-1 font-mono tabular-nums text-neutral-200"><UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" />{{ formatNumber(level.price) }}</span>
                <span class="text-neutral-500">×{{ level.quantity }}</span>
            </div>
        </template>
        <div
            v-else
            class="text-xs text-neutral-500"
        >
            No standing bids.
        </div>

        <UButton
            v-if="ownCopyId && bestBid"
            :color="sellArmed ? 'error' : 'primary'"
            size="xs"
            icon="i-lucide-coins"
            :loading="selling"
            :label="sellArmed
                ? `Really sell — ${formatNumber(sellerProceeds(bestBid.price))} after the burn`
                : `Sell instantly for ${formatNumber(bestBid.price)}`"
            @click="sellInstantly"
        />

        <div
            v-if="book?.own.length"
            class="flex flex-col gap-1"
        >
            <div
                v-for="order in book.own"
                :key="order.id"
                class="flex items-center justify-between text-xs text-neutral-400"
            >
                <span>your bid <UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" /> <b class="font-mono tabular-nums text-neutral-200">{{ formatNumber(order.price) }}</b> × {{ order.quantity - order.filled }}</span>
                <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    label="Cancel"
                    @click="cancelBid(order.id)"
                />
            </div>
        </div>

        <div
            v-if="!bidOpen"
            class="flex"
        >
            <UButton
                color="neutral"
                variant="subtle"
                size="xs"
                icon="i-lucide-hand-coins"
                label="Place buy order"
                @click="bidOpen = true"
            />
        </div>
        <div
            v-else
            class="flex flex-col gap-2"
        >
            <div class="flex gap-2">
                <UInput
                    v-model.number="bidPrice"
                    type="number"
                    size="sm"
                    :min="1"
                    class="flex-1"
                >
                    <template #leading>
                        <UIcon
                            name="i-lucide-coins"
                            class="size-3.5 text-yellow-400"
                        />
                    </template>
                </UInput>
                <UInput
                    v-model.number="bidQuantity"
                    type="number"
                    size="sm"
                    :min="1"
                    :max="100"
                    class="w-20"
                >
                    <template #leading>
                        <span class="text-xs text-neutral-500">×</span>
                    </template>
                </UInput>
            </div>
            <div class="flex items-center justify-between">
                <span class="flex items-center gap-1 text-xs text-neutral-500">
                    escrows <UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" />
                    <b class="font-mono tabular-nums text-neutral-200">{{ formatNumber((Number(bidPrice) || 0) * (Number(bidQuantity) || 0)) }}</b>
                </span>
                <div class="flex gap-1.5">
                    <UButton
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        label="Close"
                        @click="bidOpen = false"
                    />
                    <UButton
                        color="primary"
                        size="xs"
                        :loading="placing"
                        label="Place"
                        @click="placeBid"
                    />
                </div>
            </div>
        </div>
    </div>
</template>
