<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

// The Xeno pill button. `go` is the one green action on a screen; `uv` is
// mutation, `sky` spends gems, `sun` spends coins on an unlock.
const props = withDefaults(defineProps<{
  variant?: 'default' | 'go' | 'uv' | 'sky' | 'sun' | 'danger' | 'ghost'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  icon?: string
  trailingIcon?: string
  label?: string
  loading?: boolean
  disabled?: boolean
  block?: boolean
  square?: boolean
  /** Small static leaf in the corner: something is waiting for this action. */
  waiting?: boolean
  to?: RouteLocationRaw
  type?: 'button' | 'submit'
}>(), { variant: 'default', size: 'md', type: 'button' })

defineEmits<{ click: [e: MouseEvent] }>()

const classes = computed(() => [
  'xg-btn',
  props.variant !== 'default' && props.variant,
  props.size !== 'md' && props.size,
  props.block && 'block',
  props.square && 'ico',
  props.waiting && 'xg-waiting'
])

const iconSize = computed(() => props.size === 'xs' ? 'size-3.5' : props.size === 'lg' ? 'size-5' : 'size-4')
</script>

<template>
  <NuxtLink
    v-if="to && !disabled"
    :to="to"
    :class="classes"
  >
    <UIcon v-if="icon" :name="icon" :class="iconSize" />
    <slot>{{ label }}</slot>
    <UIcon v-if="trailingIcon" :name="trailingIcon" :class="iconSize" />
  </NuxtLink>
  <button
    v-else
    :type="type"
    :class="classes"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    @click="$emit('click', $event)"
  >
    <UIcon v-if="loading" name="i-lucide-loader-circle" class="animate-spin" :class="iconSize" />
    <UIcon v-else-if="icon" :name="icon" :class="iconSize" />
    <slot>{{ label }}</slot>
    <UIcon v-if="trailingIcon" :name="trailingIcon" :class="iconSize" />
  </button>
</template>
