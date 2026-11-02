/**
 * Rail Tycoon browser harness: several headless Google Chrome players, each in its own
 * profile directory and logged in as its own local test account, driving the real game.
 *
 * Every player is a playwright-core persistent context on the installed Chrome (RT_E2E_CHROME
 * overrides the path) with its own user-data-dir under the scratch directory, so cookies never
 * mix. Player N opens http://pN.localhost:3010 by default (RT_E2E_URL, with {n} for the player
 * number), the server under test, never the main dev server. A player signs up through the site's
 * register page as rt-e2e-N on first use and signs in after that.
 *
 * The map is driven in tile coordinates through window.__railTycoon (the game view's read-only
 * test hook): tileToScreen gives where to press. Hash checks sample (tick, hash) in the page at
 * fixed tick multiples, so players running a few frames apart still compare the same tick.
 *
 * close() closes every context it opened and then kills, by PID, any Chrome still running on one
 * of its own profile directories, and nothing else.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright-core'

/** What the game view puts on window.__railTycoon (app/utils/rail-tycoon/windows.ts, RtDebugHook). */
export interface RtHookState {
    ready: boolean
    worldId: string
    tick: number | null
    hash: number | null
    company: number | null
    role: 'player' | 'spectator' | null
}

export interface RtPlayer {
    /** 1-based player number. */
    readonly n: number
    readonly name: string
    readonly email: string
    readonly password: string
    /** This player's site origin, e.g. http://p2.localhost:3010. */
    readonly baseUrl: string
    readonly profileDir: string
    readonly context: BrowserContext
    readonly page: Page
    /** console.error lines and uncaught page errors, in order. */
    readonly consoleErrors: string[]
    /** Requests that failed outright or answered 400 and up. */
    readonly failedRequests: string[]
}

export interface RtHarnessOptions {
    /** Root for profiles and screenshots; ${XDG_CONFIG_HOME:-~/.config}/tsch-ai-skills/tmp by default. */
    scratchDir?: string
    /** Chrome binary; RT_E2E_CHROME, then the default macOS install. */
    chrome?: string
    /** CSS viewport of every player. */
    viewport?: { width: number, height: number }
    /** Password of every rt-e2e account; RT_E2E_PASSWORD by default. */
    password?: string
    /** false shows the windows, for debugging by hand. */
    headless?: boolean
}

export interface RtCreateWorldOptions {
    side?: 64 | 128 | 256
    maxCompanies?: number
    sharing?: boolean
}

const DEFAULT_URL = 'http://p{n}.localhost:3010'
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const LINUX_CHROME = '/usr/bin/google-chrome'
/** Ticks between the (tick, hash) samples each page records. */
const HASH_SAMPLE_EVERY = 25

function scratchRoot(): string {
    return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'tsch-ai-skills', 'tmp')
}

function sleep(ms: number): Promise<void> {
    return new Promise(done => setTimeout(done, ms))
}

export class RtBrowserHarness {
    readonly players: RtPlayer[] = []
    readonly scratchDir: string
    readonly profilesDir: string
    readonly shotsDir: string
    private readonly chrome: string
    private readonly viewport: { width: number, height: number }
    private readonly password: string
    private readonly headless: boolean
    private readonly launchedProfiles = new Set<string>()

    constructor(options: RtHarnessOptions = {}) {
        this.scratchDir = options.scratchDir ?? scratchRoot()
        this.profilesDir = join(this.scratchDir, 'rail-tycoon-profiles')
        this.shotsDir = join(this.scratchDir, 'rail-tycoon-shots')
        this.chrome = options.chrome ?? process.env.RT_E2E_CHROME ?? (existsSync(MAC_CHROME) ? MAC_CHROME : LINUX_CHROME)
        this.viewport = options.viewport ?? { width: 1280, height: 800 }
        this.password = options.password ?? process.env.RT_E2E_PASSWORD ?? 'rt-e2e-local-only'
        this.headless = options.headless ?? true
    }

    /** The site origin of player n: baseUrl with {n} replaced, or baseUrl itself without one. */
    static urlFor(baseUrl: string, n: number): string {
        return baseUrl.replaceAll('{n}', String(n)).replace(/\/+$/, '')
    }

    // ─── Launch and sign-in ──────────────────────────────────────────────

    /** Starts n players (numbered after any already running) and signs each in. */
    async launchPlayers(n: number, baseUrl = process.env.RT_E2E_URL ?? DEFAULT_URL): Promise<RtPlayer[]> {
        if (!existsSync(this.chrome)) throw new Error(`Chrome not found at ${this.chrome}; set RT_E2E_CHROME`)
        mkdirSync(this.profilesDir, { recursive: true })
        const started: RtPlayer[] = []
        const first = this.players.length + 1
        for (let i = first; i < first + n; i++) {
            const player = await this.launchOne(i, RtBrowserHarness.urlFor(baseUrl, i))
            this.players.push(player)
            started.push(player)
        }
        await Promise.all(started.map(player => this.signIn(player)))
        return started
    }

    private async launchOne(n: number, baseUrl: string): Promise<RtPlayer> {
        const profileDir = join(this.profilesDir, `player-${n}`)
        mkdirSync(profileDir, { recursive: true })
        this.launchedProfiles.add(profileDir)
        // a Chrome killed mid-run leaves its singleton lock behind; nothing of ours runs on it now
        if (this.chromePids(profileDir).length === 0) {
            for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) rmSync(join(profileDir, name), { force: true })
        }
        const context = await chromium.launchPersistentContext(profileDir, {
            executablePath: this.chrome,
            headless: this.headless,
            viewport: this.viewport,
            deviceScaleFactor: 1,
            // WebGL in headless Chrome without a GPU
            args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check']
        })
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl })
        const page = context.pages()[0] ?? await context.newPage()
        const player: RtPlayer = {
            n,
            name: `rt-e2e-${n}`,
            email: `rt-e2e-${n}@example.com`,
            password: this.password,
            baseUrl,
            profileDir,
            context,
            page,
            consoleErrors: [],
            failedRequests: []
        }
        page.on('console', (msg) => {
            if (msg.type() === 'error') player.consoleErrors.push(msg.text())
        })
        page.on('pageerror', error => player.consoleErrors.push(`pageerror: ${error.message}`))
        page.on('requestfailed', request => player.failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'failed'}`))
        page.on('response', (response) => {
            if (response.status() >= 400) player.failedRequests.push(`${response.request().method()} ${response.url()} ${response.status()}`)
        })
        return player
    }

    /** Signs in as rt-e2e-N, registering the account the first time. Ends on the Rail Tycoon page. */
    async signIn(player: RtPlayer): Promise<void> {
        const { page } = player
        await page.goto(`${player.baseUrl}/rail-tycoon`)
        // the SPA's auth middleware sends a signed-out player to /login client side
        await page.waitForFunction(() => location.pathname.startsWith('/login') || !!document.querySelector('#rtc-worlds-h, .rt-view'), undefined, { timeout: 30000 })
        if (!new URL(page.url()).pathname.startsWith('/login')) return

        await page.locator('input[type=email]').fill(player.email)
        await page.locator('input[type=password]').fill(player.password)
        await page.locator('button[type=submit]').click()
        const signedIn = await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 8000 }).then(() => true, () => false)
        if (!signedIn) {
            await page.goto(`${player.baseUrl}/register`)
            await page.locator('input[placeholder="Your name"]').fill(player.name)
            await page.locator('input[type=email]').fill(player.email)
            await page.locator('input[type=password]').fill(player.password)
            await page.locator('button[type=submit]').click()
            await page.waitForURL(url => !url.pathname.startsWith('/register'), { timeout: 15000 })
        }
        await page.goto(`${player.baseUrl}/rail-tycoon`)
        await page.waitForFunction(() => location.pathname.startsWith('/login') || !!document.querySelector('#rtc-worlds-h, .rt-view'), undefined, { timeout: 30000 })
        if (new URL(page.url()).pathname.startsWith('/login')) throw new Error(`player ${player.n} (${player.email}) could not sign in or register`)
    }

    // ─── Chooser ─────────────────────────────────────────────────────────

    /** Opens the world chooser (leaving any world) and waits for the list. */
    async openChooser(player: RtPlayer): Promise<void> {
        await player.page.goto(`${player.baseUrl}/rail-tycoon`)
        await player.page.locator('#rtc-worlds-h').waitFor({ timeout: 15000 })
        await player.page.waitForFunction(() => !document.body.innerText.includes('Connecting to the server'), undefined, { timeout: 15000 })
    }

    /** Creates a world from the chooser and waits until it is open and stepping; returns its id. */
    async createWorld(player: RtPlayer, name: string, options: RtCreateWorldOptions = {}): Promise<string> {
        const { page } = player
        await this.openChooser(player)
        await page.locator('[data-field=world-name]').fill(name)
        await page.locator(`[data-side="${options.side ?? 64}"]`).click()
        await page.locator('[data-field=max-companies]').selectOption(String(options.maxCompanies ?? 4))
        await page.locator('[data-field=sharing]').setChecked(options.sharing ?? true)
        await page.locator('[data-action=create]').click()
        return this.waitForWorld(player, 60000)
    }

    /** The invite link of a world in the chooser, by name: clicks Copy invite link and reads the clipboard. */
    async copyInvite(player: RtPlayer, worldName: string): Promise<string> {
        const { page } = player
        if (!page.url().includes('/rail-tycoon') || page.url().includes('world=')) await this.openChooser(player)
        const row = page.locator('li[data-world-id]').filter({ has: page.locator('.rtc-name-text', { hasText: worldName }) }).first()
        await row.waitFor({ timeout: 15000 })
        await row.locator('[data-action=copy-invite]').click()
        const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '')
        if (copied.includes('/rail-tycoon/invite/')) return copied
        // clipboard unavailable: the row carries the same code
        const code = await row.getAttribute('data-invite-code')
        if (!code) throw new Error(`no invite code on world ${worldName}`)
        return `${player.baseUrl}/rail-tycoon/invite/${code}`
    }

    /** Follows an invite link as this player (on the player's own origin) and waits in the joined world. */
    async followInvite(player: RtPlayer, link: string): Promise<string> {
        const path = new URL(link).pathname
        await player.page.goto(`${player.baseUrl}${path}`)
        return this.waitForWorld(player, 60000)
    }

    /** Continue (or Spectate) a world from the chooser by name. */
    async continueWorld(player: RtPlayer, worldName: string): Promise<string> {
        const { page } = player
        await this.openChooser(player)
        const row = page.locator('li[data-world-id]').filter({ has: page.locator('.rtc-name-text', { hasText: worldName }) }).first()
        await row.locator('[data-action=continue], [data-action=spectate]').first().click()
        return this.waitForWorld(player, 60000)
    }

    /** Waits for ?world= in the URL and a ready game view; returns the world id. */
    async waitForWorld(player: RtPlayer, timeout = 30000): Promise<string> {
        await player.page.waitForURL(url => url.searchParams.has('world'), { timeout })
        // ready is the lockstep; tileToScreen also needs the renderer, which starts once its sprites load
        await player.page.waitForFunction(() => {
            const hook = (window as unknown as { __railTycoon?: { ready: boolean, tileToScreen(x: number, y: number): unknown } }).__railTycoon
            return !!hook && hook.ready && hook.tileToScreen(0, 0) !== null
        }, undefined, { timeout })
        await this.installHashRecorder(player)
        return new URL(player.page.url()).searchParams.get('world')!
    }

    // ─── The map, in tile coordinates ────────────────────────────────────

    /** The hook's state now, or null outside a world. */
    async state(player: RtPlayer): Promise<RtHookState | null> {
        return player.page.evaluate(() => {
            const hook = (window as unknown as { __railTycoon?: RtHookState }).__railTycoon
            if (!hook) return null
            return { ready: hook.ready, worldId: hook.worldId, tick: hook.tick, hash: hook.hash, company: hook.company, role: hook.role }
        })
    }

    /** Viewport position of the centre of tile (x, y), or null when it is not loaded. */
    async tileToScreen(player: RtPlayer, x: number, y: number): Promise<{ x: number, y: number } | null> {
        return player.page.evaluate(([tx, ty]) => {
            const hook = (window as unknown as { __railTycoon?: { tileToScreen(x: number, y: number): { x: number, y: number } | null } }).__railTycoon
            return hook?.tileToScreen(tx, ty) ?? null
        }, [x, y] as const)
    }

    async screenToTile(player: RtPlayer, clientX: number, clientY: number): Promise<{ x: number, y: number } | null> {
        return player.page.evaluate(([cx, cy]) => {
            const hook = (window as unknown as { __railTycoon?: { screenToTile(x: number, y: number): { x: number, y: number } | null } }).__railTycoon
            return hook?.screenToTile(cx, cy) ?? null
        }, [clientX, clientY] as const)
    }

    private async onScreen(player: RtPlayer, x: number, y: number): Promise<{ x: number, y: number }> {
        const point = await this.tileToScreen(player, x, y)
        if (!point) throw new Error(`tile ${x},${y} has no screen position for player ${player.n}`)
        const { width, height } = this.viewport
        if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) {
            throw new Error(`tile ${x},${y} is off screen for player ${player.n} at ${Math.round(point.x)},${Math.round(point.y)}; scroll the view first`)
        }
        // a window, the toolbar or the status bar over the tile would take the click instead of the map
        const cover = await player.page.evaluate(([px, py]) => {
            const hit = document.elementFromPoint(px, py)
            if (!hit || hit.tagName === 'CANVAS') return null
            const owner = hit.closest('.rt-window, .rt-top, .rt-bottom')
            return (owner ?? hit).getAttribute('aria-label') ?? (owner ?? hit).className.toString()
        }, [point.x, point.y] as const)
        if (cover !== null) throw new Error(`tile ${x},${y} is covered by "${cover}" for player ${player.n}; move the view or the window first`)
        return point
    }

    /** Clicks a toolbar button by its label (aria-label), e.g. 'Build railway track'. */
    async toolbar(player: RtPlayer, label: string): Promise<void> {
        await player.page.getByRole('button', { name: label, exact: true }).click()
    }

    /** A left click on a tile, with optional modifiers (Control for Ctrl+click). */
    async clickTile(player: RtPlayer, x: number, y: number, modifiers: ('Control' | 'Shift')[] = []): Promise<void> {
        const p = await this.onScreen(player, x, y)
        const mouse = player.page.mouse
        for (const key of modifiers) await player.page.keyboard.down(key)
        await mouse.move(p.x, p.y)
        await mouse.down()
        await mouse.up()
        for (const key of modifiers) await player.page.keyboard.up(key)
    }

    /** A left drag from one tile to another in small steps, as a hand would build track or road. */
    async dragTiles(player: RtPlayer, from: { x: number, y: number }, to: { x: number, y: number }, steps = 12): Promise<void> {
        const a = await this.onScreen(player, from.x, from.y)
        const b = await this.onScreen(player, to.x, to.y)
        const mouse = player.page.mouse
        await mouse.move(a.x, a.y)
        await mouse.down()
        await mouse.move(b.x, b.y, { steps })
        await mouse.up()
    }

    /**
     * Centres the player's view on a tile by scrolling with the right mouse button. The drag
     * direction is learned: a drag that moved the tile away is flipped for the next one.
     */
    async centreOn(player: RtPlayer, x: number, y: number): Promise<void> {
        const cx = this.viewport.width / 2
        const cy = this.viewport.height / 2
        let sign = 1
        let lastDistance = Infinity
        for (let attempt = 0; attempt < 8; attempt++) {
            const p = await this.tileToScreen(player, x, y)
            if (!p) throw new Error(`tile ${x},${y} is not loaded for player ${player.n}`)
            const distance = Math.hypot(p.x - cx, p.y - cy)
            if (distance < 40) return
            if (distance > lastDistance) sign = -sign
            lastDistance = distance
            // one drag moves at most a little under half the viewport each way
            const dx = sign * Math.max(-cx + 20, Math.min(cx - 20, cx - p.x))
            const dy = sign * Math.max(-cy + 20, Math.min(cy - 20, cy - p.y))
            const mouse = player.page.mouse
            await mouse.move(cx, cy)
            await mouse.down({ button: 'right' })
            await mouse.move(cx + dx, cy + dy, { steps: 8 })
            await mouse.up({ button: 'right' })
            await sleep(50)
        }
        throw new Error(`could not centre player ${player.n} on tile ${x},${y}`)
    }

    // ─── Lockstep checks ─────────────────────────────────────────────────

    /** Records (tick, hash) in the page every HASH_SAMPLE_EVERY ticks; computing a hash walks the world, so not every frame. */
    private async installHashRecorder(player: RtPlayer): Promise<void> {
        await player.page.evaluate((every) => {
            const w = window as unknown as { __rtE2E?: { samples: Map<number, number>, worldId: string | null }, __railTycoon?: RtHookState }
            if (w.__rtE2E) return
            const rec = { samples: new Map<number, number>(), worldId: null as string | null }
            w.__rtE2E = rec
            const loop = () => {
                const hook = w.__railTycoon
                if (hook && hook.ready && hook.tick !== null) {
                    if (rec.worldId !== hook.worldId) {
                        rec.samples.clear()
                        rec.worldId = hook.worldId
                    }
                    if (hook.tick % every === 0 && !rec.samples.has(hook.tick)) {
                        const hash = hook.hash
                        if (hash !== null) rec.samples.set(hook.tick, hash)
                        if (rec.samples.size > 400) rec.samples.delete(rec.samples.keys().next().value!)
                    }
                }
                requestAnimationFrame(loop)
            }
            requestAnimationFrame(loop)
        }, HASH_SAMPLE_EVERY)
    }

    /** The player's tick and hash now. */
    async tickAndHash(player: RtPlayer): Promise<{ tick: number | null, hash: number | null }> {
        const state = await this.state(player)
        return { tick: state?.tick ?? null, hash: state?.hash ?? null }
    }

    /**
     * Waits until every player has recorded the same tick, then requires the same hash there.
     * Throws on a mismatch (a desync) or when no common tick shows up in time.
     */
    async waitForSameHash(players: RtPlayer[] = this.players, timeoutMs = 30000): Promise<{ tick: number, hash: number }> {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
            const all = await Promise.all(players.map(player => player.page.evaluate(() => {
                const rec = (window as unknown as { __rtE2E?: { samples: Map<number, number>, worldId: string | null } }).__rtE2E
                return rec ? { worldId: rec.worldId, samples: [...rec.samples.entries()] } : null
            })))
            if (all.every(entry => entry !== null)) {
                const worlds = new Set(all.map(entry => entry!.worldId))
                if (worlds.size > 1) throw new Error(`players are in different worlds: ${[...worlds].join(', ')}`)
                const maps = all.map(entry => new Map(entry!.samples))
                const common = [...maps[0]!.keys()].filter(tick => maps.every(map => map.has(tick)))
                if (common.length) {
                    const tick = Math.max(...common)
                    const hashes = maps.map(map => map.get(tick)!)
                    if (hashes.some(hash => hash !== hashes[0])) {
                        throw new Error(`desync at tick ${tick}: ${players.map((p, i) => `p${p.n}=${hashes[i]}`).join(' ')}`)
                    }
                    return { tick, hash: hashes[0]! }
                }
            }
            await sleep(250)
        }
        throw new Error(`no common sampled tick across players ${players.map(p => p.n).join(', ')} within ${timeoutMs} ms`)
    }

    // ─── Evidence ────────────────────────────────────────────────────────

    /** Screenshots at dpr 1 and dpr 2; returns both paths. */
    async screenshot(player: RtPlayer, name: string): Promise<{ dpr1: string, dpr2: string }> {
        mkdirSync(this.shotsDir, { recursive: true })
        const base = join(this.shotsDir, `${name}-p${player.n}`)
        const dpr1 = `${base}-dpr1.png`
        const dpr2 = `${base}-dpr2.png`
        await player.page.screenshot({ path: dpr1 })
        const cdp: CDPSession = await player.context.newCDPSession(player.page)
        const { width, height } = this.viewport
        try {
            await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false })
            await this.settle(player)
            // page.screenshot() re-applies Playwright's own dpr 1 metrics, so capture through the same session
            const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
            writeFileSync(dpr2, Buffer.from(shot.data, 'base64'))
        } finally {
            await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
            await this.settle(player)
            await cdp.detach()
        }
        return { dpr1, dpr2 }
    }

    /** A resize event and two frames, so the renderer picks up a new pixel ratio. */
    private async settle(player: RtPlayer): Promise<void> {
        await player.page.evaluate(() => new Promise<void>((done) => {
            window.dispatchEvent(new Event('resize'))
            requestAnimationFrame(() => requestAnimationFrame(() => done()))
        }))
        await sleep(150)
    }

    /** Console errors and failed requests of every player, for a report. */
    problems(): { player: number, consoleErrors: string[], failedRequests: string[] }[] {
        return this.players.map(player => ({ player: player.n, consoleErrors: [...player.consoleErrors], failedRequests: [...player.failedRequests] }))
    }

    // ─── Shutdown ────────────────────────────────────────────────────────

    /** Closes every player; then kills any Chrome still running on one of this harness's profiles. */
    async close(): Promise<void> {
        const players = this.players.splice(0, this.players.length)
        // leave the page first so its socket closes cleanly: a browser torn down mid-game resets the
        // connection, and nuxi dev's proxy restarts Nuxt on that ECONNRESET (dropping every room)
        await Promise.all(players.map(player => player.page.goto('about:blank', { timeout: 5000 }).catch(() => {})))
        await sleep(300)
        await Promise.all(players.map(player => player.context.close().catch(() => {})))
        for (const player of players) {
            for (const pid of this.chromePids(player.profileDir)) {
                try {
                    process.kill(pid, 'SIGKILL')
                } catch {
                    // already gone
                }
            }
        }
    }

    /** PIDs of Chrome processes still running on any profile this harness launched (empty after close()). */
    leftoverPids(): number[] {
        return [...this.launchedProfiles].flatMap(dir => this.chromePids(dir))
    }

    /** PIDs of Chrome processes whose command line names this profile directory. */
    private chromePids(profileDir: string): number[] {
        let out = ''
        try {
            out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
        } catch {
            return []
        }
        const marker = `--user-data-dir=${profileDir}`
        const pids: number[] = []
        for (const line of out.split('\n')) {
            const match = /^\s*(\d+)\s+(.*)$/.exec(line)
            if (!match) continue
            const command = match[2]!
            // the exact profile, not one whose path merely starts the same (player-1 vs player-10)
            if (command.includes(`${marker} `) || command.endsWith(marker)) pids.push(Number(match[1]))
        }
        return pids
    }
}
