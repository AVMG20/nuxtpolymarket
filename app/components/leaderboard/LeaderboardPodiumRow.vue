<script setup lang="ts">
// Top-3 card row shared by colony and xeno leaderboards. Per-game stat
// columns and the progress meter differ too much to bake in, so they're slots.
withDefaults(defineProps<{
  rank: number
  name: string
  isCurrentUser: boolean
  rankBg: string[]
  medalColors?: string[]
  showAvatar?: boolean
  nameWidth?: string
  youBadgeVariant?: 'badge' | 'pill' | 'text' | 'inline'
  youBadgeSize?: string
}>(), {
  showAvatar: true,
  nameWidth: 'w-28'
})
</script>

<template>
  <div
    class="flex items-center gap-3 px-4 py-4 rounded-xl border transition-all"
    :class="[rankBg[rank], isCurrentUser ? 'ring-1 ring-primary/40' : '']"
  >
    <div class="w-8 flex items-center justify-center shrink-0">
      <LeaderboardMedal :rank="rank" size="size-7" :colors="medalColors" />
    </div>

    <div v-if="showAvatar" class="size-10 rounded-full bg-background flex items-center justify-center shrink-0 font-bold border border-default">
      {{ name[0]?.toUpperCase() }}
    </div>

    <div class="min-w-0 shrink-0" :class="nameWidth">
      <div class="flex items-center gap-1.5">
        <p class="font-bold truncate">{{ name }}</p>
        <LeaderboardYouBadge :show="isCurrentUser" :variant="youBadgeVariant" :size="youBadgeSize" />
      </div>
      <slot name="meta" />
    </div>

    <slot name="progress" />
    <slot name="stats" />
    <slot name="trailing" />
  </div>
</template>
