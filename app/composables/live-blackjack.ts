import type {
    LbAction,
    LbBetSpot,
    LbClientMessage,
    LbServerMessage,
    LbTableState
} from '#shared/utils/live-blackjack/types'

export interface LbFeedItem {
    id: number
    kind: 'sit' | 'leave' | 'shuffle' | 'settled' | 'chat' | 'error' | 'action' | 'watch' | 'sideBet'
    text: string
    tone: 'neutral' | 'win' | 'loss'
    name?: string
}

const ACTION_VERB: Record<string, string> = {
    hit: 'hits',
    stand: 'stands',
    double: 'doubles down',
    split: 'splits',
    surrender: 'surrenders'
}

const FEED_LIMIT = 40

/**
 * Socket bridge to the live table. Everything the client shows comes from
 * server snapshots — nothing about the round is decided here.
 */
export function useLiveBlackjack() {
    const { balanceNum, setBalance } = useAuth()

    const state = ref<LbTableState | null>(null)
    // Bumped per action so the renderer can stamp it on the seat; the id makes
    // two identical actions in a row still register as two separate events.
    const actionPulse = ref<{ id: number, seat: number, action: LbAction } | null>(null)
    const sideBetPulse = ref<{ id: number, seat: number, label: string, payout: number } | null>(null)
    const youId = ref<string | null>(null)
    const balance = ref(balanceNum.value)
    const connected = ref(false)
    const feed = ref<LbFeedItem[]>([])
    const lastError = ref('')

    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let unmounted = false
    let feedSeq = 0

    const mySeat = computed(() =>
        state.value?.seats.find(s => s?.userId === youId.value) ?? null)

    const myHand = computed(() => {
        const seat = mySeat.value
        const table = state.value
        if (!seat || !table || table.activeSeat !== seat.index || table.activeHand === null) return null
        return seat.hands[table.activeHand] ?? null
    })

    const isMyTurn = computed(() => state.value?.phase === 'playing' && !!myHand.value)

    // Every stake and payout comes back over this socket, so it is also what
    // keeps the balance in the site header current.
    function applyBalance(value: number) {
        balance.value = value
        void setBalance(value)
    }

    function pushFeed(item: Omit<LbFeedItem, 'id'>) {
        feed.value.push({ ...item, id: ++feedSeq })
        if (feed.value.length > FEED_LIMIT) feed.value.splice(0, feed.value.length - FEED_LIMIT)
    }

    function handle(message: LbServerMessage) {
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
                if (message.kind === 'shuffle') {
                    pushFeed({ kind: 'shuffle', text: 'Shoe shuffled — count resets', tone: 'neutral' })
                } else if (message.kind === 'sit') {
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
                } else if (message.kind === 'action') {
                    actionPulse.value = { id: ++feedSeq, seat: message.seat, action: message.action }
                    pushFeed({
                        kind: 'action',
                        text: `${message.name} ${ACTION_VERB[message.action] ?? message.action}`,
                        tone: 'neutral',
                        name: message.name
                    })
                } else if (message.kind === 'chat') {
                    pushFeed({ kind: 'chat', text: message.text, tone: 'neutral', name: message.name })
                } else if (message.kind === 'sideBet') {
                    sideBetPulse.value = { id: ++feedSeq, seat: message.seat, label: message.label, payout: message.payout }
                    pushFeed({
                        kind: 'sideBet',
                        name: message.name,
                        tone: 'win',
                        text: `${message.name} hit ${message.label} for ${formatNumber(message.payout)}`
                    })
                } else if (message.kind === 'settled' && message.net !== 0) {
                    const seat = state.value?.seats[message.seat]
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
        ws = new WebSocket(`${proto}://${location.host}/api/live-blackjack/ws`)
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
            if (!unmounted) reconnectTimer = setTimeout(connect, 2500)
        }
    }

    function send(message: LbClientMessage) {
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
        actionPulse,
        sideBetPulse,
        youId,
        balance,
        connected,
        feed,
        lastError,
        mySeat,
        myHand,
        isMyTurn,
        sit: (seat: number) => send({ t: 'sit', seat }),
        leave: () => send({ t: 'leave' }),
        bet: (amount: number, spot: LbBetSpot = 'main') => send({ t: 'bet', amount, spot }),
        undoBet: () => send({ t: 'undoBet' }),
        clearBet: () => send({ t: 'clearBet' }),
        repeatBet: () => send({ t: 'repeatBet' }),
        voteStart: () => send({ t: 'voteStart' }),
        act: (action: LbAction) => send({ t: 'action', action }),
        insurance: (take: boolean) => send({ t: 'insurance', take }),
        chat: (text: string) => send({ t: 'chat', text })
    }
}
