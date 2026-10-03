import { AUTO_ENGAGE_RETRY_SECONDS } from '#shared/utils/hero-quest/constants'

/**
 * Fires the boss for you while the tab is visible.
 *
 * The decision is `shouldAutoEngage`, which is pure and specced; this is only the wiring — a
 * `visibilitychange` listener, a clock counting how long the projection has held the gate, and
 * the one call. Everything it needs is handed in, so the page keeps owning the request.
 *
 * ## Rejections are expected, and silent
 *
 * `boss/engage.post.ts` settles and then re-checks the position under its lock, so an engage the
 * client sent a beat early comes back 400 "The run is not at a boss gate". That is the client
 * having run ahead of the server, not a failure the player did anything about, so it is swallowed
 * and retried rather than toasted. `AUTO_ENGAGE_GRACE_KILLS` is what makes it rare; this is what
 * makes it harmless when it happens anyway.
 *
 * Any *other* error is left to the caller's own handling — a 401 or a 500 is a real problem and
 * should surface.
 */
export function useHqAutoBoss(input: {
    atBossGate: () => boolean
    runCleared: () => boolean
    /** This gate's boss beat the party last time: it waits on the challenge button. */
    lostHere: () => boolean
    secondsPerKill: () => number | null
    engaging: () => boolean
    replayOpen: () => boolean
    engage: () => Promise<void>
}) {
    /**
     * SSR has no `document`, and a server render must not decide anything anyway. Starting at
     * `false` means the first client frame matches the server's, and the listener below corrects
     * it on mount.
     */
    const documentVisible = ref(false)
    const secondsAtGate = ref(0)
    const retryInSeconds = ref(0)

    let ticker: ReturnType<typeof setInterval> | null = null
    let firing = false

    function readVisibility() {
        documentVisible.value = document.visibilityState === 'visible'
    }

    /**
     * Reset the moment the run leaves the gate, so the grace is measured from *this* arrival.
     * Without it a run that reached a gate, lost, farmed back and reached it again would engage
     * instantly on the second arrival, which is the case the grace exists for.
     */
    watch(() => input.atBossGate(), (atGate) => {
        if (!atGate) {
            secondsAtGate.value = 0
            retryInSeconds.value = 0
        }
    })

    async function tick() {
        secondsAtGate.value += input.atBossGate() ? 1 : 0
        retryInSeconds.value = Math.max(0, retryInSeconds.value - 1)

        // `firing` and not just `engaging()`: the caller's flag is set inside the awaited call,
        // one microtask after this returns, which is a window a 1s ticker can land in twice.
        if (firing) return
        if (!shouldAutoEngage({
            atBossGate: input.atBossGate(),
            documentVisible: documentVisible.value,
            runCleared: input.runCleared(),
            lostHere: input.lostHere(),
            engaging: input.engaging(),
            replayOpen: input.replayOpen(),
            secondsAtGate: secondsAtGate.value,
            secondsPerKill: input.secondsPerKill(),
            retryInSeconds: retryInSeconds.value
        })) return

        firing = true
        try {
            await input.engage()
        } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            if (error?.statusCode === 400 || error?.data?.statusCode === 400) {
                // Ran ahead of the server. Wait for it to catch up and go again.
                retryInSeconds.value = AUTO_ENGAGE_RETRY_SECONDS
            } else {
                throw error
            }
        } finally {
            firing = false
        }
    }

    onMounted(() => {
        readVisibility()
        document.addEventListener('visibilitychange', readVisibility)
        ticker = setInterval(() => { void tick() }, 1000)
    })

    onUnmounted(() => {
        document.removeEventListener('visibilitychange', readVisibility)
        if (ticker) clearInterval(ticker)
    })

    return { documentVisible, secondsAtGate }
}
