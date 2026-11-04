<script setup lang="ts">
// Rail Tycoon — the world chooser: the player's worlds (RtWorldList), the public lobby
// (RtLobbyList), a new world (RtCreateWorldForm) and a join by invite (RtJoinForm). Owners stop,
// delete, publish and draw their worlds from the list; Copy invite link copies
// /rail-tycoon/invite/<code> with the code from the list row.
//
// It talks to the hub over its own RtNet: list on every (re)connect, create and join answer joined,
// which opens the world through the page. The page closes this socket by unmounting the chooser
// before the game view opens its own, so a tab never holds two (the hub keeps one per user).
// An invite the page picked up from the rt-invite cookie is sent as a join once the socket is up;
// `invited` tells the page the hub answered, so it clears the cookie and a reload never joins twice.
//
// The public lobby and the world drawings come over HTTP: a drawing is too large for the socket's
// world list. Joining a lobby world is an ordinary join with the invite code the lobby lists.
import type { EmblemData } from '#shared/utils/emblem'
import { isRtInviteCode, rtWorldFull } from '#shared/utils/rail-tycoon/limits'
import type { RtClientMsg, RtErrorCode, RtLobbyWorld, RtRole, RtServerMsg, RtWorldSummary } from '#shared/utils/rail-tycoon/protocol'
import { RtNet, type RtNetStopReason } from '~/utils/rail-tycoon/net'
import { rtServerErrorText } from '~/utils/rail-tycoon/windows'
import RtCreateWorldForm from './RtCreateWorldForm.vue'
import RtJoinForm from './RtJoinForm.vue'
import RtLobbyList from './RtLobbyList.vue'
import RtWorldDrawingDialog from './RtWorldDrawingDialog.vue'
import RtWorldList from './RtWorldList.vue'

const props = withDefaults(defineProps<{
  /** An invite code to join as soon as the socket is up (from the rt-invite cookie). */
  invite?: string | null
}>(), {
  invite: null
})

const emit = defineEmits<{
  open: [worldId: string, role: RtRole]
  /** The hub answered the invite join, either way; the page clears the cookie. */
  invited: []
}>()

const toast = useToast()

type Action = 'create' | 'join' | 'invite' | 'stop' | 'delete'

const connected = ref(false)
const stopped = ref<RtNetStopReason | null>(null)
const worlds = ref<RtWorldSummary[] | null>(null)
const pending = ref<Action | null>(null)
/** The world a stop or delete is waiting on. */
const pendingWorld = ref<string | null>(null)
const inviteCopy = useRtCopyInvite()

const joinCode = ref('')
const joinError = ref<string | null>(null)

const lobby = ref<RtLobbyWorld[] | null>(null)
/** The lobby world a join is waiting on. */
const lobbyJoining = ref<string | null>(null)
/** Drawings of the player's own worlds by id; a world missing here has none. */
const avatars = ref<Record<string, string>>({})
/** World ids the drawings were fetched for, so a list refresh fetches only for a new world. */
const avatarsFor = new Set<string>()
/** The world whose drawing is open in the editor. */
const editingAvatar = ref<RtWorldSummary | null>(null)
const avatarSaving = ref(false)
/** The world whose public setting is being saved. */
const publicSaving = ref<string | null>(null)

// the clock the "last active" texts read, so they age while the chooser stays open
const now = ref(Date.now())

let net: RtNet | null = null
const offs: (() => void)[] = []
let connectionPoll: ReturnType<typeof setInterval> | null = null
let inviteSent = false

const waitingWorld = computed(() => {
  const action = pending.value
  return pendingWorld.value !== null && (action === 'stop' || action === 'delete') ? { id: pendingWorld.value, action } : null
})

const stopNotice = computed(() => {
  switch (stopped.value) {
    case 'outdated': return { title: 'Rail Tycoon was updated', text: 'Reload the page to use the new version.' }
    case 'replaced': return { title: 'Opened in another tab', text: 'Rail Tycoon is open in another tab or window. Reload to use it here instead.' }
    case 'unauthorized': return { title: 'You are signed out', text: 'Sign in again to see your worlds.' }
    default: return null
  }
})

// ─── Socket ──────────────────────────────────────────────────────────────

function send(msg: RtClientMsg): boolean {
  if (net?.send(msg)) return true
  toast.add({ title: 'Not connected to the server, try again in a moment', color: 'warning' })
  return false
}

/** Sends a message that starts `action`, unless one is already waiting. */
function start(action: Action, msg: RtClientMsg, world: string | null = null): boolean {
  if (pending.value || !send(msg)) return false
  pending.value = action
  pendingWorld.value = world
  return true
}

function refresh() {
  if (pending.value) return
  net?.send({ type: 'list' })
  loadLobby()
}

function finish() {
  pending.value = null
  pendingWorld.value = null
  lobbyJoining.value = null
}

function sendInvite() {
  if (inviteSent || !props.invite || !net?.connected) return
  inviteSent = true
  if (!isRtInviteCode(props.invite)) {
    emit('invited')
    return
  }
  pending.value = 'invite'
  net.send({ type: 'join', inviteCode: props.invite })
}

function onMessage(msg: RtServerMsg) {
  switch (msg.type) {
    case 'worldList':
      worlds.value = [...msg.worlds]
      if (pending.value === 'stop') finish()
      loadAvatars(msg.worlds)
      return
    case 'joined': {
      const wasInvite = pending.value === 'invite'
      finish()
      if (wasInvite) emit('invited')
      emit('open', msg.worldId, 'player')
      return
    }
    case 'worldDeleted':
      if (worlds.value) worlds.value = worlds.value.filter(w => w.id !== msg.worldId)
      if (pending.value === 'delete') finish()
      refresh()
      return
    case 'error':
      onError(msg.code)
      return
    default:
      return
  }
}

function onError(code: RtErrorCode) {
  const action = pending.value
  const fromLobby = lobbyJoining.value !== null
  finish()
  const text = rtServerErrorText(code)
  if (fromLobby) {
    toast.add({ title: text, color: 'error' })
    loadLobby()
    return
  }
  if (action === 'invite') {
    emit('invited')
    // keep the code in the join field, so a cooldown or a busy server is one click from a retry
    if (props.invite) joinCode.value = props.invite
    joinError.value = `Your invite could not be used: ${text}`
    return
  }
  if (action === 'join') {
    joinError.value = text
    return
  }
  toast.add({ title: text, color: 'error' })
}

// ─── Lobby and drawings (HTTP) ───────────────────────────────────────────

async function loadLobby() {
  try {
    const data = await apiFetch<{ worlds: RtLobbyWorld[] }>('/api/rail-tycoon/lobby')
    lobby.value = data.worlds
  } catch (e) {
    if (lobby.value === null) lobby.value = []
    toast.add({ title: apiErrorMessage(e, 'Could not load the public worlds'), color: 'error' })
  }
}

/** Fetches the drawings once the list holds a world they were not fetched for. */
async function loadAvatars(list: readonly RtWorldSummary[]) {
  if (list.every(w => avatarsFor.has(w.id))) return
  for (const w of list) avatarsFor.add(w.id)
  try {
    const data = await apiFetch<{ avatars: Record<string, string> }>('/api/rail-tycoon/avatars')
    avatars.value = data.avatars
  } catch {
    // a drawing is decoration: the list works without it, and the next new world fetches again
    for (const w of list) avatarsFor.delete(w.id)
  }
}

async function setPublic(world: RtWorldSummary, isPublic: boolean) {
  if (publicSaving.value) return
  publicSaving.value = world.id
  try {
    await apiFetch(`/api/rail-tycoon/worlds/${world.id}`, { method: 'PATCH', body: { isPublic } })
    if (worlds.value) worlds.value = worlds.value.map(w => w.id === world.id ? { ...w, isPublic } : w)
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not change the world'), color: 'error' })
  } finally {
    publicSaving.value = null
  }
}

async function saveAvatar(value: EmblemData | null) {
  const world = editingAvatar.value
  if (!world || avatarSaving.value) return
  avatarSaving.value = true
  try {
    const saved = await apiFetch<{ avatar: string | null }>(`/api/rail-tycoon/worlds/${world.id}`, { method: 'PATCH', body: { avatar: value } })
    const others = Object.entries(avatars.value).filter(([id]) => id !== world.id)
    avatars.value = Object.fromEntries(saved.avatar === null ? others : [...others, [world.id, saved.avatar]])
    editingAvatar.value = null
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not save the drawing'), color: 'error' })
  } finally {
    avatarSaving.value = false
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────

function create(world: Omit<Extract<RtClientMsg, { type: 'create' }>, 'type'>) {
  start('create', { type: 'create', ...world })
}

function join(inviteCode: string) {
  joinError.value = null
  start('join', { type: 'join', inviteCode })
}

function joinLobby(world: RtLobbyWorld) {
  if (!connected.value || rtWorldFull(world.maxCompanies, world.memberCount)) return
  joinError.value = null
  if (start('join', { type: 'join', inviteCode: world.inviteCode })) lobbyJoining.value = world.id
}

function play(world: RtWorldSummary) {
  if (world.status === 'closed') emit('open', world.id, 'spectator')
  else emit('open', world.id, world.myCompanyId !== null ? 'player' : 'spectator')
}

function reload() {
  window.location.reload()
}

// ─── Lifecycle ───────────────────────────────────────────────────────────

onMounted(() => {
  net = new RtNet()
  offs.push(
    net.on('message', onMessage),
    net.on('open', () => {
      connected.value = true
      sendInvite()
      net?.send({ type: 'list' })
    }),
    net.on('reconnected', () => {
      // an answer lost with the old socket never comes; the fresh list shows what happened, and an
      // unanswered invite goes out again (a join is answered joined for a member too, so never twice)
      const wasInvite = pending.value === 'invite'
      finish()
      if (wasInvite) {
        inviteSent = false
        sendInvite()
      }
    }),
    net.on('stopped', (reason) => {
      stopped.value = reason
      connected.value = false
      finish()
    })
  )
  net.connect()
  // the lobby is HTTP, so it loads whether or not the socket is up yet
  loadLobby()
  // RtNet has no close event: mirror its state for the buttons
  connectionPoll = setInterval(() => {
    const up = net?.connected ?? false
    if (up !== connected.value) connected.value = up
    if (Date.now() - now.value >= 30_000) now.value = Date.now()
  }, 500)
})

onBeforeUnmount(() => {
  if (connectionPoll !== null) clearInterval(connectionPoll)
  for (const off of offs) off()
  offs.length = 0
  net?.close()
  net = null
})

watch(() => props.invite, () => sendInvite())
</script>

<template>
  <div class="rtc">
    <div class="rtc-inner">
      <header class="rtc-head">
        <NuxtLink to="/" class="rtc-back">
          <UIcon name="i-lucide-arrow-left" class="size-4" /> Games
        </NuxtLink>
        <div class="rtc-title">
          <UIcon name="i-lucide-train-front" class="size-7" />
          <h1>Rail Tycoon</h1>
        </div>
        <p class="rtc-sub">
          Build railways and roads between towns and industries, alone or with friends, in worlds that wait for you.
        </p>
      </header>

      <div v-if="!connected && !stopped" class="rtc-banner" role="status">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" /> Connecting to the server…
      </div>
      <div v-if="pending === 'invite'" class="rtc-banner" role="status">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" /> Joining the world from your invite…
      </div>
      <div v-if="pending === 'create'" class="rtc-banner" role="status">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" /> Building your world…
      </div>

      <div class="rtc-grid">
        <div class="rtc-main">
          <RtWorldList
            :worlds="worlds"
            :avatars="avatars"
            :connected="connected"
            :busy="!!pending"
            :pending-world="waitingWorld"
            :public-saving="publicSaving"
            :avatar-saving="avatarSaving"
            :copied="inviteCopy.copied.value"
            :now="now"
            @refresh="refresh"
            @play="play"
            @copy-invite="world => inviteCopy.copy(world.inviteCode, world.id)"
            @edit-avatar="world => (editingAvatar = world)"
            @set-public="setPublic"
            @stop="world => start('stop', { type: 'stop', worldId: world.id }, world.id)"
            @delete="world => start('delete', { type: 'delete', worldId: world.id }, world.id)"
          />
          <RtLobbyList
            :lobby="lobby"
            :connected="connected"
            :busy="!!pending"
            :joining="lobbyJoining"
            :now="now"
            @join="joinLobby"
          />
        </div>

        <div class="rtc-side">
          <RtCreateWorldForm :connected="connected" :busy="!!pending" :creating="pending === 'create'" @create="create" />
          <RtJoinForm
            v-model:code="joinCode"
            v-model:error="joinError"
            :connected="connected"
            :busy="!!pending"
            :joining="pending === 'join'"
            @join="join"
          />
        </div>
      </div>

      <slot name="footer" />
    </div>

    <RtWorldDrawingDialog
      v-if="editingAvatar"
      :world="editingAvatar"
      :current="avatars[editingAvatar.id] ?? null"
      :saving="avatarSaving"
      @save="saveAvatar"
      @close="editingAvatar = null"
    />

    <div v-if="stopNotice" class="rtc-overlay" role="alertdialog">
      <div class="rtc-notice">
        <h2>{{ stopNotice.title }}</h2>
        <p>{{ stopNotice.text }}</p>
        <button type="button" class="rtc-btn rtc-btn-main" @click="reload">
          <UIcon name="i-lucide-refresh-cw" class="size-4" /> Reload
        </button>
      </div>
    </div>
  </div>
</template>

<!-- not scoped: the panels are child components sharing these rtc- classes, a prefix no other page uses -->
<style>
.rtc {
  position: relative;
  min-height: 100dvh;
  background:
    radial-gradient(ellipse at top, rgba(91, 125, 58, 0.18), transparent 60%),
    #1b1914;
  color: #ece6d6;
  font-size: 14px;
}
.rtc-inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 16px 32px;
}
.rtc-head {
  margin-bottom: 18px;
}
.rtc-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #a8a08c;
  font-size: 13px;
}
.rtc-back:hover {
  color: #ece6d6;
}
.rtc-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  color: #f0d27a;
}
.rtc-title h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.02em;
}
.rtc-sub {
  margin: 6px 0 0;
  max-width: 640px;
  color: #cfc8b6;
}
.rtc-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  border: 1px solid #6b6455;
  background: #2b2720;
  font-weight: 600;
}
.rtc-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  align-items: start;
}
@media (max-width: 820px) {
  .rtc-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.rtc-main,
.rtc-side {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.rtc-avatar {
  display: flex;
  width: 44px;
  margin-bottom: 6px;
}
.rtc-badge-public {
  color: #7ec8e3;
}
.rtc-notice.rtc-avatar-editor {
  width: min(640px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
}
.rtc-avatar-actions {
  justify-content: flex-end;
  margin-top: 12px;
}
.rtc-panel {
  padding: 14px 16px;
  border: 1px solid #6b6455;
  background: #2b2720;
  box-shadow: inset 0 1px 0 #4a4438, 0 6px 20px rgba(0, 0, 0, 0.35);
}
.rtc-panel h2 {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 700;
}
.rtc-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.rtc-panel-head h2 {
  margin: 0;
}
.rtc-empty {
  margin: 12px 0 4px;
  color: #a8a08c;
}
.rtc-group {
  margin: 14px 0 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a8a08c;
}
.rtc-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rtc-world {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #201d17;
  background: #3a352c;
}
.rtc-world-main {
  flex: 1 1 260px;
  min-width: 0;
}
.rtc-world-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
}
.rtc-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rtc-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid currentColor;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.rtc-badge-open {
  color: #9ccc65;
}
.rtc-badge-closed {
  color: #f0b46a;
}
.rtc-world-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 4px;
  color: #cfc8b6;
  font-size: 12px;
}
.rtc-world-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.rtc-world-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.rtc-confirm {
  flex-basis: 100%;
  padding: 10px 12px;
  border: 1px solid #8a5a3a;
  background: #2b2720;
}
.rtc-confirm p {
  margin: 0 0 8px;
  color: #ece6d6;
}
.rtc-confirm .rtc-input {
  margin-bottom: 8px;
}
.rtc-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.rtc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid #6b6455;
  background: #4a4438;
  color: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.rtc-btn:hover:not(:disabled) {
  background: #5a5344;
}
.rtc-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.rtc-btn-main {
  background: #5b7d3a;
  border-color: #7da255;
}
.rtc-btn-main:hover:not(:disabled) {
  background: #6b9045;
}
.rtc-btn-danger {
  background: #7a3328;
  border-color: #a5483a;
}
.rtc-btn-danger:hover:not(:disabled) {
  background: #8e3d30;
}
.rtc-btn-ghost {
  padding: 4px 6px;
  background: transparent;
  border-color: transparent;
}
.rtc-btn-wide {
  width: 100%;
  margin-top: 12px;
}
.rtc-field {
  display: grid;
  gap: 4px;
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 600;
  color: #cfc8b6;
}
.rtc-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #14120e;
  background: #1b1914;
  color: #ece6d6;
  font-size: 14px;
}
.rtc-input:focus {
  outline: 1px solid #f0d27a;
}
.rtc-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.04em;
}
.rtc-seg {
  display: flex;
  border: 1px solid #14120e;
}
.rtc-seg-btn {
  flex: 1;
  padding: 6px 4px;
  background: #1b1914;
  color: #cfc8b6;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.rtc-seg-btn + .rtc-seg-btn {
  border-left: 1px solid #14120e;
}
.rtc-seg-on {
  background: #5b7d3a;
  color: #fff;
}
.rtc-check {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  cursor: pointer;
}
.rtc-check input {
  margin-top: 3px;
}
.rtc-check small {
  display: block;
  margin-top: 2px;
  color: #a8a08c;
  font-size: 12px;
}
.rtc-hint {
  margin: -4px 0 8px;
  font-size: 12px;
}
.rtc-hint-bad {
  color: #ff8a7a;
}
.rtc-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.75);
}
.rtc-notice {
  width: min(420px, calc(100vw - 32px));
  padding: 18px 20px;
  border: 1px solid #6b6455;
  background: #2b2720;
}
.rtc-notice h2 {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 700;
}
.rtc-notice p {
  margin: 0 0 14px;
  color: #cfc8b6;
}
</style>
