<script setup lang="ts">
import type { SlabInfo, TcgServiceKey } from '~/utils/tcg/slab'
import type { CollectionPayload } from '#shared/types/tcg'
import { legacySetOf } from '#shared/utils/tcg/legacy'

// Dev harness: one slab per grading service, with grade/designation controls
// and a card picker over any committed set, so the four label designs can be
// tuned by eye. Admin-only; not linked.
const { user } = useAuth()
const { sets } = useTcg()

const service = ref<TcgServiceKey>('PSI')
const services: TcgServiceKey[] = ['PSI', 'CCC', 'GAG', 'BRK']

const grade = ref('10')
const gradeOptions = ['10', '9.5', '9', '8.5', '8', '7', '6', '5']
const designated = ref(false)
const darkBackdrop = ref(false)

/* ---- card picker ------------------------------------------------------- */

const selectedSetId = ref<string | undefined>(undefined)
const setOptions = computed(() =>
    sets.value.map(s => ({ label: `${s.name} (${s.code})`, value: s.id })))

const { data: collection } = useFetch<CollectionPayload>('/api/tcg/collection', {
    key: 'tcg-slab-test-collection',
    query: { setId: selectedSetId },
    immediate: false,
    watch: [selectedSetId]
})

// AFTER useFetch is created, so the watched query ref change actually
// triggers the fetch (same trap as collection.vue).
watch(sets, (list) => {
    if (selectedSetId.value || !list.length) return
    const newest = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!
    selectedSetId.value = newest.id
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

const printingOptions = computed<PickedPrinting[]>(() =>
    (collection.value?.cards ?? []).flatMap(card =>
        card.printings.map(printing => ({
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
        }))))

const selectedPrintingId = ref<string | undefined>(undefined)
watch(printingOptions, (options) => {
    // A new set arrived: keep the pick if it survives, else default sensibly.
    if (options.some(o => o.value === selectedPrintingId.value)) return
    selectedPrintingId.value = options[0]?.value
})

const picked = computed(() =>
    printingOptions.value.find(o => o.value === selectedPrintingId.value) ?? null)

const currentSet = computed(() => sets.value.find(s => s.id === selectedSetId.value) ?? null)

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

const slabKey = computed(() => `${service.value}|${grade.value}|${designated.value}|${selectedPrintingId.value}`)
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
            </div>
            <div class="flex flex-wrap items-center gap-3">
                <USelect
                    v-model="selectedSetId"
                    :items="setOptions"
                    placeholder="Set"
                    class="w-64"
                />
                <USelectMenu
                    v-model="selectedPrintingId"
                    :items="printingOptions"
                    value-key="value"
                    placeholder="Card"
                    class="w-96"
                />
            </div>
            <div
                class="flex justify-center rounded-lg p-6"
                :class="darkBackdrop ? 'bg-black' : 'bg-elevated'"
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
                        :height="620"
                    />
                </ClientOnly>
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
