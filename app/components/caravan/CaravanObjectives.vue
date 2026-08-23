<script setup lang="ts">
import { objectives } from '#shared/utils/caravan/objectives'

/**
 * The "what now" panel.
 *
 * Five screens and an idle loop means a returning player has to go looking for
 * whatever is broken. This reads the save and puts the answer on the map: things
 * actively costing throughput first, then things that would raise it, then the
 * long game. Everything here is a link — nothing is purely informational.
 */

const props = withDefaults(defineProps<{ limit?: number }>(), { limit: 3 })
const emit = defineEmits<{ focusNode: [id: number] }>()

const { state, world } = useCaravan()
const { user } = useAuth()

const balance = computed(() => Number.parseFloat(user.value?.balance ?? '0'))

const items = computed(() => {
    if (!state.value) return []
    return objectives(state.value, world.value, balance.value).slice(0, props.limit)
})

/** Anything above 100 is actively losing production, so it reads as a warning. */
function tone(weight: number): string {
    if (weight >= 150) return 'text-error'
    if (weight >= 100) return 'text-warning'
    return 'text-primary'
}
</script>

<template>
    <div v-if="items.length" class="space-y-1">
        <component
            :is="entry.nodeId !== undefined ? 'button' : resolveComponent('NuxtLink')"
            v-for="entry in items"
            :key="entry.kind + (entry.nodeId ?? '')"
            :to="entry.nodeId !== undefined ? undefined : entry.to"
            :type="entry.nodeId !== undefined ? 'button' : undefined"
            class="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-default/40"
            @click="entry.nodeId !== undefined && emit('focusNode', entry.nodeId)"
        >
            <UIcon :name="entry.icon" class="mt-0.5 size-4 shrink-0" :class="tone(entry.weight)" />
            <span class="min-w-0">
                <span class="block truncate text-xs font-medium text-default">{{ entry.title }}</span>
                <span class="block text-[11px] leading-snug text-muted">{{ entry.detail }}</span>
            </span>
        </component>
    </div>
    <p v-else class="px-2.5 py-2 text-[11px] text-muted">
        Nothing needs you right now. Come back when the storehouse has filled up.
    </p>
</template>
