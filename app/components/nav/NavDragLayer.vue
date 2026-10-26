<script setup lang="ts">
const { state } = useNavDrag()
</script>

<template>
  <Teleport to="body">
    <div v-if="state.payload" class="pointer-events-none fixed inset-0 z-[100]">
      <div
        v-if="state.indicator"
        class="absolute rounded-full transition-[top,left,width,height] duration-75"
        :class="state.indicator.box ? 'rounded-lg bg-primary/15 ring-2 ring-primary' : 'bg-primary shadow-[0_0_8px_var(--ui-primary)]'"
        :style="{
          top: `${state.indicator.top}px`,
          left: `${state.indicator.left}px`,
          width: `${state.indicator.width}px`,
          height: `${state.indicator.height}px`
        }"
      />
      <div
        class="absolute flex max-w-56 items-center gap-2 rounded-lg bg-elevated px-2.5 py-1.5 text-sm font-medium text-highlighted shadow-xl ring ring-primary/50"
        :class="state.target ? '' : 'opacity-70'"
        :style="{ transform: `translate(${state.x + 14}px, ${state.y + 10}px)` }"
      >
        <UIcon :name="state.payload.icon" class="size-4 shrink-0 text-primary" />
        <span class="truncate">{{ state.payload.label }}</span>
        <UIcon v-if="!state.target" name="i-lucide-ban" class="size-3.5 shrink-0 text-dimmed" />
      </div>
    </div>
  </Teleport>
</template>
