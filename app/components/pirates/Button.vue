<script setup lang="ts">
// The Pirate Raid button: brass, teal, wood, ghost, danger or gem. Renders a
// NuxtLink when given `to`. Styles live in the .pirate-theme sheet (pages/pirates.vue).
const props = withDefaults(defineProps<{
  variant?: 'gold' | 'teal' | 'wood' | 'ghost' | 'danger' | 'gem'
  size?: 'sm' | 'md' | 'lg'
  icon?: string
  trailingIcon?: string
  label?: string
  loading?: boolean
  disabled?: boolean
  block?: boolean
  to?: string
  type?: 'button' | 'submit'
}>(), { variant: 'wood', size: 'md', icon: undefined, trailingIcon: undefined, label: undefined, loading: false, disabled: false, block: false, to: undefined, type: 'button' })

const slots = useSlots()

const classes = computed(() => [
  'pr-btn',
  `pr-btn--${props.variant}`,
  props.size === 'sm' ? 'pr-btn--sm' : props.size === 'lg' ? 'pr-btn--lg' : '',
  props.block ? 'pr-btn--block' : '',
  !props.label && !slots.default ? 'pr-btn--icon' : ''
])
</script>

<template>
  <NuxtLink v-if="to && !disabled" :to="to" :class="classes">
    <UIcon v-if="icon" :name="icon" class="size-4 shrink-0" />
    <slot>{{ label }}</slot>
    <UIcon v-if="trailingIcon" :name="trailingIcon" class="size-4 shrink-0" />
  </NuxtLink>
  <button v-else :type="type" :class="classes" :disabled="disabled || loading" :aria-busy="loading">
    <UIcon v-if="loading" name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin" />
    <UIcon v-else-if="icon" :name="icon" class="size-4 shrink-0" />
    <slot>{{ label }}</slot>
    <UIcon v-if="trailingIcon" :name="trailingIcon" class="size-4 shrink-0" />
  </button>
</template>
