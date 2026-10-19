import { HACKERZ_DEPLOYABLES, type HackerzDeployableId } from '#shared/utils/gamelogic/hackerz'
import {
    hackerzGunForMatchup,
    hackerzLayaBonusPick,
    hackerzLayaBonusQuestion,
    hackerzLayaDeployPick,
    hackerzLayaDeployQuestions,
    hackerzLayaFightDecision,
    hackerzLayaFightQuestions,
    hackerzLayaShopPick,
    hackerzLayaShopQuestions,
    type HackerzAutopilotBonus,
    type HackerzAutopilotGun,
    type HackerzAutopilotOffer,
    type HackerzAutopilotShopView,
    type HackerzLayaAnswer,
    type HackerzLayaQuestion
} from '#shared/utils/gamelogic/hackerz-autopilot'
import type { HackerzGame } from './hackerz-engine/hackerz-game'
import type { EnemyEntity } from './hackerz-engine/types'

// Auto-play for HACKERZ, played by Laya on this machine: `laya_server.py`, the
// same local Laya API Shapezz and Pirate Raid auto-play use (`runtimeConfig.public.layaUrl`). A few times a second mid-wave the board is described to
// Laya and it names the hostile to shoot and any ability to fire; this class
// carries that out through the engine. Between waves it asks Laya what to buy,
// one purchase at a time. Laya makes the calls, except the two it was shown
// not to manage (the gun for the target, and when a deployable is worth
// asking about), and the plain cases: a lone target is shot, nothing lockable
// is fired at blind. While Laya is down the rail holds fire and the uplink waits.

export interface HackerzAutopilotStatus {
    /** The last question reached Laya. */
    online: boolean
    /** What auto-play is doing, for the HUD. */
    line: string
}

/** At most four questions a second, and never two at once. */
const ASK_INTERVAL_MS = 250
const LAYA_TIMEOUT_MS = 1500
const OFFLINE_RETRY_MS = 1500
/** A gun swap costs a moment's reload, so which gun to hold is asked at most this often. */
const GUN_ASK_MS = 3000
/** At most one deployable this often, so a wave's stock is not spent in one go. */
const DEPLOY_ASK_MS = 4000

/** The run's guns, which only the uplink knows: the ones owned, the one in hand, and how to swap. */
export interface HackerzAutopilotGear {
    guns: () => HackerzAutopilotGun[]
    current: () => string
    swap: (id: string) => void
}

async function askLaya(url: string, questions: Record<string, HackerzLayaQuestion>, timeoutMs = LAYA_TIMEOUT_MS) {
    const res = await fetch(`${url}/v1/systemone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
        signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) return null
    const data = await res.json() as { answers?: Record<string, HackerzLayaAnswer> }
    return data.answers ?? null
}

export class HackerzAutopilot {
    private stopped = true
    /** Bumped on stop, so an answer to a question from before a restart is dropped. */
    private generation = 0
    private inFlight = false
    private timer: ReturnType<typeof setInterval> | null = null
    private retryAt = 0
    private target: EnemyEntity | null = null
    private status: HackerzAutopilotStatus = { online: false, line: 'Waiting for Laya' }

    constructor(
        private game: HackerzGame,
        /** Root of the local Laya API, e.g. http://127.0.0.1:8000. */
        private layaUrl: string,
        private onStatus: (status: HackerzAutopilotStatus) => void,
        private gear?: HackerzAutopilotGear
    ) {}

    private gunAskedAt = -Infinity
    private deployAskedAt = -Infinity

    start() {
        if (!this.stopped) return
        this.stopped = false
        this.timer = setInterval(() => this.tick(), ASK_INTERVAL_MS)
        this.onStatus(this.status)
    }

    stop() {
        this.stopped = true
        this.generation += 1
        this.inFlight = false
        if (this.timer) clearInterval(this.timer)
        this.timer = null
        this.target = null
        this.game.autopilotAim(null)
    }

    private setStatus(patch: Partial<HackerzAutopilotStatus>) {
        const next = { ...this.status, ...patch }
        if (next.online === this.status.online && next.line === this.status.line) return
        this.status = next
        this.onStatus(next)
    }

    /** Mid-wave: keep the rail on its target, and ask Laya again when it is free to. */
    private tick() {
        if (this.stopped || !this.game.isRunning) return
        // A target that died or left the board is let go at once, not at the next answer.
        if (this.target && (this.target.hp <= 0)) {
            this.target = null
            this.game.autopilotAim(null)
        }
        if (this.inFlight || performance.now() < this.retryAt) return
        const { view, contacts } = this.game.autopilotView()
        const questions = hackerzLayaFightQuestions(view)
        // Now and then: the right gun for what is being shot (or the most
        // pressing hostile), by matchup — see `hackerzGunForMatchup` for why not Laya.
        const gear = this.gear
        if (gear && view.contacts.length && performance.now() - this.gunAskedAt >= GUN_ASK_MS) {
            this.gunAskedAt = performance.now()
            const focusKey = [...contacts].find(([, enemy]) => enemy === this.target)?.[0] ?? view.contacts[0]!.key
            const focus = view.contacts.find(contact => contact.key === focusKey)!
            const swapTo = hackerzGunForMatchup(view, focus, gear.guns(), gear.current())
            if (swapTo) {
                gear.swap(swapTo)
                this.setStatus({ line: `Swapping to ${gear.guns().find(gun => gun.id === swapTo)?.name ?? swapTo} for the ${focus.name}` })
            }
        }
        // Now and then: whether to spend a deployable from the stock.
        if (performance.now() - this.deployAskedAt >= DEPLOY_ASK_MS) {
            const { stock, pack, held } = this.game.autopilotStock()
            const items = HACKERZ_DEPLOYABLES.map(def => ({ id: def.id, name: def.name, description: def.description, instant: !!def.instant, count: stock[def.id] ?? 0 }))
            const deploy = hackerzLayaDeployQuestions({ pack, held, nodes: view.nodes, hidden: view.hidden, wall: view.wall }, items)
            if (Object.keys(deploy).length) {
                this.deployAskedAt = performance.now()
                Object.assign(questions, deploy)
            }
        }
        if (!Object.keys(questions).length) {
            this.target = contacts.get('e0') ?? null
            if (this.target) this.game.autopilotAim(this.target)
            else this.fireBlind()
            return
        }
        this.inFlight = true
        const generation = this.generation
        askLaya(this.layaUrl, questions)
            .then((answers) => {
                if (generation !== this.generation) return
                this.inFlight = false
                if (!answers) {
                    this.offline()
                    return
                }
                const decision = hackerzLayaFightDecision(view, answers)
                this.target = decision.target ? contacts.get(decision.target) ?? null : null
                // Nothing to lock on at all: spray the dark instead.
                const blind = !this.target && !view.contacts.length && this.fireBlind()
                if (!blind) this.game.autopilotAim(this.target)
                const fired: string[] = []
                const deployId = hackerzLayaDeployPick(answers) as HackerzDeployableId | null
                if (deployId && this.game.autopilotDeploy(deployId)) {
                    fired.push(HACKERZ_DEPLOYABLES.find(def => def.id === deployId)?.name ?? deployId)
                }
                const abilities = [['pulse', 'ICE pulse'], ['ping', 'ping'], ['overclock', 'overclock']] as const
                for (const [id, name] of abilities) {
                    if (!decision[id]) continue
                    this.game.autopilotAbility(id)
                    fired.push(name)
                }
                const shot = decision.target ? view.contacts.find(c => c.key === decision.target) : null
                this.setStatus({
                    online: true,
                    line: fired.length ? `Laya: ${fired.join(' + ')}` : shot ? `Laya: shooting ${shot.name}${shot.hacking ? ' (hacking)' : ''}` : 'Laya: holding fire'
                })
            })
            .catch(() => {
                if (generation !== this.generation) return
                this.inFlight = false
                this.offline()
            })
    }

    /** With nothing to lock on, fire blind into the densest pack hidden in the dark. True when firing. */
    private fireBlind() {
        if (!this.game.autopilotBlindFire()) {
            this.game.autopilotAim(null)
            return false
        }
        this.setStatus({ line: 'Laya: firing blind into the dark' })
        return true
    }

    private offline() {
        this.retryAt = performance.now() + OFFLINE_RETRY_MS
        this.game.autopilotAim(null)
        this.setStatus({ online: false, line: 'Laya offline: start laya_server.py' })
    }

    /**
     * At the uplink: Laya's next purchase among `offers`. `online` is false
     * when Laya could not be asked (the shop waits and asks again); `pick` is
     * null when it answered without naming an offer (the shop is done). A
     * single offer is bought without asking: with no choice to make there is
     * nothing to ask, and the model cannot take a one-option question.
     */
    async pickPurchase(view: HackerzAutopilotShopView, offers: HackerzAutopilotOffer[]): Promise<{ online: boolean, pick: HackerzAutopilotOffer | null }> {
        if (!offers.length) return { online: true, pick: null }
        if (offers.length === 1) {
            this.setStatus({ online: true, line: `Laya: buying ${offers[0]!.text}` })
            return { online: true, pick: offers[0]! }
        }
        let answers: Record<string, HackerzLayaAnswer> | null = null
        try {
            answers = await askLaya(this.layaUrl, hackerzLayaShopQuestions(view, offers), 3000)
        } catch {
            answers = null
        }
        if (!answers) {
            this.setStatus({ online: false, line: 'Laya offline: start laya_server.py' })
            return { online: false, pick: null }
        }
        const pick = hackerzLayaShopPick(offers, answers)
        this.setStatus({ online: true, line: pick ? `Laya: buying ${pick.text}` : 'Laya: done shopping' })
        return { online: true, pick }
    }

    /**
     * At the uplink with a bonus round on offer: whether Laya takes it. Null
     * when Laya could not be asked (the uplink waits and asks again).
     */
    async decideBonus(bonus: HackerzAutopilotBonus, wall: number, nextWave: number): Promise<boolean | null> {
        const question = hackerzLayaBonusQuestion(bonus, wall, nextWave)
        if (!question) {
            this.setStatus({ online: true, line: `Laya: skipping ${bonus.name}, the wall is too weak` })
            return false
        }
        let answers: Record<string, HackerzLayaAnswer> | null = null
        try {
            answers = await askLaya(this.layaUrl, { bonus: question }, 3000)
        } catch {
            answers = null
        }
        if (!answers) {
            this.setStatus({ online: false, line: 'Laya offline: start laya_server.py' })
            return null
        }
        const take = hackerzLayaBonusPick(answers)
        this.setStatus({ online: true, line: take ? `Laya: taking the ${bonus.name} bonus round` : `Laya: skipping ${bonus.name}` })
        return take
    }

    /** Shown while auto-play waits between steps. */
    say(line: string) {
        this.setStatus({ line })
    }
}
