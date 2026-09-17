<script setup lang="ts">
/**
 * Place a buy order on ANY slab identity in a set — including ones with zero
 * population. A funded bid on a slab nobody has cut yet is a public bounty:
 * it tells the whole market what digging for that card is worth.
 */
import type { CollectionPayload } from '#shared/types/tcg'
import { SERVICES } from '#shared/utils/tcg/grading-model'
import type { TcgServiceKey } from '#shared/utils/tcg/grading-model-types'
import { bookGradeOptions, bookDesignationOptions } from '#shared/utils/tcg/market'
import { finishLabel } from '~/composables/useTcgAdmin'

const props = defineProps<{ setId: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ changed: [] }>()

const checklist = ref<CollectionPayload | null>(null)
watch([open, () => props.setId], async ([isOpen]) => {
    if (!isOpen || !props.setId) return
    checklist.value = null
    try {
        checklist.value = await apiFetch<CollectionPayload>('/api/tcg/collection', { query: { setId: props.setId } })
    } catch {
        checklist.value = null
    }
})

const printingId = ref<string | undefined>(undefined)
const printingItems = computed(() =>
    (checklist.value?.cards ?? []).flatMap(card => card.printings.map(printing => ({
        label: `${card.name} #${card.number} · ${finishLabel(printing.finish, printing.pattern)}`
            + (printing.printRunLabel ? ` · ${printing.printRunLabel}` : ''),
        value: printing.id
    }))))

const SERVICE_KEYS = Object.keys(SERVICES) as TcgServiceKey[]
const service = ref<TcgServiceKey>('PSI')
const serviceItems = SERVICE_KEYS.map(key => ({
    label: `${key} — ${(SERVICES[key] as { name: string }).name}`,
    value: key
}))

const grade = ref('10')
const gradeItems = computed(() => bookGradeOptions(service.value))
watch(service, () => {
    if (!gradeItems.value.includes(grade.value)) grade.value = '10'
})

// A grade-10 slab from a designating service ALWAYS carries a designation, so
// the picker is mandatory there and absent everywhere else.
const designation = ref<string | undefined>(undefined)
const designationItems = computed(() => bookDesignationOptions(service.value, grade.value))
watch(designationItems, (items) => {
    designation.value = items.length ? (designation.value && items.includes(designation.value) ? designation.value : items[0]) : undefined
})
</script>

<template>
    <UModal v-model:open="open">
        <template #content>
            <div class="flex flex-col gap-4 p-5">
                <div>
                    <h3 class="text-base font-semibold text-highlighted">Place a buy order</h3>
                    <p class="mt-1 text-xs text-muted">
                        Pick any card, grader and grade — the slab does not have to exist yet.
                        Your escrowed bid stands as a bounty for whoever pulls and grades one.
                    </p>
                </div>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <UFormField
                        label="Card"
                        class="sm:col-span-2"
                    >
                        <USelectMenu
                            v-model="printingId"
                            class="w-full"
                            value-key="value"
                            :items="printingItems"
                            :loading="!checklist"
                            placeholder="Pick a card…"
                        />
                    </UFormField>
                    <UFormField label="Grader">
                        <USelect
                            v-model="service"
                            class="w-full"
                            value-key="value"
                            :items="serviceItems"
                        />
                    </UFormField>
                    <div class="flex gap-3">
                        <UFormField
                            label="Grade"
                            class="flex-1"
                        >
                            <USelect
                                v-model="grade"
                                class="w-full"
                                :items="gradeItems"
                            />
                        </UFormField>
                        <UFormField
                            v-if="designationItems.length"
                            label="Designation"
                            class="flex-1"
                        >
                            <USelect
                                v-model="designation"
                                class="w-full"
                                :items="designationItems"
                            />
                        </UFormField>
                    </div>
                </div>
                <TcgBookPanel
                    v-if="printingId"
                    :printing-id="printingId"
                    :grade-service="service"
                    :grade="grade"
                    :grade-designation="designation ?? null"
                    @changed="emit('changed')"
                />
            </div>
        </template>
    </UModal>
</template>
