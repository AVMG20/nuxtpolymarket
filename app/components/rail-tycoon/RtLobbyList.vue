<script setup lang="ts">
// Rail Tycoon — the chooser's public lobby: open public worlds the player has not joined, with the
// owner, members and last activity, and Join.
import { rtWorldFull } from '#shared/utils/rail-tycoon/limits'
import type { RtLobbyWorld } from '#shared/utils/rail-tycoon/protocol'
import { rtLastActiveText, rtMembersText } from '~/utils/rail-tycoon/chooser-format'

defineProps<{
  lobby: RtLobbyWorld[] | null
  connected: boolean
  busy: boolean
  /** The lobby world a join is waiting on. */
  joining: string | null
  now: number
}>()

const emit = defineEmits<{
  join: [world: RtLobbyWorld]
}>()

function full(world: RtLobbyWorld): boolean {
  return rtWorldFull(world.maxCompanies, world.memberCount)
}
</script>

<template>
  <section class="rtc-panel" aria-labelledby="rtc-lobby-h">
    <div class="rtc-panel-head">
      <h2 id="rtc-lobby-h">Public worlds</h2>
    </div>
    <p v-if="lobby === null" class="rtc-empty">Loading…</p>
    <p v-else-if="!lobby.length" class="rtc-empty">No public worlds to join right now. Make one of yours public to list it here.</p>
    <ul v-else class="rtc-list rtc-lobby">
      <li v-for="world in lobby" :key="world.id" class="rtc-world" :data-lobby-world-id="world.id">
        <div class="rtc-world-main">
          <ProfileEmblem :emblem="world.avatar" :name="world.name" class="rtc-avatar" data-part="avatar" />
          <div class="rtc-world-name">
            <span class="rtc-name-text">{{ world.name }}</span>
            <span v-if="full(world)" class="rtc-badge rtc-badge-closed">Full</span>
          </div>
          <div class="rtc-world-meta">
            <span><UIcon name="i-lucide-crown" class="size-3.5" /> {{ world.ownerName }}</span>
            <span><UIcon name="i-lucide-users" class="size-3.5" /> {{ rtMembersText(world.memberCount, world.maxCompanies) }}</span>
            <span><UIcon name="i-lucide-clock" class="size-3.5" /> {{ rtLastActiveText(world.lastActiveAt, now) }}</span>
          </div>
        </div>
        <div class="rtc-world-actions">
          <button
            type="button"
            class="rtc-btn rtc-btn-main"
            data-action="join-public"
            :disabled="!connected || busy || full(world)"
            @click="emit('join', world)"
          >
            <UIcon
              :name="joining === world.id ? 'i-lucide-loader-circle' : 'i-lucide-log-in'"
              class="size-4"
              :class="{ 'animate-spin': joining === world.id }"
            />
            Join
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
