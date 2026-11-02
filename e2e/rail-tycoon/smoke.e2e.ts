/**
 * Three players launch with separate profiles, each signs in as its own account,
 * all three reach the same world and report the same hash, and close() leaves no Chrome behind.
 */
import { RtBrowserHarness } from './harness.ts'

export default async function smoke(): Promise<void> {
    const harness = new RtBrowserHarness()
    try {
        const [host, ...guests] = await harness.launchPlayers(3)
        const name = `Smoke ${Date.now().toString(36)}`
        const worldId = await harness.createWorld(host!, name, { side: 64, maxCompanies: 4 })
        const link = await harness.copyInvite(host!, name)
        // copyInvite went back to the chooser; the host returns to the world
        await harness.continueWorld(host!, name)
        for (const guest of guests) {
            const joined = await harness.followInvite(guest, link)
            if (joined !== worldId) throw new Error(`player ${guest.n} joined ${joined}, expected ${worldId}`)
        }

        const companies = new Set<number | null>()
        for (const player of harness.players) {
            const state = await harness.state(player)
            if (state?.worldId !== worldId) throw new Error(`player ${player.n} is not in ${worldId}`)
            companies.add(state.company)
        }
        if (companies.size !== 3 || companies.has(null)) throw new Error(`expected three companies, got ${[...companies].join(', ')}`)

        const same = await harness.waitForSameHash(harness.players, 60000)
        console.log(`same hash ${same.hash} at tick ${same.tick} for players ${harness.players.map(p => p.n).join(', ')}`)
        for (const player of harness.players) await harness.screenshot(player, 'smoke')
        for (const entry of harness.problems()) {
            if (entry.consoleErrors.length || entry.failedRequests.length) console.log(`player ${entry.player}:`, entry)
        }
    } finally {
        await harness.close()
    }
    const leftover = harness.leftoverPids()
    if (leftover.length) throw new Error(`Chrome still running after close(): ${leftover.join(', ')}`)
}
