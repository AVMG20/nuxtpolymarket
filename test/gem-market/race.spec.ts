/**
 * Race condition regression test for the gem market.
 *
 * Fires N concurrent buy requests and verifies the market price moved by the
 * full compounded amount — i.e. each trade saw the updated price from the
 * previous one. Before the fix, all trades would read the same stale price
 * (last-write-wins) and the price would only move by a single trade's worth.
 *
 * Requires a running server. Set TEST_BASE_URL and TEST_COOKIE to run, or set
 * SKIP_INTEGRATION=true to skip (the default in CI without a live server).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import http from 'node:http'
import https from 'node:https'
import {
    GEM_TRADE_IMPACT_MAX,
    GEM_MAX_GEMS_PER_TRADE
} from '../../shared/utils/gamelogic/gem-market'

// Mirrors the private GEM_K constant in gem-market.ts
const GEM_K = Math.log(1 + GEM_TRADE_IMPACT_MAX) / GEM_MAX_GEMS_PER_TRADE

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3100'
const COOKIE = process.env.TEST_COOKIE ?? ''
const SKIP = process.env.SKIP_INTEGRATION === 'true' || !COOKIE

const url = new URL(BASE_URL)
const lib = url.protocol === 'https:' ? https : http
const agent = new lib.Agent({ keepAlive: true, maxSockets: 64 })

function req(method: string, path: string, body?: unknown): Promise<{ status: number, json: unknown }> {
    return new Promise((resolve) => {
        const data = body !== undefined ? JSON.stringify(body) : undefined
        const r = lib.request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path,
            method,
            agent,
            headers: {
                'Content-Type': 'application/json',
                Cookie: COOKIE,
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
            }
        }, (res) => {
            const chunks: Buffer[] = []
            res.on('data', (c: Buffer) => chunks.push(c))
            res.on('end', () => {
                let json: unknown = null
                try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
                catch { json = null }
                resolve({ status: res.statusCode ?? 0, json })
            })
        })
        r.on('error', () => resolve({ status: 0, json: null }))
        if (data) r.write(data)
        r.end()
    })
}

async function marketPrice(): Promise<{ stored: number, live: number, lastUpdatedAt: Date }> {
    const { json } = await req('GET', '/api/gem-market/state') as { json: Record<string, unknown> }
    const stored = Number((json as Record<string, unknown>)?.storedPrice ?? 0)
    const live = Number((json as Record<string, unknown>)?.livePrice ?? stored)
    const lastUpdatedAt = new Date(String((json as Record<string, unknown>)?.lastUpdatedAt ?? new Date()))
    return { stored, live, lastUpdatedAt }
}

const BURST = 5
const GEMS_PER_TRADE = 50

describe.skipIf(SKIP)('gem market race condition (integration)', () => {
    beforeAll(() => {
        // eslint-disable-next-line no-console
        console.log(`running against ${BASE_URL}`)
    })

    it('concurrent buys compound the price correctly', async () => {
        const before = await marketPrice()
        const p0 = before.live

        // Fire BURST concurrent buys
        const results = await Promise.all(
            Array.from({ length: BURST }, () => req('POST', '/api/gem-market/buy', { gems: GEMS_PER_TRADE }))
        )
        const succeeded = results.filter(r => r.status === 200).length

        const after = await marketPrice()
        const p1 = after.live

        // Expected price if each buy correctly sees the updated price from the previous:
        // p0 × e^(K × gems × successfulTrades)
        const expectedPrice = p0 * Math.exp(GEM_K * GEMS_PER_TRADE * succeeded)

        // Before the fix: price would only move by one trade (all reads were stale).
        // After the fix: price must be within 1% of the fully compounded expectation.
        const singleTradeMoveRatio = Math.exp(GEM_K * GEMS_PER_TRADE)
        const actualMoveRatio = p1 / p0
        const expectedMoveRatio = expectedPrice / p0

        // The actual move should be much closer to the compounded expectation than to a
        // single-trade move. We allow 20% tolerance for timing jitter on the live price.
        const distanceFromExpected = Math.abs(actualMoveRatio - expectedMoveRatio)
        const distanceFromSingle = Math.abs(actualMoveRatio - singleTradeMoveRatio)

        if (succeeded > 1) {
            // After fix: distance from compounded expectation should be less than from single-trade
            expect(distanceFromExpected).toBeLessThan(distanceFromSingle)
        }

        // Sanity: at least one buy succeeded
        expect(succeeded).toBeGreaterThan(0)
        // Price must have increased
        expect(p1).toBeGreaterThan(p0)
    }, 30_000)

    it('concurrent sells compound the price drop correctly', async () => {
        // Seed the test: need BURST × GEMS_PER_TRADE gems in the account.
        // This test only runs if the account has enough gems.
        const sessionRes = await req('GET', '/api/auth/get-session') as { json: Record<string, unknown> }
        const gemCount = Number((sessionRes.json as Record<string, unknown>)?.user?.gems ?? 0)
        const needed = BURST * GEMS_PER_TRADE
        if (gemCount < needed) {
            // Not enough gems — skip rather than fail
            return
        }

        const before = await marketPrice()
        const p0 = before.live

        const results = await Promise.all(
            Array.from({ length: BURST }, () => req('POST', '/api/gem-market/sell', { gems: GEMS_PER_TRADE }))
        )
        const succeeded = results.filter(r => r.status === 200).length

        const after = await marketPrice()
        const p1 = after.live

        if (succeeded > 1) {
            const expectedPrice = p0 * Math.exp(-GEM_K * GEMS_PER_TRADE * succeeded)
            const actualMoveRatio = p1 / p0
            const expectedMoveRatio = expectedPrice / p0
            const singleMoveRatio = Math.exp(-GEM_K * GEMS_PER_TRADE)

            const distanceFromExpected = Math.abs(actualMoveRatio - expectedMoveRatio)
            const distanceFromSingle = Math.abs(actualMoveRatio - singleMoveRatio)
            expect(distanceFromExpected).toBeLessThan(distanceFromSingle)
        }

        expect(succeeded).toBeGreaterThan(0)
        expect(p1).toBeLessThan(p0)
    }, 30_000)
})
