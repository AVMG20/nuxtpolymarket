<script setup lang="ts">
import type { SlabInfo, TcgServiceKey } from '~/utils/tcg/slab'

// Dev harness: one slab per grading service, with grade/designation controls,
// so the four label designs can be tuned by eye. Admin-only; not linked.
const { user } = useAuth()

const service = ref<TcgServiceKey>('PSI')
const services: TcgServiceKey[] = ['PSI', 'CCC', 'GAG', 'BRK']

const grade = ref('10')
const gradeOptions = ['10', '9.5', '9', '8.5', '8', '7', '6', '5']
const designated = ref(false)
const darkBackdrop = ref(false)

const GRADE_TEXT: Record<string, string> = {
    '10': 'GEM MINT', '9.5': 'GEM MINT', '9': 'MINT', '8.5': 'NM-MT+',
    '8': 'NM-MT', '7': 'NEAR MINT', '6': 'EX-MT', '5': 'EXCELLENT'
}

const DESIGNATION: Record<TcgServiceKey, string | null> = {
    PSI: null, CCC: 'Pristine', GAG: 'Pristine', BRK: 'Black Label'
}

const info = computed<SlabInfo>(() => {
    const g = grade.value
    const sub = (delta: number) => {
        const v = Math.max(1, Math.min(10, parseFloat(g) + delta))
        return v % 1 === 0 ? String(v) : v.toFixed(1)
    }
    return {
        lines: ['Hoothoot', '2025 Pokémon Prismatic Evolutions', 'SV8PT5 #077/131 · Common'],
        cardNumber: '077',
        grade: g,
        // BRK calls a 10 Pristine (its designation ladder tops out at Black
        // Label); the others call it Gem Mint.
        gradeText: service.value === 'BRK' && g === '10' ? 'PRISTINE' : GRADE_TEXT[g] ?? 'MINT',
        subgrades: { centering: sub(0), corners: sub(0.5), edges: sub(0), surface: sub(-0.5) },
        score: service.value === 'GAG' ? String(Math.round(parseFloat(g) * 98.5)) : undefined,
        designation: designated.value && g === '10' ? DESIGNATION[service.value] : null,
        serial: 'C0384512',
        seed: 'sv8-5_en_077'
    }
})

const slabKey = computed(() => `${service.value}|${grade.value}|${designated.value}`)
</script>

<template>
    <div class="mx-auto max-w-5xl space-y-4 p-6">
        <template v-if="user?.isPokemonAdmin">
            <div class="flex items-center gap-4">
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
            <div
                class="flex justify-center rounded-lg p-6"
                :class="darkBackdrop ? 'bg-black' : 'bg-elevated'"
            >
                <ClientOnly>
                    <TcgSlab
                        :key="slabKey"
                        :service="service"
                        :info="info"
                        bundle="sv8-5_en_077"
                        asset-number="077"
                        mask-kind="wp"
                        foil-effect="NonFoil"
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
