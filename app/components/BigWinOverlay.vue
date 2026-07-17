<script setup lang="ts">
// Structural shell only. Label/amount markup, fonts and per-tier animation are
// supplied by the slot itself via the default slot — every game reskins this
// completely (own gradient, own throb/pop keyframes), so baking any of that in
// here would fight the next game that adopts it.
// Wrap usage in `<Transition name="pop">` in the caller: a child component's
// root node inherits the parent's scope id, so the caller's own
// `.pop-enter-active` keeps driving the transition unchanged.
defineProps<{
  tint: string
}>()
</script>

<template>
  <div
    class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1 backdrop-blur-[4px]"
    :style="{ backgroundColor: tint }"
  >
    <slot />
  </div>
</template>
