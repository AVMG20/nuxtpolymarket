// Rail Tycoon — one game view's connection to its world.
//
// Opens the world over RtNet, offering the parts cached from the last visit (part-cache.ts) or, on a
// reopen, the current world's, and builds an RtLockstep from each snapshot. A reconnect, a room that
// unloaded or a resync replaces the lockstep while the old world stays on screen; a refused open retries
// after RtNet's backoff. Leaving caches the world as left, so the next visit downloads only what changed.
import type { RtCommand } from '#shared/utils/rail-tycoon/commands'
import type { RtClientMsg, RtErrorCode, RtPauseReason, RtRole, RtServerMsg } from '#shared/utils/rail-tycoon/protocol'
import { RtLockstep, type RtLocalParts, type RtSnapshot } from '~/utils/rail-tycoon/lockstep'
import { RT_NET_BACKOFF_MAX_MS, RT_NET_BACKOFF_MIN_MS, RtNet, type RtNetStopReason } from '~/utils/rail-tycoon/net'
import { rtCacheParts, rtCachedParts, rtForgetParts } from '~/utils/rail-tycoon/part-cache'
import { rtCommandErrorText, rtServerErrorText, type RtConnectionStatus, type RtLeaveReason } from '~/utils/rail-tycoon/windows'

export interface RtSessionOptions {
  worldId: string
  /** The role the chooser opened the world as; the opened message has the last word. */
  role: RtRole
  /** An invite code lets a stranger spectate. */
  inviteCode: string | null
  /** A new lockstep is in place, the first or a replacement. */
  onInstalled(lockstep: RtLockstep): void
  /** The player can no longer build: a spectator role, or the owner closed the world. */
  onSpectator(): void
  /** The lockstep stepped tiles that changed. */
  onDirty(): void
  onLeave(reason: RtLeaveReason): void
}

type OpenedMeta = Pick<Extract<RtServerMsg, { type: 'opened' }>, 'role' | 'company' | 'owner' | 'inviteCode'>

export function useRtSession(options: RtSessionOptions) {
  const toast = useToast()
  const worldId = options.worldId

  const lockstep = shallowRef<RtLockstep | null>(null)
  /** The world tick for the UI; the frame loop moves it on at most every RT_GAME_TICK_MS. */
  const tick = ref(0)
  const socketUp = ref(false)
  const everOpened = ref(false)
  /** Waiting for an opened message (first open, reconnect, unloaded room). */
  const opening = ref(true)
  const resyncing = ref(false)
  const stopped = ref<RtNetStopReason | null>(null)
  const role = ref<RtRole>(options.role)
  const companyId = ref<number | null>(null)
  const owner = ref(false)
  const invite = ref<string | null>(options.inviteCode)
  const paused = ref<RtPauseReason | null>(null)
  const closed = ref(false)

  let net: RtNet | null = null
  let unmounted = false
  const offs: (() => void)[] = []
  let lockstepOffs: (() => void)[] = []
  /** The role, company, owner and invite of the last opened message, for a resync that has no lockstep to inherit from. */
  let openedMeta: OpenedMeta | null = null
  /** Bumped by every snapshot message, so a slower earlier build never replaces a newer one. */
  let buildToken = 0
  /** The cached parts the last open offered, until a build has used them. */
  let cachedParts: RtLocalParts = new Map()
  /** The world was deleted: leaving must not cache it again. */
  let forgotten = false
  let reopenTimer: ReturnType<typeof setTimeout> | null = null
  let reopenAttempt = 0
  let seq = 0

  const status = computed<RtConnectionStatus>(() => {
    if (stopped.value) return 'stopped'
    if (!socketUp.value) return everOpened.value ? 'reconnecting' : 'connecting'
    if (opening.value || !lockstep.value) return 'connecting'
    if (resyncing.value) return 'resyncing'
    if (closed.value) return 'closed'
    if (role.value === 'spectator') return 'spectating'
    return 'connected'
  })

  // ─── Sending ─────────────────────────────────────────────────────────────

  function canCommand(): boolean {
    const ls = lockstep.value
    return !!ls && ls.canCommand && !opening.value && socketUp.value && !closed.value
  }

  /** Sends a player command; false when it was not sent (spectator, closed, resyncing, offline). */
  function sendCommand(command: RtCommand): boolean {
    const ls = lockstep.value
    if (!ls || !net || !canCommand()) return false
    seq = (seq + 1) & 0xff
    const msg = ls.commandMessage(command, seq)
    if (!msg) return false
    return net.send(msg)
  }

  function send(msg: RtClientMsg): boolean {
    return net?.send(msg) ?? false
  }

  /** Called every frame: RtNet has no close event, so a dropped socket shows here. */
  function pollSocket(): void {
    if (net && socketUp.value && !net.connected) socketUp.value = false
  }

  // ─── Opening and replacing the lockstep ──────────────────────────────────

  /** Opens the world, offering the current world's parts on a reopen or the cached ones on a first open. */
  async function sendOpen() {
    if (!net || unmounted || stopped.value) return
    opening.value = true
    const ls = lockstep.value
    let have: string[]
    if (ls) {
      have = ls.offerParts()
    } else {
      const cached = await rtCachedParts(worldId)
      if (!net || unmounted || stopped.value) return
      cachedParts = cached.local
      have = cached.have
    }
    net.send({ type: 'open', worldId, inviteCode: options.inviteCode, have })
  }

  /** Re-sends open after the capped backoff RtNet uses for its reconnects. */
  function reopenLater() {
    if (reopenTimer !== null || unmounted) return
    opening.value = true
    const delay = Math.min(RT_NET_BACKOFF_MAX_MS, RT_NET_BACKOFF_MIN_MS * 2 ** reopenAttempt)
    reopenAttempt++
    reopenTimer = setTimeout(() => {
      reopenTimer = null
      void sendOpen()
    }, delay)
  }

  function cancelReopen() {
    if (reopenTimer !== null) clearTimeout(reopenTimer)
    reopenTimer = null
  }

  async function buildLockstep(snapshot: RtSnapshot) {
    const token = ++buildToken
    const previous = lockstep.value
    const msg = snapshot.head
    let source: RtSnapshot = snapshot
    if (msg.type === 'resync' && !previous) {
      // the first build failed and asked for this resync: it carries no role, so reuse the opened one's
      if (!openedMeta) {
        net?.discardHeld()
        return
      }
      source = { ...snapshot, head: { ...msg, type: 'opened', ...openedMeta } }
    }
    const built = await RtLockstep.create(source, send, {
      previous: msg.type === 'resync' ? previous ?? undefined : undefined,
      local: new Map([...cachedParts, ...(previous?.heldParts ?? [])]),
      keep: (parts) => {
        if (!forgotten) void rtCacheParts(worldId, parts)
      }
    })
    if (unmounted || token !== buildToken) return
    if (!built) {
      // it asked for a resync already; the answer builds the next one
      resyncing.value = true
      return
    }
    cachedParts = new Map()
    install(markRaw(built), msg.type === 'opened')
    net?.release(m => built.receive(m))
  }

  /** Puts a freshly built lockstep in place; `fresh` is a new open, after which the room re-sends its pause state. */
  function install(ls: RtLockstep, fresh: boolean) {
    for (const off of lockstepOffs) off()
    lockstepOffs = [
      ls.on('paused', (reason) => {
        paused.value = reason
        // a closed world's room pauses for good; a spectator opening it learns it was closed here
        if (reason === 'closed' && !closed.value) closeWorld()
      }),
      ls.on('resumed', () => {
        paused.value = null
      }),
      ls.on('role', (next) => {
        role.value = next
        if (next === 'spectator') closeWorld()
      }),
      ls.on('resync', () => {
        resyncing.value = true
      }),
      ls.on('dirty', () => options.onDirty())
    ]
    lockstep.value = ls
    role.value = ls.role
    companyId.value = ls.company
    owner.value = ls.owner
    invite.value = ls.inviteCode
    // the room sends its pause state after every opened; a resync keeps the one already shown
    if (fresh) paused.value = null
    resyncing.value = false
    // a room that unloaded while this was being built is opened again shortly: stay in opening until then
    opening.value = reopenTimer !== null
    everOpened.value = true
    reopenAttempt = 0
    tick.value = ls.world.tick
    options.onInstalled(ls)
    if (ls.role !== 'player') options.onSpectator()
  }

  /** The owner stopped the world: everyone spectates. */
  function closeWorld() {
    closed.value = true
    options.onSpectator()
  }

  // ─── Messages ────────────────────────────────────────────────────────────

  function onSnapshot(snapshot: RtSnapshot) {
    const msg = snapshot.head
    if (msg.worldId !== worldId) {
      net?.discardHeld()
      return
    }
    if (msg.type === 'opened') {
      openedMeta = { role: msg.role, company: msg.company, owner: msg.owner, inviteCode: msg.inviteCode }
      closed.value = false
      cancelReopen()
    } else {
      resyncing.value = true
    }
    void buildLockstep(snapshot)
  }

  function onMessage(msg: RtServerMsg) {
    switch (msg.type) {
      case 'command':
      case 'allowance':
      case 'hash':
      case 'paused':
      case 'resumed':
      case 'worldClosed':
        // only reaches here once the lockstep is built (RtNet holds them until release)
        lockstep.value?.receive(msg)
        return
      case 'result':
        toast.add({ title: rtCommandErrorText(msg.error), color: 'error' })
        return
      case 'roomUnloaded':
        // the room went away under us: keep the old world on screen behind the overlay and open again
        reopenLater()
        return
      case 'worldDeleted':
        void rtForgetParts(msg.worldId)
        if (msg.worldId === worldId) {
          forgotten = true
          options.onLeave('deleted')
        }
        return
      case 'error':
        onError(msg.code)
        return
      default:
        return
    }
  }

  function onError(code: RtErrorCode) {
    if (code === 'worldBroken') {
      cancelReopen()
      options.onLeave('broken')
      return
    }
    if (code === 'noAccess') {
      options.onLeave('noAccess')
      return
    }
    // an open or a resync refused for a cooldown or a full server: open again after the backoff, which
    // also brings a fresh snapshot for the resync
    if ((opening.value || resyncing.value) && (code === 'tooSoon' || code === 'busy')) {
      reopenLater()
      return
    }
    toast.add({ title: rtServerErrorText(code), color: 'error' })
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  onMounted(() => {
    net = new RtNet()
    offs.push(
      net.on('message', onMessage),
      net.on('snapshot', onSnapshot),
      net.on('open', () => {
        socketUp.value = true
        // every open, the first and each reconnect, opens the world again
        cancelReopen()
        void sendOpen()
      }),
      net.on('stopped', (reason) => {
        stopped.value = reason
        socketUp.value = false
        cancelReopen()
      })
    )
    net.connect()
  })

  onBeforeUnmount(() => {
    unmounted = true
    cancelReopen()
    for (const off of offs) off()
    for (const off of lockstepOffs) off()
    offs.length = 0
    lockstepOffs = []
    net?.discardHeld()
    net?.close()
    net = null
    // the world as left, so the next visit downloads only what changed meanwhile
    const last = lockstep.value
    const have = last && !forgotten ? last.offerParts() : []
    if (last && have.length > 0) void rtCacheParts(worldId, have.map(hash => last.heldParts.get(hash)!))
    lockstep.value = null
  })

  return {
    lockstep,
    tick,
    status,
    everOpened,
    opening,
    resyncing,
    stopped,
    role,
    companyId,
    owner,
    invite,
    paused,
    closed,
    canCommand,
    sendCommand,
    send,
    pollSocket
  }
}
