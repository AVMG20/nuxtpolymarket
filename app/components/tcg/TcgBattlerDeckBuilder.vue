<script setup lang="ts">
/**
 * Deck builder: curate up to 30 battle-ready cards into a named deck the
 * run drafts from. Decks store card identities only — copies and
 * eligibility resolve from the live collection at run start.
 */
import { legacySetOf } from '#shared/utils/tcg/legacy'

interface CollectionCard {
    cardId: string
    name: string
    copies: number
    cost: number
    hp: number
    type: string | null
    bounty: number
    render: { bundle: string | null, plaatjesCardId: string | null, assetNumber: string | null }
}

interface DeckCard {
    cardId: string
    copies: number
}

interface DeckRow {
    id: string
    name: string
    cards: DeckCard[]
    updatedAt: string
}

const DECK_CARD_LIMIT = 30

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()

const toast = useToast()
const collection = ref<CollectionCard[] | null>(null)
const decks = ref<DeckRow[]>([])
const loading = ref(false)

// Editor state.
const editingId = ref<string | null>(null)
const name = ref('')
/** cardId → copies (1–6) this deck fields. */
const picked = ref<Record<string, number>>({})
const search = ref('')
const saving = ref(false)
const confirmingDelete = ref(false)

watch(open, async (value) => {
    if (!value) return
    loading.value = true
    try {
        const [cards, rows] = await Promise.all([
            apiFetch<CollectionCard[]>('/api/battler/collection'),
            apiFetch<DeckRow[]>('/api/battler/decks')
        ])
        collection.value = cards
        decks.value = rows
        if (!editingId.value && rows.length > 0) selectDeck(rows[0]!)
        else if (rows.length === 0) newDeck()
    } finally {
        loading.value = false
    }
})

const filtered = computed(() => {
    const term = search.value.trim().toLowerCase()
    const cards = [...(collection.value ?? [])].sort((a, b) => b.copies - a.copies || a.name.localeCompare(b.name))
    return term ? cards.filter(card => card.name.toLowerCase().includes(term)) : cards
})

function renderThumb(render: CollectionCard['render']) {
    if (render.bundle) return { bundle: render.bundle }
    const legacySet = render.plaatjesCardId ? legacySetOf(render.plaatjesCardId) : null
    return legacySet && render.assetNumber ? { legacySet, assetNumber: render.assetNumber } : null
}

const pickedCount = computed(() => Object.keys(picked.value).length)

function newDeck() {
    editingId.value = null
    name.value = ''
    picked.value = {}
    confirmingDelete.value = false
}

function selectDeck(deck: DeckRow) {
    editingId.value = deck.id
    name.value = deck.name
    // Cards no longer in the eligible collection stay in the deck — they
    // simply cannot draft until copies come back.
    picked.value = Object.fromEntries(deck.cards.map(card => [card.cardId, card.copies]))
    confirmingDelete.value = false
}

function maxCopiesOf(cardId: string): number {
    const owned = (collection.value ?? []).find(card => card.cardId === cardId)?.copies ?? 6
    return Math.min(6, owned)
}

function toggleCard(cardId: string) {
    if (cardId in picked.value) {
        const { [cardId]: _, ...rest } = picked.value
        picked.value = rest
        return
    }
    if (pickedCount.value >= DECK_CARD_LIMIT) {
        toast.add({ title: `A deck holds at most ${DECK_CARD_LIMIT} cards`, color: 'error' })
        return
    }
    picked.value = { ...picked.value, [cardId]: maxCopiesOf(cardId) }
}

function bumpCopies(cardId: string, delta: number) {
    const current = picked.value[cardId]
    if (current === undefined) return
    const next = Math.min(maxCopiesOf(cardId), Math.max(1, current + delta))
    picked.value = { ...picked.value, [cardId]: next }
}

async function save() {
    if (saving.value) return
    saving.value = true
    try {
        const saved = await apiFetch<{ id: string, name: string, cards: DeckCard[] }>('/api/battler/decks', {
            method: 'POST',
            body: {
                id: editingId.value,
                name: name.value,
                cards: Object.entries(picked.value).map(([cardId, copies]) => ({ cardId, copies }))
            }
        })
        editingId.value = saved.id
        decks.value = await apiFetch<DeckRow[]>('/api/battler/decks')
        emit('saved')
        toast.add({ title: `Deck “${saved.name}” saved`, color: 'success' })
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not save the deck'), color: 'error' })
    } finally {
        saving.value = false
    }
}

async function removeDeck() {
    if (!editingId.value) return
    if (!confirmingDelete.value) {
        confirmingDelete.value = true
        return
    }
    try {
        await apiFetch(`/api/battler/decks/${editingId.value}`, { method: 'DELETE' })
        decks.value = decks.value.filter(deck => deck.id !== editingId.value)
        emit('saved')
        newDeck()
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not delete the deck'), color: 'error' })
    }
}
</script>

<template>
    <UModal
        v-model:open="open"
        :ui="{ content: 'w-[min(80rem,calc(100vw-2rem))] max-w-none' }"
    >
        <template #content>
            <div class="flex max-h-[85vh] flex-col gap-4 overflow-hidden p-5">
                <div class="flex items-center justify-between">
                    <h2 class="text-lg font-semibold text-highlighted">Decks</h2>
                    <UButton
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-x"
                        @click="open = false"
                    />
                </div>

                <!-- Deck tabs. -->
                <div class="flex flex-wrap items-center gap-1.5">
                    <UButton
                        v-for="deck in decks"
                        :key="deck.id"
                        size="xs"
                        :color="editingId === deck.id ? 'primary' : 'neutral'"
                        :variant="editingId === deck.id ? 'solid' : 'subtle'"
                        :label="`${deck.name} (${deck.cards.length})`"
                        @click="selectDeck(deck)"
                    />
                    <UButton
                        v-if="decks.length < 5"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-plus"
                        label="New deck"
                        @click="newDeck"
                    />
                </div>

                <!-- Editor header. -->
                <div class="flex flex-wrap items-center gap-2">
                    <UInput
                        v-model="name"
                        placeholder="Deck name"
                        class="w-56"
                        :maxlength="40"
                    />
                    <UBadge
                        color="neutral"
                        variant="subtle"
                        class="tabular-nums"
                    >
                        {{ pickedCount }}/{{ DECK_CARD_LIMIT }}
                    </UBadge>
                    <UButton
                        size="sm"
                        icon="i-lucide-save"
                        label="Save"
                        :loading="saving"
                        :disabled="!name.trim() || pickedCount === 0"
                        @click="save"
                    />
                    <UButton
                        v-if="editingId"
                        size="sm"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-trash-2"
                        :label="confirmingDelete ? 'Really delete?' : 'Delete'"
                        @click="removeDeck"
                    />
                </div>

                <!-- Collection grid: tap to add or remove. -->
                <UInput
                    v-model="search"
                    icon="i-lucide-search"
                    placeholder="Search your battle-ready cards…"
                />
                <div class="min-h-0 flex-1 overflow-y-auto">
                    <div
                        v-if="loading"
                        class="py-10 text-center text-sm text-muted"
                    >Loading your collection…</div>
                    <div
                        v-else
                        class="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8"
                    >
                        <div
                            v-for="card in filtered"
                            :key="card.cardId"
                            class="relative cursor-pointer rounded-lg p-1 transition"
                            :class="card.cardId in picked ? 'bg-primary/10 ring-2 ring-primary' : 'hover:ring-1 hover:ring-primary/50'"
                            @click="toggleCard(card.cardId)"
                        >
                            <template v-if="renderThumb(card.render)">
                                <TcgCardThumb v-bind="renderThumb(card.render)!" />
                            </template>
                            <div
                                v-else
                                class="flex aspect-[0.718] w-full items-center justify-center rounded bg-elevated text-[10px] text-muted"
                            >
                                {{ card.name }}
                            </div>
                            <UBadge
                                color="neutral"
                                size="sm"
                                class="absolute -right-1 -top-1 tabular-nums"
                            >
                                ×{{ card.copies }}
                            </UBadge>
                            <UBadge
                                color="warning"
                                variant="solid"
                                size="sm"
                                class="absolute -left-1 -top-1 font-mono"
                            >
                                ₱{{ card.cost }}
                            </UBadge>
                            <div
                                v-if="card.cardId in picked"
                                class="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded bg-default/90 py-0.5"
                                @click.stop
                            >
                                <UButton
                                    size="xs"
                                    color="neutral"
                                    variant="ghost"
                                    icon="i-lucide-minus"
                                    :disabled="picked[card.cardId]! <= 1"
                                    @click="bumpCopies(card.cardId, -1)"
                                />
                                <span class="min-w-6 text-center text-xs font-semibold tabular-nums text-highlighted">{{ picked[card.cardId] }}×</span>
                                <UButton
                                    size="xs"
                                    color="neutral"
                                    variant="ghost"
                                    icon="i-lucide-plus"
                                    :disabled="picked[card.cardId]! >= maxCopiesOf(card.cardId)"
                                    @click="bumpCopies(card.cardId, 1)"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <p class="text-xs text-muted">
                    A deck narrows the run's draft to these cards — the draft still picks 10 of them,
                    weighted by copies². The per-card count caps how many copies a run can field,
                    so it also caps merge depth (3 → L2, 6 → L3).
                </p>
            </div>
        </template>
    </UModal>
</template>
