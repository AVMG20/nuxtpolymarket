<script setup lang="ts">
import type { SlabInfo, TcgServiceKey } from '~/utils/tcg/slab'
import type {
    TcgAdminCard, TcgAdminPrinting, TcgAdminSet, TcgPlaatjesChecklistPayload,
    TcgPlaatjesSetsPayload, TcgSetDetailPayload
} from '#shared/types/tcg'
import { legacySetOf } from '#shared/utils/tcg/legacy'

// Dev harness: one slab per grading service, with grade/designation controls
// and a card picker over any set, so the four label designs can be tuned by
// eye. Admin-only; not linked.
const { user } = useAuth()

const service = ref<TcgServiceKey>('PSI')
const services: TcgServiceKey[] = ['PSI', 'CCC', 'GAG', 'BRK']

const grade = ref('10')
const gradeOptions = ['10', '9.5', '9', '8.5', '8', '7', '6', '5']
const designated = ref(false)
const darkBackdrop = ref(false)

/* ---- card picker ------------------------------------------------------- */

// Two sources, one selector. tcg_sets only holds what was actually imported
// (often a single set), while the sidecar knows every set it can render —
// which is what a label harness wants: any card in the catalogue, no import.
// Player endpoints are no use here at all; they hide anything uncommitted.
const { data: sets } = useAsyncData('tcg-slab-test-sets', () => apiFetch<TcgAdminSet[]>('/api/tcg/admin/sets'))
const { data: catalogue } = useAsyncData('tcg-slab-test-catalogue', () => apiFetch<TcgPlaatjesSetsPayload>('/api/tcg/admin/plaatjes/sets'))

// Source-tagged values: 'db:<uuid>' for an imported set, 'px:<CODE>' for a
// sidecar-only one. Selecting is the same gesture either way.
const selectedSetId = ref<string | undefined>(undefined)

const setOptions = computed(() => {
    const imported = (sets.value ?? []).map(s => ({
        label: `${s.name} (${s.code})`,
        value: `db:${s.id}`
    }))
    // An imported set already appears above under its own name — don't offer
    // the sidecar's copy of the same checklist a second time.
    const importedCodes = new Set((sets.value ?? [])
        .map(s => s.plaatjesSetCode?.toLowerCase())
        .filter((code): code is string => Boolean(code)))
    const rest = (catalogue.value?.sets ?? [])
        .filter(s => !importedCodes.has(s.setCode.toLowerCase()))
        .map(s => ({
            // name falls back to the code when pull-rates has no name for it,
            // and '(ME5) ME5' reads badly.
            label: s.name === s.setCode ? s.setCode : `${s.name} (${s.setCode})`,
            value: `px:${s.setCode}`
        }))
    return [...imported, ...rest]
})

interface ChecklistView {
    set: { name: string, code: string, releaseDate: string | null }
    cards: TcgAdminCard[]
    printings: TcgAdminPrinting[]
}

// One loader for both sources. It reads the raw selection rather than a
// looked-up option, so it cannot land in the gap before setOptions has the
// entry — and useAsyncData drops stale responses when you click through sets
// faster than a checklist loads.
const { data: checklist, status: checklistStatus } = useAsyncData<ChecklistView | null>(
    'tcg-slab-test-checklist',
    async () => {
        const value = selectedSetId.value
        if (!value) return null
        if (value.startsWith('db:')) {
            const detail = await apiFetch<TcgSetDetailPayload>('/api/tcg/admin/sets/detail', {
                query: { id: value.slice(3) }
            })
            return {
                set: { name: detail.set.name, code: detail.set.code, releaseDate: detail.set.releaseDate },
                cards: detail.cards,
                printings: detail.printings
            }
        }
        const setCode = value.slice(3)
        const preview = await apiFetch<TcgPlaatjesChecklistPayload>('/api/tcg/admin/plaatjes/checklist', {
            query: { setCode }
        })
        const known = catalogue.value?.sets.find(s => s.setCode === setCode)
        return {
            // The sidecar catalogue carries no release date, so the label's
            // year line stays blank for a set that was never imported.
            set: { name: known?.name ?? setCode, code: setCode, releaseDate: null },
            cards: preview.cards,
            printings: preview.printings
        }
    },
    { watch: [selectedSetId], immediate: false }
)

// AFTER the loader is created, so the watched ref change actually triggers a
// fetch (same trap as collection.vue).
watch(sets, (list) => {
    if (selectedSetId.value || !list?.length) return
    const newest = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!
    selectedSetId.value = `db:${newest.id}`
}, { immediate: true })

// Nothing imported yet: fall back to the head of the catalogue so the harness
// still opens on a card.
watch(catalogue, (payload) => {
    if (selectedSetId.value || sets.value?.length) return
    const first = payload?.sets[0]
    if (first) selectedSetId.value = `px:${first.setCode}`
}, { immediate: true })

interface PickedPrinting {
    label: string
    value: string
    cardName: string
    rarity: string | null
    number: string
    setTotal: number | null
    bundle: string | null
    assetNumber: string | null
    maskKind: string | null
    foilEffect: string | null
    pattern: string | null
    plaatjesCardId: string
    holo: boolean
}

// Both sources serve cards and printings as flat sibling arrays; join them
// here so the picker still reads in checklist order.
const printingOptions = computed<PickedPrinting[]>(() => {
    const byCard = new Map<string, TcgAdminPrinting[]>()
    for (const printing of checklist.value?.printings ?? []) {
        const list = byCard.get(printing.cardId) ?? []
        list.push(printing)
        byCard.set(printing.cardId, list)
    }
    return (checklist.value?.cards ?? []).flatMap(card =>
        (byCard.get(card.id) ?? []).map(printing => ({
            label: `${card.number} ${card.name} · ${finishLabel(printing.finish, printing.pattern)}`,
            value: printing.id,
            cardName: card.name,
            rarity: card.rarity,
            number: card.number,
            setTotal: card.setTotal,
            bundle: printing.bundle,
            assetNumber: printing.assetNumber,
            maskKind: printing.maskKind,
            foilEffect: printing.foilEffect,
            pattern: printing.pattern,
            plaatjesCardId: printing.plaatjesCardId,
            holo: printing.finish === 'holo'
        })))
})

const selectedPrintingId = ref<string | undefined>(undefined)
watch(printingOptions, (options) => {
    // A new set arrived: keep the pick if it survives, else default sensibly.
    if (options.some(o => o.value === selectedPrintingId.value)) return
    selectedPrintingId.value = options[0]?.value
})

const picked = computed(() =>
    printingOptions.value.find(o => o.value === selectedPrintingId.value) ?? null)

// From the loaded checklist rather than the selector, so the label's set never
// races ahead of the cards it is describing.
const currentSet = computed(() => checklist.value?.set ?? null)

/* ---- full screen ------------------------------------------------------- */

// TcgSlab sizes its canvas once, at mount — there is no resize observer — so
// going full screen remounts it (via slabKey) at a height measured from the
// full screen viewport.
const NORMAL_HEIGHT = 620

const stage = useTemplateRef<HTMLDivElement>('stage')
const isFullscreen = ref(false)
const slabHeight = ref(NORMAL_HEIGHT)

async function toggleFullscreen() {
    try {
        if (document.fullscreenElement) await document.exitFullscreen()
        else await stage.value?.requestFullscreen()
    } catch { /* denied or unsupported — stay windowed */ }
}

function onFullscreenChange() {
    const full = document.fullscreenElement === stage.value
    isFullscreen.value = full
    // innerHeight can still read the pre-transition viewport when this fires,
    // so measure on the next frame instead.
    requestAnimationFrame(() => {
        slabHeight.value = full ? Math.round(window.innerHeight - 64) : NORMAL_HEIGHT
    })
}

onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onFullscreenChange))

/* ---- label data -------------------------------------------------------- */

const GRADE_TEXT: Record<string, string> = {
    '10': 'GEM MINT', '9.5': 'GEM MINT', '9': 'MINT', '8.5': 'NM-MT+',
    '8': 'NM-MT', '7': 'NEAR MINT', '6': 'EX-MT', '5': 'EXCELLENT'
}

const DESIGNATION: Record<TcgServiceKey, string | null> = {
    PSI: null, CCC: 'Pristine', GAG: 'Pristine', BRK: 'Black Label'
}

const info = computed<SlabInfo>(() => {
    const g = grade.value
    const p = picked.value
    const set = currentSet.value
    const year = (set?.releaseDate ?? '').slice(0, 4)
    const sub = (delta: number) => {
        const v = Math.max(1, Math.min(10, parseFloat(g) + delta))
        return v % 1 === 0 ? String(v) : v.toFixed(1)
    }
    return {
        lines: [
            p?.cardName ?? 'Hoothoot',
            [year, 'Pokémon', set?.name ?? ''].filter(Boolean).join(' '),
            [
                p && set ? `${set.code} #${p.number}${p.setTotal ? `/${p.setTotal}` : ''}` : null,
                p?.rarity
            ].filter(Boolean).join(' · ')
        ].filter(line => line !== ''),
        cardNumber: p?.number ?? undefined,
        grade: g,
        // BRK calls a 10 Pristine (its designation ladder tops out at Black
        // Label); the others call it Gem Mint.
        gradeText: service.value === 'BRK' && g === '10' ? 'PRISTINE' : GRADE_TEXT[g] ?? 'MINT',
        subgrades: { centering: sub(0), corners: sub(0.5), edges: sub(0), surface: sub(-0.5) },
        score: service.value === 'GAG' ? String(Math.round(parseFloat(g) * 98.5)) : undefined,
        designation: designated.value && g === '10' ? DESIGNATION[service.value] : null,
        serial: 'C0384512',
        seed: picked.value?.plaatjesCardId ?? 'sv8-5_en_077'
    }
})

const slabKey = computed(() =>
    `${service.value}|${grade.value}|${designated.value}|${selectedPrintingId.value}|${slabHeight.value}`)
</script>

<template>
    <div class="mx-auto max-w-5xl space-y-4 p-6">
        <template v-if="user?.isPokemonAdmin">
            <div class="flex flex-wrap items-center gap-4">
                <UButtonGroup>
                    <UButton
                        v-for="s in services"
                        :key="s"
                        :label="s"
                        :variant="service === s ? 'solid' : 'outline'"
                        color="primary"
                        @click="service = s"
                    />
                </UButtonGroup>
                <USelect
                    v-model="grade"
                    :items="gradeOptions"
                    class="w-24"
                />
                <UCheckbox
                    v-model="designated"
                    :disabled="grade !== '10' || !DESIGNATION[service]"
                    :label="DESIGNATION[service] ?? 'no designation'"
                />
                <UCheckbox
                    v-model="darkBackdrop"
                    label="dark backdrop"
                />
                <UButton
                    icon="i-lucide-maximize"
                    label="Full screen"
                    color="neutral"
                    variant="outline"
                    @click="toggleFullscreen"
                />
            </div>
            <div class="flex flex-wrap items-center gap-3">
                <USelectMenu
                    v-model="selectedSetId"
                    :items="setOptions"
                    value-key="value"
                    placeholder="Set"
                    class="w-72"
                />
                <USelectMenu
                    v-model="selectedPrintingId"
                    :items="printingOptions"
                    :loading="checklistStatus === 'pending'"
                    value-key="value"
                    placeholder="Card"
                    class="w-96"
                />
                <span
                    v-if="catalogue?.sidecarUnavailable"
                    class="text-xs text-warning"
                >
                    Sidecar unreachable — only imported sets are listed
                </span>
            </div>
            <div
                ref="stage"
                class="relative flex items-center justify-center p-6"
                :class="[
                    darkBackdrop ? 'bg-black' : 'bg-elevated',
                    isFullscreen ? 'h-full w-full' : 'rounded-lg'
                ]"
            >
                <ClientOnly>
                    <TcgSlab
                        v-if="picked"
                        :key="slabKey"
                        :service="service"
                        :info="info"
                        :bundle="picked.bundle ?? ''"
                        :asset-number="String(picked.assetNumber ?? '')"
                        :mask-kind="picked.maskKind ?? 'wp'"
                        :foil-effect="picked.foilEffect"
                        :pattern="picked.pattern"
                        :legacy-set="picked.bundle ? null : legacySetOf(picked.plaatjesCardId)"
                        :holo="picked.holo"
                        :height="slabHeight"
                    />
                </ClientOnly>
                <!-- The toolbar is outside the full screen element, so the way
                     back out has to live in here (Esc works too). -->
                <UButton
                    v-if="isFullscreen"
                    class="absolute right-4 top-4"
                    icon="i-lucide-minimize"
                    color="neutral"
                    variant="subtle"
                    @click="toggleFullscreen"
                />
            </div>
            <p class="text-xs text-muted">
                Drag to turn the slab over · double-click to reset · BRK label tier follows the grade (silver &lt; 9.5, gold 9.5+, black on Black Label)
            </p>
        </template>
        <UAlert
            v-else
            title="Admins only"
            color="warning"
        />
    </div>
</template>
