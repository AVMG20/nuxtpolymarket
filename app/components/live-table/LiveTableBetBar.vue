<script setup lang="ts">
/**
 * Repeat / halve / double / undo / clear — the same five controls, in the same
 * order, at every table. Games own what each does to their own bet shape; this
 * only guarantees the strip looks and reads identically everywhere.
 *
 * Halve and double act on the seat's current bet, or on last round's bet when
 * nothing is staked yet, so a player can size up before committing. Side bets
 * scale with the main bet rather than needing their own controls.
 */
withDefaults(defineProps<{
    canRepeat?: boolean
    canScale?: boolean
    canUndo?: boolean
    canClear?: boolean
    showUndo?: boolean
}>(), { canRepeat: false, canScale: false, canUndo: false, canClear: false, showUndo: true })

defineEmits<{
    repeat: []
    scale: [factor: number]
    undo: []
    clear: []
}>()
</script>

<template>
    <div class="lt-betbar">
        <button class="lb-tile lb-tile-amber" :disabled="!canRepeat" @click="$emit('repeat')">
            REPEAT
        </button>
        <button class="lb-tile op" :disabled="!canScale" title="Halve every bet" @click="$emit('scale', 0.5)">
            ½
        </button>
        <button class="lb-tile op" :disabled="!canScale" title="Double every bet" @click="$emit('scale', 2)">
            2×
        </button>
        <button v-if="showUndo" class="lb-tile lb-tile-slate" :disabled="!canUndo" @click="$emit('undo')">
            UNDO
        </button>
        <button class="lb-tile lb-tile-red" :disabled="!canClear" @click="$emit('clear')">
            CLEAR
        </button>
    </div>
</template>
