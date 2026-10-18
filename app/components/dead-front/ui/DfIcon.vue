<template>
    <svg
        class="df-icon"
        viewBox="0 0 24 24"
        :width="size"
        :height="size"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
    >
        <template v-if="name === 'lock'">
            <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
            <circle cx="12" cy="15.2" r="1.3" fill="currentColor" />
        </template>
        <path v-else-if="name === 'check'" d="M4.5 12.5l4.8 4.8L19.5 6.8" />
        <path v-else-if="name === 'x'" d="M6 6l12 12M18 6L6 18" />
        <template v-else-if="name === 'crown'">
            <path d="M4 17.5l-1-10 5 4 4-6.5 4 6.5 5-4-1 10z" />
            <path d="M4 20.5h16" />
        </template>
        <template v-else-if="name === 'helmet'">
            <!-- Brodie helmet -->
            <path d="M2.5 15.5c3 1.4 16 1.4 19 0" />
            <path d="M5 15.2c0-5 3.1-8.4 7-8.4s7 3.4 7 8.4" />
            <path d="M12 6.8v-1.4" />
        </template>
        <template v-else-if="name === 'plus'">
            <path d="M12 5v14M5 12h14" />
        </template>
        <template v-else-if="name === 'flag'">
            <path d="M5 21V4" />
            <path d="M5 4.5c4-2 6 2 10 0s4 0 4 0v8s-1-2-4 0-6-2-10 0" />
        </template>
        <template v-else-if="name === 'send'">
            <path d="M3.5 11.5L20.5 4l-6.5 16.5-3-7z" />
            <path d="M11 13.5L20.5 4" />
        </template>
        <template v-else-if="name === 'leave'">
            <path d="M14 4h4.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
            <path d="M10 8l-4 4 4 4M6 12h10" />
        </template>
        <template v-else-if="name === 'refresh'">
            <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
            <path d="M19.5 4.5v4h-4" />
        </template>
        <template v-else-if="name === 'radio'">
            <path d="M12 12v9M8.5 21h7" />
            <circle cx="12" cy="10" r="1.8" />
            <path d="M8 6.2a5.6 5.6 0 0 0 0 7.6M16 6.2a5.6 5.6 0 0 1 0 7.6M5.2 3.6a9.5 9.5 0 0 0 0 12.8M18.8 3.6a9.5 9.5 0 0 1 0 12.8" />
        </template>
        <template v-else-if="name === 'flask'">
            <path d="M9.5 3h5M10 3v6l-5.2 9.2A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-2.8L14 9V3" />
            <path d="M7.4 15h9.2" />
        </template>
        <template v-else-if="name === 'crosshair'">
            <circle cx="12" cy="12" r="7.5" />
            <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
        </template>
        <template v-else-if="name === 'scroll'">
            <path d="M7 4h11a2 2 0 0 1 2 2v1h-4" />
            <path d="M16 7v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1h10" />
            <path d="M7 4a2 2 0 0 0-2 2v11M9 9h4M9 12.5h4" />
        </template>
        <template v-else-if="name === 'swords'">
            <path d="M4 4l10 10M4 4h3.5l9 9M4 4v3.5l9 9" />
            <path d="M14.5 17.5l3 3M17.5 14.5l3 3M15 20l5-5" />
        </template>
        <path v-else-if="name === 'play'" d="M7 4.5v15l12-7.5z" />
        <template v-else-if="name === 'gear'">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
        </template>
        <path v-else-if="name === 'back'" d="M15 5l-7 7 7 7" />
        <template v-else-if="name === 'skull'">
            <path d="M5 11a7 7 0 0 1 14 0c0 2.5-1.2 3.8-2.5 4.6V19h-9v-3.4C6.2 14.8 5 13.5 5 11z" />
            <circle cx="9.3" cy="11.2" r="1.6" fill="currentColor" />
            <circle cx="14.7" cy="11.2" r="1.6" fill="currentColor" />
            <path d="M10.5 19v-2M13.5 19v-2" />
        </template>
        <template v-else-if="name === 'user'">
            <circle cx="12" cy="8" r="3.6" />
            <path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6" />
        </template>
        <template v-else-if="name === 'star'">
            <path d="M12 3.5l2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.4l-5.1 2.8L8 13.5l-4.3-4 5.8-.7z" />
        </template>
        <template v-else>
            <circle cx="12" cy="12" r="3" />
        </template>
    </svg>
</template>

<script setup lang="ts">
// Hand-drawn line icons for Dead Front (no icon font or Nuxt UI icons).
import type { DfIconName } from './icons'

withDefaults(defineProps<{ name: DfIconName, size?: number | string }>(), { size: 18 })
</script>

<style scoped>
.df-icon {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
}
</style>
