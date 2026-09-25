<script setup lang="ts">
/**
 * A horse opened from someone's share link. Shows it galloping and lets the
 * viewer adopt a copy into their own stable.
 */
import '~/assets/css/neighcasso.css'
import NeighcassoHorseCanvas from '~/components/games/neighcasso/NeighcassoHorseCanvas.vue'
import type { NcHorse, NcSharedHorse } from '#shared/utils/neighcasso/types'

const props = withDefaults(defineProps<{
    horseId: string | null
    open?: boolean
}>(), { open: false })

const emit = defineEmits<{
    'update:open': [open: boolean]
    'adopted': [horse: NcHorse]
}>()

const toast = useToast()

const horse = ref<NcSharedHorse | null>(null)
const loading = ref(false)
const missing = ref(false)
const loadError = ref('')
const adopting = ref(false)
const adopted = ref(false)

const isOpen = computed({
    get: () => props.open,
    set: value => emit('update:open', value)
})

function statusOf(e: unknown): number | undefined {
    const err = e as { statusCode?: number, status?: number, response?: { status?: number } } | null
    return err?.statusCode ?? err?.status ?? err?.response?.status
}

async function load(id: string) {
    loading.value = true
    missing.value = false
    loadError.value = ''
    adopted.value = false
    horse.value = null
    try {
        const data = await apiFetch<NcSharedHorse>(`/api/neighcasso/horses/${encodeURIComponent(id)}`)
        if (id === props.horseId) horse.value = data
    } catch (e) {
        if (id !== props.horseId) return
        const status = statusOf(e)
        if (status === 404 || status === 400) missing.value = true
        else loadError.value = apiErrorMessage(e, 'Could not fetch this horse')
    } finally {
        if (id === props.horseId) loading.value = false
    }
}

watch(() => [props.open, props.horseId] as const, ([open, id]) => {
    if (!open) return
    if (!id) {
        missing.value = true
        horse.value = null
        return
    }
    if (horse.value?.id !== id) load(id)
}, { immediate: true })

async function adopt() {
    if (!horse.value || adopting.value) return
    adopting.value = true
    try {
        const copy = await apiFetch<NcHorse>(`/api/neighcasso/horses/${encodeURIComponent(horse.value.id)}/adopt`, { method: 'POST' })
        adopted.value = true
        emit('adopted', copy)
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'This horse would not come with you'), color: 'error' })
    } finally {
        adopting.value = false
    }
}

function record(h: NcHorse) {
    if (!h.races) return 'Fresh off the paper, never raced'
    return `${h.wins} ${h.wins === 1 ? 'win' : 'wins'} from ${h.races} ${h.races === 1 ? 'race' : 'races'}`
}
</script>

<template>
    <UModal
        v-model:open="isOpen"
        :title="horse ? horse.name : 'Shared horse'"
        description="A horse someone drew and shared with you"
        :ui="{ content: 'max-w-xl bg-transparent ring-0 shadow-none overflow-visible' }"
    >
        <template #content>
            <div class="nc-root nc-shared nc-paper nc-doodle">
                <button class="nc-sticker nc-sticker-sm nc-shared-close" aria-label="Close" @click="isOpen = false">
                    <UIcon name="i-lucide-x" class="size-4" />
                </button>

                <div v-if="loading" class="nc-shared-state">
                    <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
                    <p class="nc-title text-lg">
                        Leading the horse out…
                    </p>
                </div>

                <div v-else-if="missing" class="nc-shared-state">
                    <p class="nc-title text-3xl nc-wiggle">
                        <span class="nc-scribble">This horse ran away</span>
                    </p>
                    <p class="nc-hint">
                        The link is broken or its owner sent it out to pasture.
                    </p>
                    <button class="nc-sticker" @click="isOpen = false">
                        Oh well
                    </button>
                </div>

                <div v-else-if="loadError" class="nc-shared-state">
                    <p class="nc-error">
                        {{ loadError }}
                    </p>
                    <button class="nc-sticker nc-sticker-sm" @click="horseId && load(horseId)">
                        <UIcon name="i-lucide-refresh-cw" class="size-4" /> Try again
                    </button>
                </div>

                <template v-else-if="horse">
                    <div class="nc-shared-stage nc-paper-plain nc-doodle-alt nc-tape">
                        <NeighcassoHorseCanvas :drawing="horse.drawing" :gait="1" :height="200" />
                    </div>
                    <div class="text-center">
                        <h2 class="nc-title text-3xl">
                            <span class="nc-scribble">{{ horse.name }}</span>
                        </h2>
                        <p class="nc-shared-by">
                            drawn by <strong>{{ horse.ownerName }}</strong>
                        </p>
                        <p class="nc-hint">
                            {{ record(horse) }}
                        </p>
                    </div>
                    <div class="flex justify-center">
                        <p v-if="horse.mine" class="nc-chip nc-shared-note">
                            This one's already yours
                        </p>
                        <p v-else-if="adopted" class="nc-chip nc-shared-note nc-shared-adopted">
                            <UIcon name="i-lucide-check" class="size-4" /> Moved into your stable
                        </p>
                        <button v-else class="nc-sticker nc-sticker-yellow nc-sticker-lg" :disabled="adopting" @click="adopt">
                            <UIcon :name="adopting ? 'i-lucide-loader-circle' : 'i-lucide-heart'" class="size-5" :class="{ 'animate-spin': adopting }" />
                            Adopt into my stable
                        </button>
                    </div>
                </template>
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.nc-shared {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem 1.25rem 1.5rem 2.75rem;
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
}

.nc-shared-close {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    z-index: 2;
}

.nc-shared-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
    padding: 2.5rem 0.5rem;
    text-align: center;
}

.nc-shared-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 220px;
    padding: 0.75rem;
    margin-top: 1.25rem;
    overflow: hidden;
}

.nc-shared-by {
    margin-top: 0.3rem;
    font-size: 1rem;
    color: var(--nc-ink);
}

.nc-shared-note {
    font-size: 0.95rem;
    padding: 0.3rem 0.9rem;
}

.nc-shared-adopted {
    background: var(--nc-mint);
}
</style>
