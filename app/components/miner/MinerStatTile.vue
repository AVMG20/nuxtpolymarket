<script setup lang="ts">
const props = withDefaults(defineProps<{
  icon: string
  label: string
  value: string
  sub?: string
  tone?: 'gold' | 'cyan' | 'steel'
}>(), { tone: 'steel' })

const accent = computed(() => ({
  gold: 'text-amber-400',
  cyan: 'text-cyan-400',
  steel: 'text-muted'
}[props.tone]))
</script>

<template>
  <div class="flex items-center gap-2.5 rounded-xl border border-default bg-elevated/50 px-3 py-2">
    <UIcon :name="icon" class="size-4 shrink-0" :class="accent" />
    <div class="min-w-0">
      <p class="text-[10px] uppercase tracking-wider text-muted leading-tight">{{ label }}</p>
      <p class="text-sm font-semibold truncate tabular-nums">
        {{ value }}
        <span v-if="sub" class="text-xs font-normal text-muted">{{ sub }}</span>
      </p>
    </div>
  </div>
</template>
