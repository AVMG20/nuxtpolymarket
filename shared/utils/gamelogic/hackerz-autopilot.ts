/**
 * Auto-play for HACKERZ: the questions Laya (the local decision model, see
 * `laya_server.py`, at `runtimeConfig.public.layaUrl`) is asked, and how its
 * answers are read. Laya makes
 * the calls a player makes — which hostile to shoot, when to fire an ability,
 * what to buy at the uplink — and the game carries them out. Nothing here
 * decides anything itself.
 *
 * Questions are short and each carries its own state: Laya answers short
 * states faster and better than one long shared one.
 */

export interface HackerzLayaQuestion {
    type: 'noul' | 'choice'
    instructions: string
    criteria?: Record<string, string>
    state: string
}

export interface HackerzLayaAnswer {
    type?: string
    noul?: number
    choice?: string
    probabilities?: Record<string, number>
}

/** A hostile Laya may pick to shoot, keyed for its answer. */
export interface HackerzAutopilotContact {
    key: string
    name: string
    boss: boolean
    /** A hacker working a node right now. */
    hacking: boolean
    /** A hacker on its way to a node. */
    hacker: boolean
    /** Field units from the wall. */
    d: number
    /** Health left, 0-1. */
    health: number
    /** Armour-plated: kinetic rounds deal +25%, energy rounds +25% against the unplated. */
    plated: boolean
}

/** A gun the run owns, as Laya is told it when choosing what to fire. */
export interface HackerzAutopilotGun {
    id: string
    name: string
    /** The shop's two or three words: "crowds", "chains", "pierce"… */
    tag: string
    damageType: 'kinetic' | 'energy'
    dps: number
    /** Hits several hostiles at once: arcs that chain, splash, or a spread of pellets. */
    multi: boolean
}

/** The board as Laya is told it, mid-wave. */
export interface HackerzAutopilotView {
    wave: number
    /** Wall integrity, 0-1. */
    wall: number
    /** Nodes the hackers hold, out of `nodes`. */
    held: number
    nodes: number
    /** The hostiles worth choosing between, most pressing first. */
    contacts: HackerzAutopilotContact[]
    /** Hostiles within striking range of the wall. */
    near: number
    /** Hostiles that cannot be locked on: in the dark or cloaked. */
    hidden: number
    total: number
    pulseReady: boolean
    pingReady: boolean
    overclockReady: boolean
}

export interface HackerzAutopilotDecision {
    /** The contact to lock and shoot, or null when Laya named none. */
    target: string | null
    pulse: boolean
    ping: boolean
    overclock: boolean
}

/** Laya says yes to an ability above this. */
const YES = 0.5

function percent(share: number) {
    return `${Math.round(share * 100)}%`
}

function contactWords(contact: HackerzAutopilotContact) {
    const what = contact.boss ? `BOSS ${contact.name}` : contact.name
    const doing = contact.hacking ? ' hacking a node' : contact.hacker ? ' heading for a node' : ''
    return `${what}${doing}, ${Math.round(contact.d)} units from the wall, ${percent(contact.health)} health`
}

function boardWords(view: HackerzAutopilotView) {
    return `Wave ${view.wave}. Wall at ${percent(view.wall)}. Hackers hold ${view.held} of ${view.nodes} nodes.`
}

/** The calls to make this moment of a wave: whom to shoot, and any ability that is ready. */
export function hackerzLayaFightQuestions(view: HackerzAutopilotView): Record<string, HackerzLayaQuestion> {
    const questions: Record<string, HackerzLayaQuestion> = {}
    if (view.contacts.length > 1) {
        questions.target = {
            type: 'choice',
            instructions: 'Which hostile should the gun shoot now to keep the wall standing and stop the hackers?',
            criteria: Object.fromEntries(view.contacts.map(contact => [contact.key, contactWords(contact)])),
            state: boardWords(view)
        }
    }
    if (view.pulseReady && (view.held > 0 || view.near > 0)) {
        questions.pulse = {
            type: 'noul',
            instructions: 'Should the ICE pulse be fired now? It shoves back everything near the wall and washes the hacked nodes nearest the wall back to ours.',
            state: `${view.near} hostiles near the wall. Hackers hold ${view.held} of ${view.nodes} nodes. Wall at ${percent(view.wall)}.`
        }
    }
    // Asked as "should I ping?", Laya answered a coin flip (0.26-0.56) whatever
    // the count; asked whether the hidden ones are a threat the ping is needed
    // for, it answers steadily (~0.9). So it is asked that way.
    if (view.pingReady && view.hidden > 0) {
        questions.ping = {
            type: 'noul',
            instructions: 'Are hidden hostiles a threat the guns cannot shoot until the radar ping reveals them?',
            state: `${view.hidden} of ${view.total} hostiles are hidden in the dark or cloaked, and the guns cannot lock on to them.`
        }
    }
    if (view.overclockReady && view.total > 0) {
        questions.overclock = {
            type: 'noul',
            instructions: 'Should overclock be fired now for a short burst of extra fire rate?',
            state: `${view.total} hostiles on the field, ${view.near} near the wall. Wall at ${percent(view.wall)}.`
        }
    }
    return questions
}

/**
 * The gun for the moment, by matchup, or null to keep the one in hand.
 *
 * This one is not asked of Laya. Probed on 2026-10-16 it could not judge gun
 * matchups however it was asked: as a choice it picked the Packet Rail in
 * nearly every situation (and whichever gun the state said was in hand); as a
 * yes/no per gun it rated the Tesla Coil 0.87 for a lone plated tank and 0.07
 * for a packed swarm. So the rule is plain: a gun's dps, +25% when its damage
 * type suits the target (kinetic on plating, energy on the rest), doubled when
 * it hits several at once and the field is crowded. A swap costs a moment's
 * reload, so only a clearly better gun is swapped to.
 */
export function hackerzGunForMatchup(view: HackerzAutopilotView, focus: HackerzAutopilotContact, guns: HackerzAutopilotGun[], current: string) {
    if (guns.length < 2) return null
    const crowded = view.near >= CROWD_NEAR || view.total >= CROWD_TOTAL
    const score = (gun: HackerzAutopilotGun) => gun.dps
        * ((gun.damageType === 'kinetic') === focus.plated ? 1.25 : 1)
        * (gun.multi && crowded ? 2 : 1)
    const inHand = guns.find(gun => gun.id === current)
    const best = guns.reduce((top, gun) => score(gun) > score(top) ? gun : top)
    if (best.id === current) return null
    return !inHand || score(best) >= score(inHand) * GUN_SWAP_GAIN ? best.id : null
}

/** A crowd: this many hostiles near the wall, or this many on the field. */
const CROWD_NEAR = 6
const CROWD_TOTAL = 12
/** A gun must score this much better than the one in hand to be swapped to. */
const GUN_SWAP_GAIN = 1.15

/** Reads Laya's answers to the fight questions. A lone contact is the target without asking. */
export function hackerzLayaFightDecision(view: HackerzAutopilotView, answers: Record<string, HackerzLayaAnswer | undefined>): HackerzAutopilotDecision {
    const named = answers.target?.choice
    const target = view.contacts.length === 1
        ? view.contacts[0]!.key
        : view.contacts.some(contact => contact.key === named) ? named! : null
    return {
        target,
        pulse: (answers.pulse?.noul ?? 0) > YES,
        ping: (answers.ping?.noul ?? 0) > YES,
        overclock: (answers.overclock?.noul ?? 0) > YES
    }
}

/** A deployable in stock, as Laya is told it when deciding whether to use one. */
export interface HackerzAutopilotDeployable {
    id: string
    name: string
    description: string
    /** Goes off where it stands (Portscan, Cosmic Blip) instead of being placed on a pack. */
    instant: boolean
    count: number
}

/** What a deployable would be used on right now. */
export interface HackerzAutopilotDeployView {
    /** The densest pack of ground hostiles, if any. */
    pack: { size: number, d: number } | null
    held: number
    nodes: number
    hidden: number
    wall: number
}

/**
 * When a deployable is worth spending. Laya says yes to nearly any deployable
 * in nearly any state (0.74-0.97 in a probe on 2026-10-16, whether twelve
 * hostiles were at the wall or three were far off), so these gates are what
 * stop auto-play spending the lot on the first stray pair: a placed one on a
 * real pack closing on the wall, a Portscan on several hidden hostiles, a
 * Cosmic Blip once more than one node has fallen.
 */
const DEPLOY_PACK = 5
const DEPLOY_PACK_D = 600
const DEPLOY_HIDDEN = 3
const DEPLOY_HELD = 2

/**
 * Whether to use each deployable in stock, asked only where one would do
 * real work (see the gates above).
 */
export function hackerzLayaDeployQuestions(view: HackerzAutopilotDeployView, stock: HackerzAutopilotDeployable[]): Record<string, HackerzLayaQuestion> {
    const questions: Record<string, HackerzLayaQuestion> = {}
    const situation = `${view.pack ? `${view.pack.size} hostiles packed together ${Math.round(view.pack.d)} units from the wall` : 'No pack of hostiles'}. `
        + `Hackers hold ${view.held} of ${view.nodes} nodes. ${view.hidden} hostiles hidden. Wall at ${percent(view.wall)}.`
    for (const item of stock) {
        if (item.count <= 0) continue
        const useful = item.id === 'portscan'
            ? view.hidden >= DEPLOY_HIDDEN
            : item.id === 'blip'
                ? view.held >= DEPLOY_HELD
                : !!view.pack && view.pack.size >= DEPLOY_PACK && view.pack.d <= DEPLOY_PACK_D
        if (!useful) continue
        questions[`deploy_${item.id}`] = {
            type: 'noul',
            instructions: `Should a ${item.name} be used now? ${item.description}`,
            state: `${situation} ${item.count} ${item.name}${item.count === 1 ? '' : 's'} in stock.`
        }
    }
    return questions
}

/** The deployable Laya is surest of, above even odds, or null to keep them all. */
export function hackerzLayaDeployPick(answers: Record<string, HackerzLayaAnswer | undefined>) {
    let best: string | null = null
    let bestYes = YES
    for (const [key, answer] of Object.entries(answers)) {
        if (!key.startsWith('deploy_')) continue
        const yes = answer?.noul ?? 0
        if (yes > bestYes) {
            best = key.slice('deploy_'.length)
            bestYes = yes
        }
    }
    return best
}

/** A bonus round the uplink is offering. */
export interface HackerzAutopilotBonus {
    name: string
    tagline: string
    /** Wall integrity under which the round fails on the spot, 0-1. */
    failBelow: number
    /** What passing multiplies the round's credits by. */
    multiplier: number
    seconds: number
}

/**
 * Below this much wall a bonus round is not even put to Laya: one bad
 * moment fails it, so the run's credits are better spent on repairs.
 */
const BONUS_WALL = 0.6

/**
 * Whether to take the bonus round on offer, or null to skip it without asking.
 *
 * Asked "should it be played?", Laya said no to every bonus (0.18-0.47)
 * whatever the wall. Asked whether the wall is strong enough to hold through
 * it, it answers yes and less so as the wall weakens, rating PACKET LOSS (the
 * one that makes rounds miss) lowest. So it is asked that way.
 */
export function hackerzLayaBonusQuestion(bonus: HackerzAutopilotBonus, wall: number, nextWave: number): HackerzLayaQuestion | null {
    if (wall < BONUS_WALL) return null
    return {
        type: 'noul',
        instructions: `Is the wall strong enough to hold through the ${bonus.name} bonus round? ${bonus.tagline} `
            + `It lasts ${bonus.seconds} seconds and fails if the wall drops below ${percent(bonus.failBelow)}.`,
        state: `Wall at ${percent(wall)}. It pays ${bonus.multiplier}x credits if it holds. Next wave is ${nextWave}.`
    }
}

/** Laya takes the bonus round above even odds. */
export function hackerzLayaBonusPick(answers: Record<string, HackerzLayaAnswer | undefined>) {
    return (answers.bonus?.noul ?? 0) > YES
}

/** Something the uplink would sell right now, keyed for Laya's answer. */
export interface HackerzAutopilotOffer {
    key: string
    text: string
}

/** The run as it stands at the uplink. */
export interface HackerzAutopilotShopView {
    nextWave: number
    wall: number
    credits: number
    gun: string
    mounts: number
    filled: number
    held: number
    nodes: number
}

/**
 * One purchase at the uplink. There is deliberately no "save the credits"
 * option: Laya leans toward it whatever the facts, and a run that buys nothing
 * is lost. The shop asks again after each purchase until nothing is affordable.
 */
export function hackerzLayaShopQuestions(view: HackerzAutopilotShopView, offers: HackerzAutopilotOffer[]): Record<string, HackerzLayaQuestion> {
    return {
        buy: {
            type: 'choice',
            instructions: 'Which purchase best keeps the wall standing and the nodes ours through the next waves?',
            criteria: Object.fromEntries(offers.map(offer => [offer.key, offer.text])),
            state: `Next is wave ${view.nextWave}. Wall at ${percent(view.wall)}. Credits: ${Math.round(view.credits)}. `
                + `Gun: ${view.gun}. Turrets on ${view.filled} of ${view.mounts} mounts. Hackers hold ${view.held} of ${view.nodes} nodes.`
        }
    }
}

/** Laya's purchase, or null if it named none of the offers. */
export function hackerzLayaShopPick(offers: HackerzAutopilotOffer[], answers: Record<string, HackerzLayaAnswer | undefined>) {
    const choice = answers.buy?.choice
    return offers.find(offer => offer.key === choice) ?? null
}
