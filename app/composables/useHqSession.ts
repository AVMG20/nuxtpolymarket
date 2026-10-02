/**
 * Whether the player is in a Hero Quest session, or should be shown the splash first.
 *
 * Presentation only. Every gap is settled by the server on its own rules (offline past
 * `ONLINE_THRESHOLD_MS`) whatever this says; the session decides only what the screen shows. Its
 * one effect on the game is to stop the presence poll while the splash waits, so a tab left on
 * it is away, as it should be.
 *
 * A session ends when a read closes a gap longer than `HQ_SESSION_TIMEOUT_MS`: a reload after a
 * long break, or a laptop waking from sleep mid-session. There is no session without a run. The
 * decision is made as each read arrives, in `useHeroQuest`, so the server render and the client
 * agree on it.
 *
 * Shared across every tab through `useState`, so moving between tabs never asks again.
 */
export const useHqSession = () => {
    /** `null` until the first read decides it. */
    const active = useState<boolean | null>('hq-session-active', () => null)
    const resuming = useState('hq-session-resuming', () => false)

    const { state, refresh, initialized, initRun } = useHeroQuest()
    const { fetchSession } = useAuth()

    type Report = NonNullable<NonNullable<typeof state.value>['settled']>
    /** What the read that ended the session banked, held for the splash: a later read replaces `settled`. */
    const report = useState<Report | null>('hq-session-away', () => null)
    /** Only a gap worth reporting: an offline settle that landed kills. */
    const away = computed(() => report.value && !report.value.online && report.value.kills > 0 ? report.value : null)

    /** What the screen shows: the game, the splash's Start, or its Begin when there is no run. */
    const gate = computed<'loading' | 'begin' | 'start' | 'open'>(() => {
        if (!state.value) return 'loading'
        if (!initialized.value) return 'begin'
        return active.value ? 'open' : 'start'
    })

    async function start() {
        resuming.value = true
        active.value = true
        await refresh()
        // the read settled the gap: Gold may have moved
        await fetchSession()
    }

    async function begin() {
        await initRun()
        active.value = true
    }

    return { gate, away, start, begin }
}
