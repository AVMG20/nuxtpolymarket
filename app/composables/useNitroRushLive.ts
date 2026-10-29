import { LiveGhosts, poseMessage, type LivePoseMsg } from '~/utils/nitro-rush/live'
import type { CarPose, GhostSource, Phase } from '~/utils/nitro-rush/types'

/** What this needs from the engine: a place to hand ghosts to, and the local car. */
export interface LiveEngine {
    addGhostSource: (src: GhostSource) => () => void
    carPose: (out?: CarPose) => CarPose
}

interface LiveOptions {
    engine: () => LiveEngine | null
    trackId: Ref<string>
    phase: Ref<Phase>
    paused: Ref<boolean>
    paint: Ref<string>
}

/** About 10 poses a second while driving. */
const SEND_MS = 100
const MAX_BACKOFF_MS = 30_000
/** Signed out, or refused for being at a cap: retrying wouldn't help until the next course. */
const FINAL_CLOSE = new Set([4401, 4429])

/**
 * Live ghosts: other players on the same course, drawn as ghost cars with a
 * name tag. Connects while the game is mounted on a course, joins that course's
 * room, and sends the car's pose about 10 times a second while on the clock
 * (countdown and racing; never in the menu, paused or with the tab hidden).
 * `racers` is how many others are driving the course right now.
 */
export function useNitroRushLive(opts: LiveOptions) {
    const ghosts = new LiveGhosts()
    const racers = ref(0)
    const pose: CarPose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }

    let ws: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let tick: ReturnType<typeof setInterval> | null = null
    let retries = 0
    let unmounted = false
    /** The room is full: send nothing until the course changes. */
    let full = false
    let unregister: (() => void) | null = null

    const source: GhostSource = now => ghosts.frames(now)

    function send(msg: object) {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    }

    function join() {
        if (opts.trackId.value) send({ t: 'join', track: opts.trackId.value })
    }

    function onMessage(data: unknown) {
        let msg: { t?: string, id?: unknown, track?: unknown } & Partial<LivePoseMsg>
        try {
            msg = JSON.parse(String(data))
        } catch {
            return
        }
        if (msg.t === 'pose' && typeof msg.id === 'string' && msg.pose && typeof msg.at === 'number') {
            ghosts.push(msg as LivePoseMsg, performance.now())
        } else if (msg.t === 'gone' && typeof msg.id === 'string') {
            ghosts.remove(msg.id)
        } else if (msg.t === 'full' && msg.track === opts.trackId.value) {
            full = true
        }
    }

    function connect() {
        if (unmounted || ws || !opts.trackId.value) return
        if (retryTimer) clearTimeout(retryTimer)
        retryTimer = null
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        const socket = ws = new WebSocket(`${proto}://${location.host}/api/nitro-rush/ws`)
        socket.onopen = () => {
            retries = 0
            join()
        }
        socket.onmessage = e => onMessage(e.data)
        socket.onclose = (e) => {
            if (ws !== socket) return
            ws = null
            ghosts.clear()
            if (unmounted || FINAL_CLOSE.has(e.code)) return
            // Back off, so a server refusing everybody isn't hammered by every open tab.
            retries++
            retryTimer = setTimeout(connect, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (retries - 1)) + Math.random() * 500)
        }
    }

    function driving() {
        const p = opts.phase.value
        return (p === 'countdown' || p === 'racing') && !opts.paused.value && document.visibilityState === 'visible'
    }

    function onTick() {
        const engine = opts.engine()
        if (engine && !full && driving()) send(poseMessage(engine.carPose(pose), opts.paint.value, performance.now()))
        ghosts.prune(performance.now())
        if (racers.value !== ghosts.count) racers.value = ghosts.count
    }

    /** A new course: fresh ghosts, a fresh source on the engine, and that course's room. */
    function onTrack() {
        unregister?.()
        unregister = null
        ghosts.clear()
        racers.value = 0
        full = false
        if (!opts.trackId.value) return
        unregister = opts.engine()?.addGhostSource(source) ?? null
        if (ws) join()
        else connect()
    }

    // The engine is built in the game's onMounted, which then sets the track, so this fires once it exists.
    watch(opts.trackId, onTrack)

    onMounted(() => {
        tick = setInterval(onTick, SEND_MS)
        if (opts.trackId.value) onTrack()
    })

    onBeforeUnmount(() => {
        unmounted = true
        if (tick) clearInterval(tick)
        if (retryTimer) clearTimeout(retryTimer)
        unregister?.()
        unregister = null
        const socket = ws
        ws = null
        socket?.close()
        ghosts.clear()
    })

    return { racers }
}
