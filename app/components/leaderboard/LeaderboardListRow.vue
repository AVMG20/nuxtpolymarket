<script setup lang="ts">
// Rest-of-list row shared by colony and xeno leaderboards. Wrapper classes are
// passed in whole (rather than assembled here) so each page's exact highlight
// styling - which differs in where `border-default` lives - survives untouched.
withDefaults(defineProps<{
  rank: number
  name: string
  isCurrentUser: boolean
  wrapperBaseClass: string
  wrapperActiveClass: string
  wrapperInactiveClass: string
  nameWidth?: string
  youBadgeVariant?: 'badge' | 'pill' | 'text' | 'inline'
  youBadgeSize?: string
}>(), {
  nameWidth: 'w-24',
  youBadgeVariant: 'pill',
  youBadgeSize: 'text-[9px]'
})
</script>

<template>
  <div
    :class="[wrapperBaseClass, isCurrentUser ? wrapperActiveClass : wrapperInactiveClass]"
  >
    <span class="w-7 text-center text-muted font-mono text-sm shrink-0">{{ rank }}</span>
    <div class="size-8 rounded-full bg-background flex items-center justify-center shrink-0 text-xs font-bold border border-default">
      {{ name[0]?.toUpperCase() }}
    </div>
    <div class="min-w-0 shrink-0" :class="nameWidth">
      <div class="flex items-center gap-1.5">
        <p class="font-medium truncate text-sm">{{ name }}</p>
        <LeaderboardYouBadge :show="isCurrentUser" :variant="youBadgeVariant" :size="youBadgeSize" />
      </div>
      <slot name="meta" />
    </div>

    <slot name="middle" />
    <slot name="stats" />
    <slot name="trailing" />
  </div>
</template>
