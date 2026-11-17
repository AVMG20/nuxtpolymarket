// Dead Front salvage pacing: the scrap a player can expect by each round, solo
// and in a squad of four, next to what the workbench charges. An expected-value
// model (no sim, no rolls), so a number change shows up at once:
//
//   bun scripts/dead-front-salvage.ts
//
// It prints the numbers before the 2026-11-17 rebalance (kept below as a
// snapshot) and the live ones from shared/utils/dead-front/{salvage,rarity}.ts.
//
// What to look for: a solo player who puts most of their scrap into one weapon
// makes it Rare around round 4, Epic around round 8 and Legendary around round
// 13, and still has scrap for a sentry or a barrage every round or two. A
// squad of four should land within a round of that.
import { DF_ENEMIES, dfBrutesInRound, dfRoundZombieCount, dfSpecialChances } from '../shared/utils/dead-front/enemies'
import { DF_RARITY_UPGRADE } from '../shared/utils/dead-front/rarity'
import { DF_CHALLENGE_REWARD, DF_RECIPES, DF_SALVAGE, dfChallengeReward, dfRoundPayout, dfSalvageFade, dfSalvageSquad } from '../shared/utils/dead-front/salvage'

/** Share of the drops a player walks over before they rust away. */
const PICKUP = 0.9
/** Share of the round challenges a squad meets. */
const CHALLENGES_MET = 0.6
/** Share of the scrap that goes into the weapon in hand (the rest buys gear and support). */
const WEAPON_SHARE = 0.65
const ROUNDS = 20

type Range = readonly [number, number]

interface Model {
    name: string
    chance: number
    amount: Range
    ghoulMult: number
    brute: Range
    /** A brute's pile lands for every player (else for its killer, scaled by the squad). */
    bruteForAll: boolean
    bloater: { chance: number, scrap: Range }
    /** The drop chances' share on a round. */
    fade(round: number): number
    /** How much richer a squad's drops are. */
    squad(players: number): number
    /** Scrap a met challenge pays each player. */
    challenge(round: number): number
    /** First round a challenge is dealt. */
    challengeFrom: number
    /** Scrap every player gets for surviving the round. */
    roundPay(round: number): number
    upgrades: readonly number[]
    recipes: Record<string, number>
}

const mean = (r: Range) => (r[0] + r[1]) / 2

/** The numbers before the rebalance (commit e7f713b4). */
const BEFORE: Model = {
    name: 'before',
    chance: 0.22,
    amount: [1, 3],
    ghoulMult: 1.25,
    brute: [6, 10],
    bruteForAll: false,
    bloater: { chance: 0.5, scrap: [3, 5] },
    fade: r => (r <= 10 ? 1 : Math.sqrt(10 / r)),
    squad: n => 1 + 0.33 * (n - 1),
    challenge: r => Math.min(20, 4 + r),
    challengeFrom: 3,
    roundPay: () => 0,
    upgrades: [120, 330, 650],
    recipes: { sentry: 40, decoy: 30, kit: 650, barrage: 75, zeppelin: 200, launcher: 100, bomber: 350 }
}

const AFTER: Model = {
    name: 'after',
    chance: DF_SALVAGE.chance,
    amount: DF_SALVAGE.amount,
    ghoulMult: DF_SALVAGE.ghoulMult,
    brute: DF_SALVAGE.brute.scrap,
    bruteForAll: true,
    bloater: DF_SALVAGE.bloater,
    fade: dfSalvageFade,
    squad: dfSalvageSquad,
    challenge: r => dfChallengeReward(r).scrap,
    challengeFrom: 3,
    roundPay: dfRoundPayout,
    upgrades: DF_RARITY_UPGRADE.map(u => u.scrap),
    recipes: Object.fromEntries(Object.values(DF_RECIPES).map(r => [r.id, r.scrap]))
}

interface Line {
    round: number
    kills: number
    drops: number
    earned: number
    total: number
    tiers: number
    gear: number
}

/** Expected scrap for one player of a squad of `players`, round by round. */
function pace(m: Model, players: number): Line[] {
    const out: Line[] = []
    let total = 0
    for (let round = 1; round <= ROUNDS; round++) {
        const horde = dfRoundZombieCount(round, players)
        const brutes = dfBrutesInRound(round)
        const sp = dfSpecialChances(round)
        const k = m.fade(round) * m.squad(players)
        const regular = (horde - brutes) / players
        const shambler = Math.min(1, m.chance * k) * mean(m.amount)
        const ghoul = Math.min(1, m.chance * m.ghoulMult * k) * mean(m.amount)
        const bloater = Math.min(1, m.bloater.chance * k) * mean(m.bloater.scrap)
        const perKill = (1 - sp.ghoul - sp.bloater) * shambler + sp.ghoul * ghoul + sp.bloater * bloater
        const brutePile = m.bruteForAll ? brutes * mean(m.brute) : brutes * mean(m.brute) * m.squad(players) / players
        const drops = (regular * perKill + brutePile) * PICKUP
        const challenge = round >= m.challengeFrom ? CHALLENGES_MET * m.challenge(round) : 0
        const earned = drops + challenge + m.roundPay(round)
        total += earned
        // the weapon's share buys tiers in order; the rest is for gear
        let left = total * WEAPON_SHARE
        let tiers = 0
        for (const cost of m.upgrades) {
            if (left < cost) break
            left -= cost
            tiers++
        }
        out.push({ round, kills: horde / players, drops, earned, total, tiers, gear: total * (1 - WEAPON_SHARE) })
    }
    return out
}

const pad = (s: string | number, n: number) => String(s).padStart(n)
const TIER = ['-', 'Rare', 'Epic', 'Legendary']

function table(m: Model): void {
    const solo = pace(m, 1)
    const squad = pace(m, 4)
    console.log(`\n${m.name.toUpperCase()}: upgrades ${m.upgrades.join(' / ')} scrap · sentry ${m.recipes.sentry} · barrage ${m.recipes.barrage} · bomber ${m.recipes.bomber} · field kit ${m.recipes.kit}`)
    console.log('        ┌──────────── solo ─────────────┐   ┌──── squad of 4, per player ───┐')
    console.log('round   kills  round   total  weapon      kills  round   total  weapon')
    for (let i = 0; i < ROUNDS; i++) {
        const a = solo[i]!
        const b = squad[i]!
        console.log(`${pad(a.round, 5)}   ${pad(a.kills.toFixed(0), 5)}  ${pad(a.earned.toFixed(0), 5)}  ${pad(a.total.toFixed(0), 6)}  ${TIER[a.tiers]!.padEnd(9)}   ${pad(b.kills.toFixed(0), 5)}  ${pad(b.earned.toFixed(0), 5)}  ${pad(b.total.toFixed(0), 6)}  ${TIER[b.tiers]}`)
    }
    const reach = (lines: Line[]) => [1, 2, 3].map(t => lines.find(l => l.tiers >= t)?.round ?? `>${ROUNDS}`).join(' / ')
    const gearAt = (lines: Line[], r: number) => `${(lines[r - 1]!.gear / m.recipes.sentry!).toFixed(1)} sentries`
    console.log(`Rare / Epic / Legendary on round: solo ${reach(solo)} · squad ${reach(squad)}`)
    console.log(`Scrap left for gear by round 10: solo ${solo[9]!.gear.toFixed(0)} (${gearAt(solo, 10)}) · squad ${squad[9]!.gear.toFixed(0)}; by round 15: solo ${solo[14]!.gear.toFixed(0)} · squad ${squad[14]!.gear.toFixed(0)}`)
}

console.log(`Dead Front salvage pacing (expected values). Assumes ${PICKUP * 100}% of drops picked up, ${CHALLENGES_MET * 100}% of challenges met,`)
console.log(`${WEAPON_SHARE * 100}% of scrap put into one weapon. Brutes from round ${DF_ENEMIES.brute.minRound}; challenge reward caps at ${DF_CHALLENGE_REWARD.maxScrap}.`)
table(BEFORE)
table(AFTER)
