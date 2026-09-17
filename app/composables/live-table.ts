import type {
    LtClientMessage,
    LtServerMessage,
    LtTableState
} from '#shared/utils/live-table/types'

export interface LtFeedItem {
    id: number
    kind: 'sit' | 'leave' | 'settled' | 'chat' | 'error' | 'watch' | 'game'
    text: string
    tone: 'neutral' | 'win' | 'loss'
    name?: string
}

const FEED_LIMIT = 40
const CHAT_LIMIT = 60
const RECONNECT_MS = 2500

/**
 * Socket bridge shared by every table game. Everything the client shows comes
 * from server snapshots — nothing about a round is decided here.
 *
 * `onGameEvent` receives the game's own one-shot events so a page can drive
 * animation off them without this composable knowing any game's rules.
 */
export function useLiveTable<TSeat, TShared, TAction>(
    game: string,
    onGameEvent?: (payload: unknown) => void
) {
    const { balanceNum, setBalance } = useAuth()

    const state = ref<LtTableState<TSeat, TShared> | null>(null) as Ref<LtTableState<TSeat, TShared> | null>
    const youId = ref<string | null>(null)
    const balance = ref(balanceNum.value)
    const connected = ref(false)
    const feed = ref<LtFeedItem[]>([])
    const chat = ref<LtFeedItem[]>([])
    const lastError = ref('')

    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let unmounted = false
    let seq = 0

    const mySeat = computed(() => state.value?.seats.find(s => s?.userId === youId.value) ?? null)
    const seated = computed(() => !!mySeat.value)

    /**
     * The server stamps its own clock on every snapshot, so a client whose
     * clock is off still counts down against the right deadline.
     */
    const skew = computed(() => (state.value ? state.value.now - Date.now() : 0))

    // Every stake and payout comes back over this socket, so it is also what
    // keeps the balance in the site header current.
    function applyBalance(value: number) {
        balance.value = value
        void setBalance(value)
    }

    function push(target: Ref<LtFeedItem[]>, limit: number, item: Omit<LtFeedItem, 'id'>) {
        target.value.push({ ...item, id: ++seq })
        if (target.value.length > limit) target.value.splice(0, target.value.length - limit)
    }

    function pushFeed(item: Omit<LtFeedItem, 'id'>) {
        push(feed, FEED_LIMIT, item)
    }

    function handle(message: LtServerMessage<TSeat, TShared>) {
        switch (message.t) {
            case 'state':
                state.value = message.state
                return
            case 'you':
                youId.value = message.userId
                applyBalance(message.balance)
                return
            case 'balance':
                applyBalance(message.balance)
                return
            case 'error':
                lastError.value = message.message
                pushFeed({ kind: 'error', text: message.message, tone: 'loss' })
                return
            case 'event':
                if (message.kind === 'sit') {
                    pushFeed({ kind: 'sit', text: `${message.name} sat down`, tone: 'neutral', name: message.name })
                } else if (message.kind === 'leave') {
                    pushFeed({ kind: 'leave', text: `${message.name} left the table`, tone: 'neutral', name: message.name })
                } else if (message.kind === 'watch') {
                    pushFeed({
                        kind: 'watch',
                        text: `${message.name} ${message.joined ? 'is watching' : 'stopped watching'}`,
                        tone: 'neutral',
                        name: message.name
                    })
                } else if (message.kind === 'chat') {
                    push(chat, CHAT_LIMIT, { kind: 'chat', text: message.text, tone: 'neutral', name: message.name })
                } else if (message.kind === 'game') {
                    onGameEvent?.(message.payload)
                } else if (message.kind === 'settled' && message.net !== 0) {
                    const seat = state.value?.seats.find(s => s?.index === message.seat)
                    pushFeed({
                        kind: 'settled',
                        name: seat?.name,
                        tone: message.net > 0 ? 'win' : 'loss',
                        text: `${seat?.name ?? 'Player'} ${message.net > 0 ? 'won' : 'lost'} ${formatNumber(Math.abs(message.net))}`
                    })
                }
        }
    }

    function connect() {
        if (unmounted || ws) return
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        ws = new WebSocket(`${proto}://${location.host}/api/${game}/ws`)
        ws.onopen = () => {
            connected.value = true
        }
        ws.onmessage = (event) => {
            try {
                handle(JSON.parse(event.data))
            } catch { /* malformed frames are not worth tearing the table down for */ }
        }
        ws.onclose = () => {
            ws = null
            connected.value = false
            if (!unmounted) reconnectTimer = setTimeout(connect, RECONNECT_MS)
        }
    }

    function send(message: LtClientMessage<TAction>) {
        if (ws?.readyState !== WebSocket.OPEN) return
        ws.send(JSON.stringify(message))
    }

    onMounted(connect)
    onBeforeUnmount(() => {
        unmounted = true
        if (reconnectTimer) clearTimeout(reconnectTimer)
        ws?.close()
        ws = null
    })

    return {
        state,
        youId,
        balance,
        connected,
        feed,
        chat,
        lastError,
        mySeat,
        seated,
        skew,
        sit: (seat: number) => send({ t: 'sit', seat }),
        leave: () => send({ t: 'leave' }),
        voteStart: () => send({ t: 'voteStart' }),
        chatSend: (text: string) => send({ t: 'chat', text }),
        act: (action: TAction) => send({ t: 'action', action })
    }
}
