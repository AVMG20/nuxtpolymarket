<template>
    <button
        :type="type"
        class="df-btn"
        :class="[`df-btn--${tone}`, size !== 'md' ? `df-btn--${size}` : '', { 'df-btn--block': block, 'is-loading': loading }]"
        :disabled="disabled || loading"
        :aria-busy="loading || undefined"
    >
        <svg v-if="loading" class="df-btn-spin" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="12 38" stroke-linecap="round" />
        </svg>
        <DfIcon v-else-if="icon" :name="icon" :size="size === 'sm' ? 14 : size === 'lg' ? 20 : 17" />
        <slot />
    </button>
</template>

<script setup lang="ts">
import DfIcon from './DfIcon.vue'
import type { DfIconName } from './icons'

withDefaults(defineProps<{
    tone?: 'blood' | 'brass' | 'paper' | 'dark' | 'ghost'
    size?: 'sm' | 'md' | 'lg'
    icon?: DfIconName
    loading?: boolean
    disabled?: boolean
    block?: boolean
    type?: 'button' | 'submit'
}>(), { tone: 'dark', size: 'md', type: 'button' })
</script>

<style scoped>
.df-btn-spin {
    animation: df-btn-spin 0.9s linear infinite;
}

@keyframes df-btn-spin {
    to { transform: rotate(360deg); }
}
</style>
