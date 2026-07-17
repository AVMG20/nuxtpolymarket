// scripts/slot-rtp.ts
//
// Monte-Carlo RTP tester for the connection/cluster slot games. Replaces the
// separate aethergates-rtp.ts / bookofshadows-rtp.ts / bos-fast-rtp.ts /
// candymadness-rtp.ts / fireinthehole-rtp.ts / xenoslot-rtp.ts scripts, which
// were ~90% identical boilerplate: accumulate cost/payout, bucket the payout
// distribution, track top wins. The only real per-game variation is which
// play function to call, how its feature-buy options are shaped, and (for
// Book of Shadows / Fire in the Hole) one extra game-specific breakdown.
//
// Run:  bun run scripts/slot-rtp.ts <game> [rounds] [feature] [--fast]
//
//   game     aethergates | bookofshadows | candymadness | fireinthehole | xenoslot
//   rounds   number of rounds to simulate (defaults per game, see PROFILES)
//   feature  a feature-buy token valid for that game (see PROFILES), omit for base spins
//   --fast   swap crypto.getRandomValues for Math.random before importing the
//            game module (the trick bos-fast-rtp.ts was built around), keeping
//            the real production play function. Measured: ~2.7x under
//            `tsx`, but no gain at all under bun, whose getRandomValues is
//            already fast — so under bun this is effectively a no-op and not
//            worth reaching for. Never use it to sign off an RTP number:
//            Math.random is not the entropy production runs on.
//
// spinata-rtp.ts stays separate on purpose: unlike the five games here it
// doesn't call a play*() function at all — it reimplements the reel/cascade
// logic by hand against Math.random for speed, and reports a different set of
// figures (per-mode contribution breakdown, dual normal+buy report). That's
// not a parameter of this runner's shape, it's a different tool.
//
// Imports the *real* game logic so the measured RTP matches production exactly.

interface RtpProfile {
    modulePath: string
    playExport: string
    maxWinExport: string
    defaultBet: number
    defaultRounds: number
    features: Record<string, Record<string, unknown>>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extra?: (mod: any) => ExtraTracker
}

interface ExtraTracker {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    collect(result: any): void
    report(bonusTriggers: number): void
}

const pct = (n: number) => (100 * n).toFixed(4) + '%'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bosExtra(mod: any): ExtraTracker {
    const tierCounts = new Map<string, number>(mod.BONUS_TIERS.map((t: { id: string }) => [t.id, 0]))
    let lockedColumnsSum = 0
    let fullClears = 0
    let retriggers = 0

    return {
        collect(r) {
            if (!r.bonus) return
            tierCounts.set(r.bonus.tier.id, (tierCounts.get(r.bonus.tier.id) ?? 0) + 1)
            lockedColumnsSum += r.bonus.lockedColumnsFinal.length
            if (r.bonus.lockedColumnsFinal.length >= 5) fullClears++
            if (r.bonus.retriggered) retriggers++
        },
        report(bonusTriggers) {
            if (!bonusTriggers) return
            console.log(`\navg columns locked at bonus end: ${(lockedColumnsSum / bonusTriggers).toFixed(2)} / 5`)
            console.log(`full clears (all 5 cols):        ${fullClears}  (${pct(fullClears / bonusTriggers)} of bonuses)`)
            console.log(`book retriggers (+spins):        ${retriggers}  (${pct(retriggers / bonusTriggers)} of bonuses)`)

            const totalWeight = mod.BONUS_TIERS.reduce((s: number, t: { weight: number }) => s + t.weight, 0)
            console.log('\nbonus-symbol roll distribution (measured vs theoretical):')
            for (const t of mod.BONUS_TIERS) {
                const count = tierCounts.get(t.id) ?? 0
                const measured = count / bonusTriggers
                const theory = t.weight / totalWeight
                console.log(`  ${t.label.padEnd(7)} ×${String(t.multiplier).padEnd(4)} ${pct(measured).padStart(9)}   theory ${pct(theory).padStart(9)}`)
            }
        }
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fithExtra(mod: any): ExtraTracker {
    const rowsAtBonus = new Map<number, { count: number, payoutSum: number }>()
    for (let rows = mod.FITH_STARTING_LINES; rows <= mod.FITH_MAX_LINES; rows++) rowsAtBonus.set(rows, { count: 0, payoutSum: 0 })

    return {
        collect(r) {
            if (!r.bonus) return
            const tier = rowsAtBonus.get(r.bonus.activeLines)
            if (tier) { tier.count++; tier.payoutSum += r.bonus.payout }
        },
        report(bonusTriggers) {
            if (!bonusTriggers) return
            console.log('\nbonus triggers by rows unlocked (activeLines when free spins started):')
            for (const [rows, t] of rowsAtBonus) {
                const share = t.count / bonusTriggers
                const avgPayout = t.count ? t.payoutSum / t.count : 0
                console.log(`  rows ${rows}: ${String(t.count).padEnd(8)} (${pct(share).padStart(9)})   avg payout ${avgPayout.toFixed(2)}x`)
            }
        }
    }
}

const PROFILES: Record<string, RtpProfile> = {
    aethergates: {
        modulePath: '../shared/utils/gamelogic/aethergates',
        playExport: 'playAetherGates',
        maxWinExport: 'AG_MAX_WIN_MULT',
        defaultBet: 1,
        defaultRounds: 1_000_000,
        features: {
            buyFreeSpins: { feature: 'buyFreeSpins' },
            superBonus: { feature: 'superBonus' },
            bonusChance: { feature: 'bonusChance' }
        }
    },
    bookofshadows: {
        modulePath: '../shared/utils/gamelogic/bookofshadows',
        playExport: 'playBookOfShadows',
        maxWinExport: 'BOS_MAX_WIN_MULT',
        defaultBet: 1,
        defaultRounds: 2_000_000,
        features: { buyBonus: { buyBonus: true } },
        extra: bosExtra
    },
    candymadness: {
        modulePath: '../shared/utils/gamelogic/candymadness',
        playExport: 'playCandyMadness',
        maxWinExport: 'CM_MAX_WIN_MULT',
        defaultBet: 1,
        defaultRounds: 2_000_000,
        features: {
            buyFreeSpins: { feature: 'buyFreeSpins' },
            bonusHunt: { feature: 'bonusHunt' }
        }
    },
    fireinthehole: {
        modulePath: '../shared/utils/gamelogic/fireinthehole',
        playExport: 'playFireInTheHole',
        maxWinExport: 'FITH_MAX_WIN_MULT',
        defaultBet: 1,
        defaultRounds: 2_000_000,
        features: { buyBonus: { buyBonus: true } },
        extra: fithExtra
    },
    xenoslot: {
        modulePath: '../shared/utils/gamelogic/xenoslot',
        playExport: 'playXenoSlot',
        maxWinExport: 'XENOSLOT_MAX_WIN_MULT',
        defaultBet: 1,
        defaultRounds: 2_000_000,
        features: { buyBonus: { buyBonus: true } }
    }
}

function usageAndExit(message?: string): never {
    if (message) console.error(`${message}\n`)
    console.error('Usage: bun run scripts/slot-rtp.ts <game> [rounds] [feature] [--fast]\n')
    console.error(`  game: ${Object.keys(PROFILES).join(' | ')}`)
    for (const [key, profile] of Object.entries(PROFILES)) {
        const tokens = Object.keys(profile.features)
        console.error(`    ${key.padEnd(14)} feature: ${tokens.length ? tokens.join(', ') : '(none)'}`)
    }
    process.exit(1)
}

const rawArgs = process.argv.slice(2)
const fast = rawArgs.includes('--fast')
const positional = rawArgs.filter(a => a !== '--fast')

const gameKey = positional[0]
const profile = gameKey ? PROFILES[gameKey] : undefined
if (!profile) usageAndExit(gameKey ? `Unknown game "${gameKey}"` : undefined)

const rounds = Number(positional[1] ?? profile.defaultRounds)
if (!Number.isFinite(rounds) || rounds <= 0) usageAndExit(`Invalid rounds "${positional[1]}"`)

const featureToken = positional[2]
if (featureToken && !profile.features[featureToken]) {
    usageAndExit(`Unknown feature "${featureToken}" for ${gameKey}`)
}

// Same trick bos-fast-rtp.ts used, generalised: patch the entropy source
// before importing so every game (not just Book of Shadows) can opt into a
// fast tuning run through the exact same production play function.
if (fast) {
    Object.defineProperty(globalThis.crypto, 'getRandomValues', {
        configurable: true,
        writable: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        value: (arr: any) => {
            for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 0x1_0000_0000) >>> 0
            return arr
        }
    })
}

const mod = await import(profile.modulePath)
const play = mod[profile.playExport] as (bet: number, options?: Record<string, unknown>) => Record<string, number | boolean | object | null>
const bet = profile.defaultBet
const options = featureToken ? profile.features[featureToken] : undefined
const maxWin = bet * mod[profile.maxWinExport]
const extra = profile.extra?.(mod)

const BUCKETS = [0, 0.5, 1, 2, 5, 10, 50, 100, 500, 1000, 5000, Infinity]
const bucketCounts = new Array(BUCKETS.length).fill(0)

let totalCost = 0
let totalPayout = 0
let basePayoutSum = 0
let bonusPayoutSum = 0
let bonusTriggers = 0
let wins = 0
let capHits = 0

let lastBonusRound = -1
let gapSum = 0
let gapCount = 0

interface TopWin { round: number, payout: number, mult: number, bonus: boolean }
const TOP_N = 20
const topWins: TopWin[] = []
function pushTop(rec: TopWin) {
    if (topWins.length < TOP_N) {
        topWins.push(rec)
        topWins.sort((a, b) => b.mult - a.mult)
        return
    }
    if (rec.mult > topWins[topWins.length - 1]!.mult) {
        topWins[topWins.length - 1] = rec
        topWins.sort((a, b) => b.mult - a.mult)
    }
}

for (let i = 0; i < rounds; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = play(bet, options) as any
    // Book of Shadows only sets `cost` on a feature buy, and Fire in the Hole
    // has no `bonusTriggered` at all — it signals the bonus by `bonus` alone.
    const cost = r.cost ?? bet
    const bonusTriggered = r.bonusTriggered ?? Boolean(r.bonus)

    totalCost += cost
    totalPayout += r.payout
    basePayoutSum += r.basePayout
    bonusPayoutSum += r.payout - r.basePayout
    if (r.payout > cost) wins++
    if (r.payout >= maxWin) capHits++

    if (bonusTriggered) {
        bonusTriggers++
        if (lastBonusRound >= 0) { gapSum += i - lastBonusRound; gapCount++ }
        lastBonusRound = i
    }

    extra?.collect(r)

    const m = r.payout / bet
    for (let b = 0; b < BUCKETS.length; b++) {
        if (m <= BUCKETS[b]!) { bucketCounts[b]++; break }
    }
    pushTop({ round: i, payout: r.payout, mult: m, bonus: bonusTriggered })
}

console.log(`game:               ${gameKey}`)
console.log(`rounds:             ${rounds.toLocaleString()}${featureToken ? `  (feature: ${featureToken})` : ''}${fast ? '  [--fast entropy]' : ''}`)
console.log(`total RTP:          ${pct(totalPayout / totalCost)}`)
console.log(`  base RTP:         ${pct(basePayoutSum / totalCost)}`)
console.log(`  bonus RTP:        ${pct(bonusPayoutSum / totalCost)}`)
console.log(`bonus trigger:      ${pct(bonusTriggers / rounds)}  (1 in ${bonusTriggers ? (rounds / bonusTriggers).toFixed(0) : '—'})`)
console.log(`avg spins to bonus: ${gapCount ? (gapSum / gapCount).toFixed(2) : '—'}  (n=${gapCount} gaps observed)`)
console.log(`hit freq (>cost):   ${pct(wins / rounds)}`)
console.log(`max-win hits:       ${capHits}  (1 in ${capHits ? (rounds / capHits).toFixed(0) : '—'})`)

console.log('\npayout distribution (× bet):')
for (let b = 0; b < BUCKETS.length; b++) {
    const lo = b === 0 ? 0 : BUCKETS[b - 1]!
    const hi = BUCKETS[b]!
    const label = hi === Infinity ? `>${lo}` : `${lo}–${hi}`
    console.log(`  ${label.padEnd(12)} ${pct(bucketCounts[b] / rounds)}`)
}

console.log(`\ntop ${topWins.length} wins (× bet):`)
for (const w of topWins) {
    console.log(`  ${w.mult.toFixed(2).padStart(10)}x   round ${String(w.round).padEnd(9)} ${w.bonus ? 'bonus' : 'base game'}`)
}

extra?.report(bonusTriggers)
