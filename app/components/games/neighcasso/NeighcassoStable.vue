<script setup lang="ts">
/**
 * The player's stable of saved horses: pick one to race, edit, duplicate,
 * share by link or send to the glue factory. New and edited horses open in
 * NeighcassoEditor inside a modal.
 */
import '~/assets/css/neighcasso.css'
import NeighcassoEditor from '~/components/games/neighcasso/NeighcassoEditor.vue'
import NeighcassoHorseCanvas from '~/components/games/neighcasso/NeighcassoHorseCanvas.vue'
import { NC_MAX_HORSES_PER_USER, NC_NAME_MAX } from '#shared/utils/neighcasso/types'
import type { NcHorse } from '#shared/utils/neighcasso/types'

const props = withDefaults(defineProps<{
    selectedId?: string | null
    selectable?: boolean
}>(), { selectedId: null, selectable: false })

const emit = defineEmits<{
    select: [horse: NcHorse]
}>()

const toast = useToast()

const horses = ref<NcHorse[]>([])
const loading = ref(true)
const loadError = ref('')
const busyId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const copiedId = ref<string | null>(null)
const hoverId = ref<string | null>(null)

const editorOpen = ref(false)
const editing = ref<NcHorse | null>(null)

let copiedTimer: ReturnType<typeof setTimeout> | null = null
let confirmTimer: ReturnType<typeof setTimeout> | null = null

const full = computed(() => horses.value.length >= NC_MAX_HORSES_PER_USER)

async function refresh() {
    loadError.value = ''
    try {
        horses.value = await apiFetch<NcHorse[]>('/api/neighcasso/horses')
    } catch (e) {
        loadError.value = apiErrorMessage(e, 'Could not open the stable doors')
    } finally {
        loading.value = false
    }
}

defineExpose({ refresh })

onMounted(refresh)

onBeforeUnmount(() => {
    if (copiedTimer) clearTimeout(copiedTimer)
    if (confirmTimer) clearTimeout(confirmTimer)
})

function openNew() {
    if (full.value) return
    editing.value = null
    editorOpen.value = true
}

function openEdit(horse: NcHorse) {
    editing.value = horse
    editorOpen.value = true
}

async function onSaved(horse: NcHorse) {
    const isNew = !editing.value
    editorOpen.value = false
    editing.value = null
    const i = horses.value.findIndex(h => h.id === horse.id)
    if (i >= 0) horses.value.splice(i, 1, horse)
    else horses.value.unshift(horse)
    await refresh()
    if (isNew && props.selectable) emit('select', horse)
}

async function duplicate(horse: NcHorse) {
    if (busyId.value || full.value) return
    busyId.value = horse.id
    try {
        const name = `${horse.name} II`.slice(0, NC_NAME_MAX)
        const copy = await apiFetch<NcHorse>('/api/neighcasso/horses', {
            method: 'POST',
            body: { name, drawing: horse.drawing }
        })
        horses.value.unshift(copy)
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not clone this horse'), color: 'error' })
    } finally {
        busyId.value = null
    }
}

async function share(horse: NcHorse) {
    const link = `${location.origin}/games/neighcasso?horse=${horse.id}`
    try {
        await navigator.clipboard.writeText(link)
        copiedId.value = horse.id
        if (copiedTimer) clearTimeout(copiedTimer)
        copiedTimer = setTimeout(() => { copiedId.value = null }, 1800)
    } catch {
        toast.add({ title: 'Could not copy the link', description: link, color: 'error' })
    }
}

function askDelete(horse: NcHorse) {
    confirmDeleteId.value = horse.id
    if (confirmTimer) clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => { confirmDeleteId.value = null }, 4000)
}

async function remove(horse: NcHorse) {
    if (busyId.value) return
    busyId.value = horse.id
    try {
        await apiFetch<{ ok: true }>(`/api/neighcasso/horses/${horse.id}`, { method: 'DELETE' })
        horses.value = horses.value.filter(h => h.id !== horse.id)
        confirmDeleteId.value = null
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'This horse refuses to leave'), color: 'error' })
    } finally {
        busyId.value = null
    }
}

function record(horse: NcHorse) {
    if (!horse.races) return 'Never raced'
    return `${horse.wins} ${horse.wins === 1 ? 'win' : 'wins'} / ${horse.races} ${horse.races === 1 ? 'race' : 'races'}`
}
</script>

<template>
    <div class="nc-root nc-stable">
        <div class="nc-stable-head">
            <h3 class="nc-title text-xl" style="color: var(--nc-ink)">
                My stable
            </h3>
            <span class="nc-chip">{{ horses.length }}/{{ NC_MAX_HORSES_PER_USER }} horses</span>
        </div>

        <div v-if="loading" class="nc-stable-loading nc-hint">
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" /> Rounding up the horses…
        </div>

        <div v-else-if="loadError" class="nc-paper nc-doodle-soft nc-stable-empty">
            <p class="nc-error">
                {{ loadError }}
            </p>
            <button class="nc-sticker nc-sticker-sm" @click="refresh">
                <UIcon name="i-lucide-refresh-cw" class="size-4" /> Try again
            </button>
        </div>

        <template v-else>
            <div v-if="!horses.length" class="nc-paper nc-doodle nc-stable-empty">
                <p class="nc-title text-2xl">
                    <span class="nc-scribble">Your stable is empty</span>
                </p>
                <p class="nc-hint max-w-sm">
                    Every champion starts as a wobbly doodle. Four legs recommended, not required.
                </p>
                <button class="nc-sticker nc-sticker-yellow nc-sticker-lg nc-wiggle" @click="openNew">
                    <UIcon name="i-lucide-pencil" class="size-5" /> Draw your first horse
                </button>
            </div>

            <div v-else class="nc-stable-grid">
                <button
                    class="nc-new-card nc-dashed"
                    :disabled="full"
                    :title="full ? `Your stable is full (${NC_MAX_HORSES_PER_USER} horses). Retire one first.` : 'Draw a new horse'"
                    @click="openNew"
                >
                    <span class="nc-new-plus">
                        <UIcon name="i-lucide-plus" class="size-8" />
                    </span>
                    <span class="nc-title text-lg">{{ full ? 'Stable full' : 'Draw a new horse' }}</span>
                </button>

                <article
                    v-for="(horse, i) in horses"
                    :key="horse.id"
                    class="nc-horse-card nc-paper-plain"
                    :class="[i % 2 ? 'nc-doodle-alt' : 'nc-doodle', { 'is-selected': selectable && horse.id === selectedId }]"
                    @mouseenter="hoverId = horse.id"
                    @mouseleave="hoverId = null"
                >
                    <span v-if="selectable && horse.id === selectedId" class="nc-chip nc-selected-tag">Your pick</span>
                    <div class="nc-thumb">
                        <NeighcassoHorseCanvas :drawing="horse.drawing" :gait="hoverId === horse.id ? 1 : 0" :height="92" />
                    </div>
                    <div class="nc-card-meta">
                        <p class="nc-title nc-card-name" :title="horse.name">
                            {{ horse.name }}
                        </p>
                        <p class="nc-hint">
                            {{ record(horse) }}
                        </p>
                    </div>

                    <div v-if="confirmDeleteId === horse.id" class="nc-card-actions">
                        <span class="nc-error mr-auto">Retire this horse?</span>
                        <button class="nc-sticker nc-sticker-sm nc-sticker-red" :disabled="busyId === horse.id" @click="remove(horse)">
                            Yes, bye
                        </button>
                        <button class="nc-sticker nc-sticker-sm" @click="confirmDeleteId = null">
                            Keep
                        </button>
                    </div>
                    <div v-else class="nc-card-actions">
                        <button
                            v-if="selectable"
                            class="nc-sticker nc-sticker-sm"
                            :class="horse.id === selectedId ? 'nc-sticker-mint' : 'nc-sticker-yellow'"
                            :disabled="horse.id === selectedId"
                            @click="emit('select', horse)"
                        >
                            <UIcon :name="horse.id === selectedId ? 'i-lucide-check' : 'i-lucide-flag'" class="size-4" />
                            {{ horse.id === selectedId ? 'Picked' : 'Race this one' }}
                        </button>
                        <button class="nc-sticker nc-sticker-sm" title="Edit" aria-label="Edit" @click="openEdit(horse)">
                            <UIcon name="i-lucide-pencil" class="size-4" />
                        </button>
                        <button class="nc-sticker nc-sticker-sm" title="Duplicate" aria-label="Duplicate" :disabled="full || busyId === horse.id" @click="duplicate(horse)">
                            <UIcon name="i-lucide-copy" class="size-4" />
                        </button>
                        <button class="nc-sticker nc-sticker-sm" :class="{ 'nc-sticker-blue': copiedId === horse.id }" title="Copy share link" aria-label="Copy share link" @click="share(horse)">
                            <UIcon :name="copiedId === horse.id ? 'i-lucide-check' : 'i-lucide-share-2'" class="size-4" />
                            <span v-if="copiedId === horse.id">Link copied!</span>
                        </button>
                        <button class="nc-sticker nc-sticker-sm" title="Delete" aria-label="Delete" @click="askDelete(horse)">
                            <UIcon name="i-lucide-trash-2" class="size-4" />
                        </button>
                    </div>
                </article>
            </div>
        </template>

        <UModal
            v-model:open="editorOpen"
            :title="editing ? `Edit ${editing.name}` : 'Draw a new horse'"
            description="Neighcasso horse editor"
            :ui="{ content: 'w-[min(72rem,calc(100vw-2rem))] max-w-none sm:max-w-none overflow-y-auto bg-[#fdf6e3] ring-2 ring-[#2b2118] max-sm:w-screen max-sm:h-dvh max-sm:max-h-dvh max-sm:rounded-none' }"
        >
            <template #content>
                <NeighcassoEditor :horse="editing" @saved="onSaved" @close="editorOpen = false" />
            </template>
        </UModal>
    </div>
</template>

<style scoped>
.nc-stable {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
}

.nc-stable-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
}

.nc-stable-loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 2rem 0;
    justify-content: center;
    font-weight: 700;
}

.nc-stable-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
    padding: 2rem 1.5rem 2rem 2.75rem;
    text-align: center;
}

.nc-stable-grid {
    display: grid;
    gap: 1.1rem;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 13.5rem), 1fr));
    padding: 0.4rem 0.2rem;
}

.nc-new-card {
    min-height: 12rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    color: var(--nc-ink);
    background: transparent;
    cursor: pointer;
    transition: transform 0.15s ease, background-color 0.15s ease;
}

.nc-new-card:hover:not(:disabled) {
    transform: rotate(-1.5deg) scale(1.02);
    background: color-mix(in srgb, var(--nc-yellow) 18%, transparent);
}

.nc-new-card:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.nc-new-plus {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3.2rem;
    height: 3.2rem;
    color: var(--nc-ink);
    background: var(--nc-yellow);
    border: 3px solid var(--nc-ink);
    border-radius: 50% 44% 52% 40% / 44% 52% 40% 50%;
    box-shadow: 2px 3px 0 var(--nc-ink);
}

.nc-horse-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.7rem 0.75rem 0.75rem;
    transition: transform 0.15s ease;
}

.nc-horse-card:nth-child(3n) { transform: rotate(0.8deg); }
.nc-horse-card:nth-child(3n + 1) { transform: rotate(-0.7deg); }
.nc-horse-card:hover { transform: rotate(0deg) translateY(-2px); }

.nc-horse-card.is-selected {
    background-color: #fff4c2;
    outline: 3px dashed var(--nc-mint);
    outline-offset: 4px;
}

.nc-selected-tag {
    position: absolute;
    top: -0.7rem;
    right: 0.6rem;
    background: var(--nc-mint);
    transform: rotate(4deg);
    z-index: 1;
}

.nc-thumb {
    height: 96px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
}

.nc-card-meta {
    min-width: 0;
}

.nc-card-name {
    font-size: 1.05rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.nc-card-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    margin-top: auto;
}
</style>
