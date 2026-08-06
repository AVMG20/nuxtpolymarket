<script setup lang="ts">
import { chipRackFor, LB_CHIPS, LB_RACK_SIZE } from '#shared/utils/live-blackjack/chips'
import { chip } from '~/utils/live-table/art'

const props = defineProps<{
    balance: number
    modelValue: number
    muted?: boolean
}>()

const emit = defineEmits<{
    'update:modelValue': [value: number]
}>()

const offset = ref(0)

watch(() => props.balance, () => { offset.value = 0 }, { immediate: true })

const rack = computed(() => chipRackFor(props.balance, offset.value))

const canScrollLeft = computed(() => {
    const base = chipRackFor(props.balance, 0)
    return base[0]!.value !== LB_CHIPS[0]!.value || offset.value > 0
})

const canScrollRight = computed(() => {
    const base = chipRackFor(props.balance, 0)
    return base[LB_RACK_SIZE - 1]!.value !== LB_CHIPS[LB_CHIPS.length - 1]!.value || offset.value < 0
})

function scrollLeft() {
    offset.value = Math.min(offset.value + 1, LB_RACK_SIZE)
}

function scrollRight() {
    offset.value = Math.max(offset.value - 1, -(LB_CHIPS.length - LB_RACK_SIZE))
}

function select(value: number) {
    if (value > props.balance) return
    emit('update:modelValue', value)
}
</script>

<template>
    <div class="lt-rack" :class="{ 'lt-rack-muted': muted }">
        <button
            v-if="canScrollLeft"
            class="lt-rack-arrow lt-rack-arrow-l"
            @click.stop="scrollLeft"
        >
            <UIcon name="i-lucide-chevron-left" class="size-5" />
        </button>
        <span
            v-for="c in rack"
            :key="c.value"
            :class="{ 'sel': c.value === modelValue, 'lt-chip-disabled': c.value > balance }"
            v-html="chip(c.value)"
            @click="select(c.value)"
        />
        <button
            v-if="canScrollRight"
            class="lt-rack-arrow lt-rack-arrow-r"
            @click.stop="scrollRight"
        >
            <UIcon name="i-lucide-chevron-right" class="size-5" />
        </button>
    </div>
</template>

<style scoped>
.lt-rack-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    border: 1.5px solid rgba(217, 177, 103, 0.4);
    color: rgba(217, 177, 103, 0.85);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, border-color 0.15s;
}
.lt-rack-arrow:hover {
    background: rgba(0, 0, 0, 0.75);
    border-color: rgba(217, 177, 103, 0.7);
}
.lt-rack-arrow-l {
    margin-right: 2px;
}
.lt-rack-arrow-r {
    margin-left: 2px;
}
.lt-chip-disabled {
    opacity: 0.3;
    pointer-events: none;
    filter: grayscale(0.8);
}
.lt-rack.lt-rack-muted {
    opacity: 0.3;
    pointer-events: none;
}
</style>
