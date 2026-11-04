<script setup lang="ts">
// Rail Tycoon — the chooser's "Your worlds" panel: owned worlds first, then joined ones, each with
// its status, members, the player's company and when it was last played. Continue or Spectate, copy
// the invite link, and for the owner the drawing, the public switch, Stop and Delete, the last two
// behind an in-app confirm. The chooser does the work; this panel only asks for it.
import type { RtWorldSummary } from '#shared/utils/rail-tycoon/protocol'
import { rtLastActiveText, rtMembersText } from '~/utils/rail-tycoon/chooser-format'
import RtWorldConfirm from './RtWorldConfirm.vue'

const props = defineProps<{
  worlds: RtWorldSummary[] | null
  avatars: Record<string, string>
  connected: boolean
  /** An action is waiting on the server. */
  busy: boolean
  /** The world a stop or delete is waiting on, with which. */
  pendingWorld: { id: string, action: 'stop' | 'delete' } | null
  /** The world whose public setting is being saved. */
  publicSaving: string | null
  avatarSaving: boolean
  /** The world whose invite link was just copied. */
  copied: string | null
  /** The clock "last active" reads. */
  now: number
}>()

const emit = defineEmits<{
  refresh: []
  play: [world: RtWorldSummary]
  copyInvite: [world: RtWorldSummary]
  editAvatar: [world: RtWorldSummary]
  setPublic: [world: RtWorldSummary, isPublic: boolean]
  stop: [world: RtWorldSummary]
  delete: [world: RtWorldSummary]
}>()

/** The row whose confirmation is open, and which. */
const confirming = ref<{ id: string, kind: 'stop' | 'delete' } | null>(null)

const sorted = computed(() => {
  const list = [...(props.worlds ?? [])]
  list.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || b.lastActiveAt - a.lastActiveAt)
  return list
})
const groups = computed(() => [
  { label: 'Owned by you', list: sorted.value.filter(w => w.isOwner) },
  { label: 'Joined', list: sorted.value.filter(w => !w.isOwner) }
])

function companyText(world: RtWorldSummary): string {
  if (world.myCompanyId !== null) return `Your company #${world.myCompanyId + 1}`
  return world.isOwner ? 'Owner, no company' : 'No company'
}

function waitingOn(world: RtWorldSummary, action: 'stop' | 'delete'): boolean {
  return props.pendingWorld?.id === world.id && props.pendingWorld.action === action
}

function ask(world: RtWorldSummary, kind: 'stop' | 'delete') {
  confirming.value = { id: world.id, kind }
}

function confirmed(world: RtWorldSummary, kind: 'stop' | 'delete') {
  confirming.value = null
  if (kind === 'stop') emit('stop', world)
  else emit('delete', world)
}

function editAvatar(world: RtWorldSummary) {
  confirming.value = null
  emit('editAvatar', world)
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') confirming.value = null
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <section class="rtc-panel rtc-worlds" aria-labelledby="rtc-worlds-h">
    <div class="rtc-panel-head">
      <h2 id="rtc-worlds-h">Your worlds</h2>
      <button type="button" class="rtc-btn rtc-btn-ghost" :disabled="!connected || busy" title="Refresh" @click="emit('refresh')">
        <UIcon name="i-lucide-refresh-cw" class="size-4" />
      </button>
    </div>

    <p v-if="worlds === null" class="rtc-empty">Loading…</p>
    <p v-else-if="!sorted.length" class="rtc-empty">
      No worlds yet. Create one, or join a friend's with their invite link.
    </p>

    <template v-for="group in groups" :key="group.label">
      <template v-if="group.list.length">
        <h3 class="rtc-group">{{ group.label }}</h3>
        <ul class="rtc-list">
          <li
            v-for="world in group.list"
            :key="world.id"
            class="rtc-world"
            :data-world-id="world.id"
            :data-invite-code="world.inviteCode"
            :data-status="world.status"
          >
            <div class="rtc-world-main">
              <ProfileEmblem :emblem="avatars[world.id]" :name="world.name" class="rtc-avatar" data-part="avatar" />
              <div class="rtc-world-name">
                <span class="rtc-name-text">{{ world.name }}</span>
                <span class="rtc-badge" :class="world.status === 'open' ? 'rtc-badge-open' : 'rtc-badge-closed'">
                  {{ world.status === 'open' ? 'Open' : 'Closed' }}
                </span>
                <span v-if="world.isPublic" class="rtc-badge rtc-badge-public" data-part="public-badge">Public</span>
              </div>
              <div class="rtc-world-meta">
                <span><UIcon name="i-lucide-users" class="size-3.5" /> {{ rtMembersText(world.memberCount, world.maxCompanies) }}</span>
                <span><UIcon name="i-lucide-briefcase" class="size-3.5" /> {{ companyText(world) }}</span>
                <span><UIcon name="i-lucide-clock" class="size-3.5" /> {{ rtLastActiveText(world.lastActiveAt, now) }}</span>
              </div>
            </div>
            <div class="rtc-world-actions">
              <button
                v-if="world.status === 'open'"
                type="button"
                class="rtc-btn rtc-btn-main"
                data-action="continue"
                :disabled="busy"
                @click="emit('play', world)"
              >
                <UIcon name="i-lucide-play" class="size-4" /> Continue
              </button>
              <button v-else type="button" class="rtc-btn" data-action="spectate" :disabled="busy" @click="emit('play', world)">
                <UIcon name="i-lucide-eye" class="size-4" /> Spectate
              </button>
              <button type="button" class="rtc-btn" data-action="copy-invite" @click="emit('copyInvite', world)">
                <UIcon :name="copied === world.id ? 'i-lucide-check' : 'i-lucide-link'" class="size-4" />
                {{ copied === world.id ? 'Copied' : 'Copy invite link' }}
              </button>
              <template v-if="world.isOwner">
                <button type="button" class="rtc-btn" data-action="edit-avatar" :disabled="avatarSaving" @click="editAvatar(world)">
                  <UIcon name="i-lucide-brush" class="size-4" /> Drawing
                </button>
                <button
                  v-if="world.status === 'open'"
                  type="button"
                  class="rtc-btn"
                  data-action="toggle-public"
                  :aria-pressed="world.isPublic"
                  :disabled="publicSaving !== null"
                  :title="world.isPublic ? 'Take it out of the public lobby' : 'List it in the public lobby, so anyone can join'"
                  @click="emit('setPublic', world, !world.isPublic)"
                >
                  <UIcon
                    :name="publicSaving === world.id ? 'i-lucide-loader-circle' : world.isPublic ? 'i-lucide-lock' : 'i-lucide-globe'"
                    class="size-4"
                    :class="{ 'animate-spin': publicSaving === world.id }"
                  />
                  {{ world.isPublic ? 'Make private' : 'Make public' }}
                </button>
                <button
                  v-if="world.status === 'open'"
                  type="button"
                  class="rtc-btn"
                  data-action="stop"
                  :disabled="!connected || busy"
                  @click="ask(world, 'stop')"
                >
                  <UIcon :name="waitingOn(world, 'stop') ? 'i-lucide-loader-circle' : 'i-lucide-square'" class="size-4" /> Stop
                </button>
                <button
                  type="button"
                  class="rtc-btn rtc-btn-danger"
                  data-action="delete"
                  :disabled="!connected || busy"
                  @click="ask(world, 'delete')"
                >
                  <UIcon :name="waitingOn(world, 'delete') ? 'i-lucide-loader-circle' : 'i-lucide-trash-2'" class="size-4" /> Delete
                </button>
              </template>
            </div>

            <RtWorldConfirm
              v-if="confirming?.id === world.id"
              :key="confirming.kind"
              :kind="confirming.kind"
              :name="world.name"
              @confirm="confirmed(world, confirming.kind)"
              @cancel="confirming = null"
            />
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>
