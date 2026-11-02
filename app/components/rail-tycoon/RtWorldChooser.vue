<script setup lang="ts">
// Rail Tycoon — the world chooser: every world the player owns or joined (owned first), with
// its status, members, the player's company and when it was last played; Continue an open world or
// Spectate a closed one; create a world; join one by invite code; and for the owner, Stop (an in-app
// confirm) and Delete (type the world's name). Copy invite link copies /rail-tycoon/invite/<code>
// with the code from the list row.
//
// It talks to the hub over its own RtNet: list on every (re)connect, create and join answer joined,
// which opens the world through the page. The page closes this socket by unmounting the chooser
// before the game view opens its own, so a tab never holds two (the hub keeps one per user).
// An invite the page picked up from the rt-invite cookie is sent as a join once the socket is up;
// `invited` tells the page the hub answered, so it clears the cookie and a reload never joins twice.
import { RT_MAP_SIDES } from '#shared/utils/rail-tycoon/map'
import { isRtInviteCode } from '#shared/utils/rail-tycoon/limits'
import { RT_PROTOCOL_BOUNDS, type RtErrorCode, type RtRole, type RtServerMsg, type RtWorldSummary } from '#shared/utils/rail-tycoon/protocol'
import { RtNet, type RtNetStopReason } from '~/utils/rail-tycoon/net'
import { rtServerErrorText } from '~/utils/rail-tycoon/windows'

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

const NAME_MAX_BYTES = RT_PROTOCOL_BOUNDS.nameBytes
const MIN_COMPANIES = RT_PROTOCOL_BOUNDS.minCompanies
const MAX_COMPANIES = RT_PROTOCOL_BOUNDS.companies
const SIDES = RT_MAP_SIDES

const connected = ref(false)
const stopped = ref<RtNetStopReason | null>(null)
const worlds = ref<RtWorldSummary[] | null>(null)
const pending = ref<Action | null>(null)
/** The world a stop or delete is waiting on. */
const pendingWorld = ref<string | null>(null)
const copied = ref<string | null>(null)

const form = reactive({
  name: '',
  side: 128,
  maxCompanies: 4,
  sharing: true
})
const joinCode = ref('')
const joinError = ref<string | null>(null)

const confirmStop = ref<RtWorldSummary | null>(null)
const confirmDelete = ref<RtWorldSummary | null>(null)
const deleteTyped = ref('')

let net: RtNet | null = null
const offs: (() => void)[] = []
let copiedTimer: ReturnType<typeof setTimeout> | null = null
let connectionPoll: ReturnType<typeof setInterval> | null = null
let inviteSent = false

// ─── Derived ─────────────────────────────────────────────────────────────

const encoder = new TextEncoder()
const nameBytes = computed(() => encoder.encode(form.name.trim()).length)
const nameTooLong = computed(() => nameBytes.value > NAME_MAX_BYTES)
const canCreate = computed(() => connected.value && !pending.value && form.name.trim().length > 0 && !nameTooLong.value)

/** What the player typed or pasted: a bare code or a whole invite link, uppercased. */
const joinInput = computed(() => {
  const text = joinCode.value.trim()
  const fromLink = /\/rail-tycoon\/invite\/([0-9a-z]+)\/?$/i.exec(text)
  return (fromLink ? fromLink[1]! : text).toUpperCase()
})
const joinValid = computed(() => isRtInviteCode(joinInput.value))
const canJoin = computed(() => connected.value && !pending.value && joinValid.value)

const sorted = computed(() => {
  const list = [...(worlds.value ?? [])]
  list.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || b.lastActiveAt - a.lastActiveAt)
  return list
})
const owned = computed(() => sorted.value.filter(w => w.isOwner))
const joined = computed(() => sorted.value.filter(w => !w.isOwner))

const deleteMatches = computed(() => !!confirmDelete.value && deleteTyped.value === confirmDelete.value.name)

const stopNotice = computed(() => {
  switch (stopped.value) {
    case 'outdated': return { title: 'Rail Tycoon was updated', text: 'Reload the page to use the new version.' }
    case 'replaced': return { title: 'Opened in another tab', text: 'Rail Tycoon is open in another tab or window. Reload to use it here instead.' }
    case 'unauthorized': return { title: 'You are signed out', text: 'Sign in again to see your worlds.' }
    default: return null
  }
})

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
// the clock the "last active" texts read, so they age while the chooser stays open
const now = ref(Date.now())

function lastActive(at: number): string {
  const seconds = Math.round((at - now.value) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 60) return 'just now'
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour')
  if (abs < 86400 * 30) return relative.format(Math.round(seconds / 86400), 'day')
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function companyText(world: RtWorldSummary): string {
  if (world.myCompanyId !== null) return `Your company #${world.myCompanyId + 1}`
  return world.isOwner ? 'Owner, no company' : 'No company'
}

function membersText(world: RtWorldSummary): string {
  return world.maxCompanies === null ? `${world.memberCount} members` : `${world.memberCount} of ${world.maxCompanies} members`
}

function inviteLink(world: RtWorldSummary): string {
  return `${location.origin}/rail-tycoon/invite/${world.inviteCode}`
}

// ─── Socket ──────────────────────────────────────────────────────────────

function send(msg: Parameters<RtNet['send']>[0]): boolean {
  if (net?.send(msg)) return true
  toast.add({ title: 'Not connected to the server, try again in a moment', color: 'warning' })
  return false
}

function refresh() {
  if (pending.value) return
  net?.send({ type: 'list' })
}

function finish() {
  pending.value = null
  pendingWorld.value = null
}

function sendInvite() {
  if (inviteSent || !props.invite || !net?.connected) return
  if (!isRtInviteCode(props.invite)) {
    inviteSent = true
    emit('invited')
    return
  }
  inviteSent = true
  pending.value = 'invite'
  net.send({ type: 'join', inviteCode: props.invite })
}

function onMessage(msg: RtServerMsg) {
  switch (msg.type) {
    case 'worldList':
      worlds.value = [...msg.worlds]
      if (pending.value === 'stop') finish()
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
  finish()
  const text = rtServerErrorText(code)
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

// ─── Actions ─────────────────────────────────────────────────────────────

function create() {
  if (!canCreate.value) return
  const ok = send({
    type: 'create',
    name: form.name.trim(),
    side: form.side,
    maxCompanies: form.maxCompanies,
    sharing: form.sharing
  })
  if (ok) pending.value = 'create'
}

function join() {
  if (!canJoin.value) return
  joinError.value = null
  if (send({ type: 'join', inviteCode: joinInput.value })) pending.value = 'join'
}

function play(world: RtWorldSummary) {
  if (world.status === 'closed') emit('open', world.id, 'spectator')
  else emit('open', world.id, world.myCompanyId !== null ? 'player' : 'spectator')
}

async function copyInvite(world: RtWorldSummary) {
  try {
    await navigator.clipboard.writeText(inviteLink(world))
  } catch {
    toast.add({ title: 'Could not copy the invite link', description: inviteLink(world), color: 'error' })
    return
  }
  copied.value = world.id
  if (copiedTimer !== null) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copied.value = null
    copiedTimer = null
  }, 2000)
}

function askStop(world: RtWorldSummary) {
  confirmDelete.value = null
  confirmStop.value = world
}

function doStop() {
  const world = confirmStop.value
  confirmStop.value = null
  if (!world || pending.value) return
  if (send({ type: 'stop', worldId: world.id })) {
    pending.value = 'stop'
    pendingWorld.value = world.id
  }
}

function askDelete(world: RtWorldSummary) {
  confirmStop.value = null
  deleteTyped.value = ''
  confirmDelete.value = world
}

function doDelete() {
  const world = confirmDelete.value
  if (!world || !deleteMatches.value || pending.value) return
  confirmDelete.value = null
  deleteTyped.value = ''
  if (send({ type: 'delete', worldId: world.id })) {
    pending.value = 'delete'
    pendingWorld.value = world.id
  }
}

function cancelDialogs() {
  confirmStop.value = null
  confirmDelete.value = null
  deleteTyped.value = ''
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && (confirmStop.value || confirmDelete.value)) cancelDialogs()
}

function reload() {
  window.location.reload()
}

// ─── Lifecycle ───────────────────────────────────────────────────────────

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
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
  // RtNet has no close event: mirror its state for the buttons
  connectionPoll = setInterval(() => {
    const up = net?.connected ?? false
    if (up !== connected.value) connected.value = up
    if (Date.now() - now.value >= 30_000) now.value = Date.now()
  }, 500)
})

onBeforeUnmount(() => {
  if (connectionPoll !== null) clearInterval(connectionPoll)
  window.removeEventListener('keydown', onKeyDown)
  if (copiedTimer !== null) clearTimeout(copiedTimer)
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
        <!-- the player's worlds -->
        <section class="rtc-panel rtc-worlds" aria-labelledby="rtc-worlds-h">
          <div class="rtc-panel-head">
            <h2 id="rtc-worlds-h">Your worlds</h2>
            <button type="button" class="rtc-btn rtc-btn-ghost" :disabled="!connected || !!pending" title="Refresh" @click="refresh">
              <UIcon name="i-lucide-refresh-cw" class="size-4" />
            </button>
          </div>

          <p v-if="worlds === null" class="rtc-empty">Loading…</p>
          <p v-else-if="!sorted.length" class="rtc-empty">
            No worlds yet. Create one, or join a friend's with their invite link.
          </p>

          <template v-for="group in [{ label: 'Owned by you', list: owned }, { label: 'Joined', list: joined }]" :key="group.label">
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
                    <div class="rtc-world-name">
                      <span class="rtc-name-text">{{ world.name }}</span>
                      <span class="rtc-badge" :class="world.status === 'open' ? 'rtc-badge-open' : 'rtc-badge-closed'">
                        {{ world.status === 'open' ? 'Open' : 'Closed' }}
                      </span>
                    </div>
                    <div class="rtc-world-meta">
                      <span><UIcon name="i-lucide-users" class="size-3.5" /> {{ membersText(world) }}</span>
                      <span><UIcon name="i-lucide-briefcase" class="size-3.5" /> {{ companyText(world) }}</span>
                      <span><UIcon name="i-lucide-clock" class="size-3.5" /> {{ lastActive(world.lastActiveAt) }}</span>
                    </div>
                  </div>
                  <div class="rtc-world-actions">
                    <button
                      v-if="world.status === 'open'"
                      type="button"
                      class="rtc-btn rtc-btn-main"
                      data-action="continue"
                      :disabled="!!pending"
                      @click="play(world)"
                    >
                      <UIcon name="i-lucide-play" class="size-4" /> Continue
                    </button>
                    <button v-else type="button" class="rtc-btn" data-action="spectate" :disabled="!!pending" @click="play(world)">
                      <UIcon name="i-lucide-eye" class="size-4" /> Spectate
                    </button>
                    <button type="button" class="rtc-btn" data-action="copy-invite" @click="copyInvite(world)">
                      <UIcon :name="copied === world.id ? 'i-lucide-check' : 'i-lucide-link'" class="size-4" />
                      {{ copied === world.id ? 'Copied' : 'Copy invite link' }}
                    </button>
                    <template v-if="world.isOwner">
                      <button
                        v-if="world.status === 'open'"
                        type="button"
                        class="rtc-btn"
                        data-action="stop"
                        :disabled="!connected || !!pending"
                        @click="askStop(world)"
                      >
                        <UIcon :name="pendingWorld === world.id && pending === 'stop' ? 'i-lucide-loader-circle' : 'i-lucide-square'" class="size-4" /> Stop
                      </button>
                      <button
                        type="button"
                        class="rtc-btn rtc-btn-danger"
                        data-action="delete"
                        :disabled="!connected || !!pending"
                        @click="askDelete(world)"
                      >
                        <UIcon :name="pendingWorld === world.id && pending === 'delete' ? 'i-lucide-loader-circle' : 'i-lucide-trash-2'" class="size-4" /> Delete
                      </button>
                    </template>
                  </div>

                  <!-- in-app confirmations: browser dialogs would block automation and look foreign -->
                  <div v-if="confirmStop?.id === world.id" class="rtc-confirm" role="alertdialog" aria-label="Stop world">
                    <p>Stop <b>{{ world.name }}</b>? It closes for everyone: nobody can build or join, and it stays open to watch.</p>
                    <div class="rtc-confirm-actions">
                      <button type="button" class="rtc-btn rtc-btn-danger" data-action="confirm-stop" @click="doStop">Stop the world</button>
                      <button type="button" class="rtc-btn" @click="cancelDialogs">Cancel</button>
                    </div>
                  </div>
                  <div v-if="confirmDelete?.id === world.id" class="rtc-confirm" role="alertdialog" aria-label="Delete world">
                    <p>Delete <b>{{ world.name }}</b> for good? Every company in it is lost. Type the world's name to confirm.</p>
                    <input
                      v-model="deleteTyped"
                      type="text"
                      class="rtc-input"
                      data-field="delete-name"
                      :placeholder="world.name"
                      autocomplete="off"
                      @keydown.enter="doDelete"
                    >
                    <div class="rtc-confirm-actions">
                      <button type="button" class="rtc-btn rtc-btn-danger" data-action="confirm-delete" :disabled="!deleteMatches" @click="doDelete">
                        Delete the world
                      </button>
                      <button type="button" class="rtc-btn" @click="cancelDialogs">Cancel</button>
                    </div>
                  </div>
                </li>
              </ul>
            </template>
          </template>
        </section>

        <div class="rtc-side">
          <!-- create -->
          <form class="rtc-panel" aria-labelledby="rtc-create-h" @submit.prevent="create">
            <h2 id="rtc-create-h">New world</h2>
            <label class="rtc-field">
              <span>Name</span>
              <input v-model="form.name" type="text" class="rtc-input" data-field="world-name" placeholder="My railway" autocomplete="off">
            </label>
            <p v-if="nameTooLong" class="rtc-hint rtc-hint-bad">That name is too long ({{ nameBytes }} of {{ NAME_MAX_BYTES }} bytes; accents and emoji count extra).</p>

            <div class="rtc-field">
              <span>Map size</span>
              <div class="rtc-seg" role="radiogroup" aria-label="Map size">
                <button
                  v-for="side in SIDES"
                  :key="side"
                  type="button"
                  role="radio"
                  class="rtc-seg-btn"
                  :class="{ 'rtc-seg-on': form.side === side }"
                  :aria-checked="form.side === side"
                  :data-side="side"
                  @click="form.side = side"
                >
                  {{ side }}×{{ side }}
                </button>
              </div>
            </div>

            <label class="rtc-field">
              <span>Companies (most)</span>
              <select v-model.number="form.maxCompanies" class="rtc-input" data-field="max-companies">
                <option v-for="n in MAX_COMPANIES - MIN_COMPANIES + 1" :key="n" :value="n + MIN_COMPANIES - 1">{{ n + MIN_COMPANIES - 1 }}</option>
              </select>
            </label>

            <label class="rtc-check">
              <input v-model="form.sharing" type="checkbox" data-field="sharing">
              <span>
                <b>Share track and stations</b>
                <small>Other companies' trains and buses may use your track and stations and pay you for it.</small>
              </span>
            </label>

            <button type="submit" class="rtc-btn rtc-btn-main rtc-btn-wide" data-action="create" :disabled="!canCreate">
              <UIcon :name="pending === 'create' ? 'i-lucide-loader-circle' : 'i-lucide-plus'" class="size-4" :class="{ 'animate-spin': pending === 'create' }" />
              Create world
            </button>
          </form>

          <!-- join by invite -->
          <form class="rtc-panel" aria-labelledby="rtc-join-h" @submit.prevent="join">
            <h2 id="rtc-join-h">Join with an invite</h2>
            <label class="rtc-field">
              <span>Invite link or code</span>
              <input
                v-model="joinCode"
                type="text"
                class="rtc-input rtc-mono"
                data-field="invite-code"
                placeholder="Paste an invite link"
                autocomplete="off"
                spellcheck="false"
                @input="joinError = null"
              >
            </label>
            <p v-if="joinError" class="rtc-hint rtc-hint-bad" role="alert">{{ joinError }}</p>
            <button type="submit" class="rtc-btn rtc-btn-main rtc-btn-wide" data-action="join" :disabled="!canJoin">
              <UIcon :name="pending === 'join' ? 'i-lucide-loader-circle' : 'i-lucide-log-in'" class="size-4" :class="{ 'animate-spin': pending === 'join' }" />
              Join world
            </button>
          </form>
        </div>
      </div>

      <slot name="footer" />
    </div>

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

<style scoped>
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
.rtc-side {
  display: grid;
  gap: 16px;
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
