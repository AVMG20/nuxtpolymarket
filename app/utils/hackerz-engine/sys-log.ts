/**
 * The firewall's own syslog: what the defence "sees" as the wave plays out,
 * written as terse, slightly unhinged ops chatter for the terminal beside the
 * board. Purely cosmetic — the wording is rolled with `Math.random`, and
 * nothing here feeds back into the game.
 *
 * Busy events (routine kills, hits on the fence) are rate-limited so the log
 * reads as a story of the wave rather than a firehose.
 */

export type SysLogKind = 'bad' | 'good' | 'warn' | 'info'

export interface SysLogLine {
    id: number
    /** Wave clock when it was written, e.g. `T+12.4`. */
    stamp: string
    text: string
    kind: SysLogKind
    /** A game notice promoted into the log: shown as a big warning line. */
    big?: boolean
}

/** Process names each hostile type shows up as. */
const PROCESSES: Record<string, string[]> = {
    crawler: ['crawlr.sh', 'sniffd', 'keylog32', 'pwnkit', 'scriptkid.py', 'mimikatz', 'netcat -lvp'],
    grunt: ['daemon', 'svch0st.exe', 'cronjob.sh', 'kworker/u4:2', 'init.d/evil', 'systemd-imposter'],
    sapper: ['fork.bomb', 'logic.bomb', 'zip.bomb', 'rm -rf /', ':(){ :|:& };:', 'payload.bin'],
    drone: ['wisp.dll', 'beacon.exe', 'ping-flood', 'mdns-spoof', 'arp.poison'],
    brute: ['bulwark.sys', 'shield.ko', 'ward.drv'],
    spitter: ['lancer.jar', 'xss.js', 'sql_inj.php', 'csrf.html', 'curl | sh'],
    warden: ['warden.sys', 'rootshell', 'setuid.bin', 'sudoedit'],
    tank: ['siege.iso', 'brute-force.bin', 'hashcat --force', 'rainbow.tbl'],
    artillery: ['howitzer.exe', 'ddos-cannon', 'amplify.dns', 'slowloris'],
    gunship: ['gunship.apk', 'botnet-c2', 'mirai.arm7', 'zombie.cfg'],
    phantom: ['phantom.dll', 'stealth.rootkit', 'ghost.so', 'invisible.ink'],
    titan: ['ROOTKIT.sys'],
    leviathan: ['BLACK_ICE.ko'],
    zeroday: ['ZERO_DAY.exe']
}

const SECTORS = ['A-1', 'A-7', 'B-3', 'B-9', 'C-2', 'C-4', 'D-6', 'D-8', 'E-5', 'F-0']
const MONITORS = ['watchdogd', 'sentinel-agent', 'nagios-ng', 'eye-of-sauron', 'telemetryd', 'prometheus-exporter', 'snort']

function pick<T>(list: readonly T[]): T {
    return list[Math.floor(Math.random() * list.length)]!
}

function pid() {
    return 1000 + Math.floor(Math.random() * 64000)
}

function ip() {
    return `${pick([45, 91, 103, 185, 194, 203])}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 254)}`
}

function fill(template: string, values: Record<string, string | number>) {
    return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`))
}

/** Ms between two routine kill lines, and between two fence-hit lines. */
const KILL_GAP_MS = 900
const WALL_GAP_MS = 2500
const SAPPER_GAP_MS = 1500
const LEAK_GAP_MS = 4000
/** With nothing logged for this long, an ambient line fills the silence. */
const QUIET_MS = 7000

export class SysLog {
    private nextId = 1
    private lastKill = -Infinity
    private lastWall = -Infinity
    private lastSapper = -Infinity
    private lastLeak = -Infinity
    private lastLine = 0
    private seed = Math.floor(Math.random() * 0xffff)
    /** The wave clock in ms, for stamps and rate limits. */
    clock = 0

    constructor(private emit: (line: SysLogLine) => void) {}

    /** A fresh run: new node addresses, nothing rate-limited. */
    reset() {
        this.seed = Math.floor(Math.random() * 0xffff)
        this.lastKill = -Infinity
        this.lastWall = -Infinity
        this.lastSapper = -Infinity
        this.lastLeak = -Infinity
        this.lastLine = 0
    }

    /** A node's address for this run, e.g. `0x10AD`. */
    chip(id: number) {
        return `0x${((this.seed + id * 0x2f1 + 0x1000) & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`
    }

    private write(kind: SysLogKind, text: string) {
        this.lastLine = this.clock
        this.emit({ id: this.nextId++, stamp: `T+${(Math.max(0, this.clock) / 1000).toFixed(1)}`, text, kind })
    }

    private say(kind: SysLogKind, templates: readonly string[], values: Record<string, string | number> = {}) {
        this.write(kind, fill(pick(templates), values))
    }

    private proc(defId: string) {
        return pick(PROCESSES[defId] ?? ['unknown.bin'])
    }

    /** Fills a quiet stretch with background noise. Call every frame. */
    tick(clockMs: number, alive: number) {
        this.clock = clockMs
        if (clockMs - this.lastLine < QUIET_MS) return
        this.say('info', [
            'heartbeat ok :: {alive} hostile process(es) under watch',
            'ids: {n} packets inspected, {d} dropped',
            'GC pause {ms}ms — nobody panic',
            'cron: rotating logs. again.',
            'coffee.service: degraded (mug empty)',
            'selinux: still enforcing. still annoying.',
            'ntp drift {ms}ms — time is a construct'
        ], { alive, n: 900 + Math.floor(Math.random() * 9000), d: Math.floor(Math.random() * 400), ms: 1 + Math.floor(Math.random() * 30) })
    }

    waveStart(wave: number, bonus: string | null) {
        if (bonus === 'ddos') return this.say('bad', ['>> DDoS: SYN flood inbound. brace the buffers.', '>> DDoS: {n}k req/s and climbing — this is fine'], { n: 40 + Math.floor(Math.random() * 900) })
        if (bonus === 'blackout') return this.say('warn', ['>> BLACKOUT: power grid compromised. eyes are offline.', '>> BLACKOUT: lights out. ping is your only friend.'])
        if (bonus === 'packetloss') return this.say('warn', ['>> PACKET LOSS: the network is lying to you.', '>> PACKET LOSS: {n}% loss. what you see already happened.'], { n: 20 + Math.floor(Math.random() * 30) })
        this.say('info', [
            '=== wave {w} :: inbound sessions from {ip} ===',
            '=== wave {w} :: firewall rules reloaded, {n} entries ===',
            '=== wave {w} :: they are knocking again ==='
        ], { w: wave, ip: ip(), n: 1200 + wave * 37 })
    }

    finalPush() {
        this.say('bad', ['[!!] brute-force phase — they are going all in', '[!!] rate limit exceeded. all of it. at once.', '[!!] final push detected — every socket is hostile'])
    }

    purge(kills: number) {
        this.say('good', ['purge sweep: {k} processes garbage-collected', 'sweep complete — {k} orphans reaped', 'kill -9 -1 :: {k} processes did not survive the sweep'], { k: kills })
    }

    waveEnd(wave: number, kills: number) {
        this.say('good', ['wave {w} contained. {k} processes terminated.', 'incident #{w} closed. {k} kills. writing the post-mortem…'], { w: wave, k: kills })
    }

    chipUnderAttack(id: number, hackers: number) {
        this.say('warn', [
            'intrusion attempt on {c} — {h} terminal(s) open',
            'brute force on {c}: {n} failed logins and counting',
            '{c}: unusual sudo activity from {ip}'
        ], { c: this.chip(id), h: hackers, n: 50 + Math.floor(Math.random() * 950), ip: ip() })
    }

    chipCaptured(id: number, nextId: number | null) {
        const c = this.chip(id)
        this.say('bad', nextId === null
            ? ['[ALERT] node {c} captured — routing table poisoned', '[ALERT] {c} compromised: attacker has ring-0', '[ALERT] {c} lost. they changed the root password.']
            : ['[ALERT] node {c} captured — attacker pivoting to {n}', '[ALERT] {c} compromised, lateral movement toward {n}', '[ALERT] {c} lost. {n} is next on their list.'],
        { c, n: nextId === null ? '' : this.chip(nextId) })
    }

    chipReclaimed(id: number) {
        this.say('good', [
            'node {c} reclaimed — patch applied',
            '{c} reimaged from golden snapshot',
            '{c} back online. attacker session reset.',
            '{c}: rootkit removed with extreme prejudice'
        ], { c: this.chip(id) })
    }

    kill(defId: string, name: string, boss: boolean, cloaked: boolean) {
        const p = this.proc(defId)
        if (boss) return this.say('good', ['{name} unloaded — kernel clean', 'rmmod {p}: success. {name} is gone.'], { name, p })
        if (cloaked) return this.say('good', ['virus {p} moved to quarantine', 'signature match: {p} — quarantined', 'heuristics flagged {p}. quarantine locked.'], { p })
        if (this.clock - this.lastKill < KILL_GAP_MS) return
        this.lastKill = this.clock
        this.say('info', [
            'process {p} (pid {pid}) terminated',
            'kill -9 {pid} :: {p} ended',
            '{p} sandboxed and deleted',
            'oom-killer chose {p}. no regrets.',
            '{p}: segmentation fault (core dumped)'
        ], { p, pid: pid() })
    }

    boss(defId: string, name: string) {
        this.say('bad', ['kernel alert: {name} loaded as a ring-0 driver ({p})', 'insmod {p} — {name} is in the kernel'], { name, p: this.proc(defId) })
    }

    sapperHit(segment: number, integrity: number) {
        if (this.clock - this.lastSapper < SAPPER_GAP_MS) return
        this.lastSapper = this.clock
        this.say('bad', ['{p} detonated on fence segment {s} — integrity {i}%', 'fence segment {s} breached by {p}. integrity {i}%'], { p: this.proc('sapper'), s: segment, i: integrity })
    }

    /** ROOTKIT infects a hacked node: it will hatch spiderlings. */
    infected(id: number) {
        const c = this.chip(id)
        this.say('bad', [
            '{c}: rootkit payload dropped — node is breeding',
            'kernel worm nesting in {c}. spawning children.',
            '{c} infected: fork() in a loop. it will not stop on its own.'
        ], { c })
    }

    /** A Daemon starts a new pile of leaked allocations against the fence. */
    memoryLeak(segment: number) {
        if (this.clock - this.lastLeak < LEAK_GAP_MS) return
        this.lastLeak = this.clock
        this.say('warn', [
            'malloc() without free() on fence segment {s} — heap climbing',
            '{p} is leaking into segment {s}. RSS +{n}MB',
            'valgrind: {n} blocks definitely lost at segment {s}'
        ], { p: this.proc('grunt'), s: segment, n: 16 + Math.floor(Math.random() * 240) })
    }

    /** Leaked allocations reclaimed: the purge's sweep, or a stack shot clean. */
    heapFreed(blocks: number, swept: boolean) {
        this.say('good', swept
            ? ['GC: full collection, {b} leaked block(s) reclaimed', 'heap compacted — {b} allocation(s) freed']
            : ['free(): segment cleared, {b} block(s) returned to the heap'], { b: blocks })
    }

    wallHit(integrity: number) {
        if (this.clock - this.lastWall < WALL_GAP_MS) return
        this.lastWall = this.clock
        if (integrity > 75) return
        this.say(integrity > 40 ? 'warn' : 'bad', [
            'integrity {i}% — firewall rules failing',
            'ACL corruption detected, integrity {i}%',
            'integrity {i}%. someone page the on-call.'
        ], { i: integrity })
    }

    darkZone(index: number) {
        const s = SECTORS[index % SECTORS.length]!
        this.say('bad', [
            '{m} crashed in sector {s} — telemetry lost. use PING.',
            'monitoring agent {m} unresponsive (sector {s})',
            'segfault in sensor-grid@{s}: core dumped. it is dark in there.'
        ], { m: pick(MONITORS), s })
    }

    lightsBack(index: number) {
        this.say('good', ['{m} respawned in sector {s} — eyes back on', 'sector {s} telemetry restored'], { m: pick(MONITORS), s: SECTORS[index % SECTORS.length]! })
    }

    shieldWall(id: number) {
        this.say('warn', ['shield wall raised in front of {c}', 'bulwark.sys guarding {c} — reroute your fire'], { c: this.chip(id) })
    }

    lagSpike() {
        this.say('warn', ['packet loss {n}% — retransmitting…', 'TCP retransmission storm. frames dropped.', 'jitter {ms}ms. the picture is lying.'], { n: 20 + Math.floor(Math.random() * 60), ms: 200 + Math.floor(Math.random() * 1800) })
    }

    hackerSurge(count: number) {
        this.say('bad', ['second contingent: {n} new sessions from {ip}', 'botnet wakes up: {n} more hackers on the wire'], { n: count, ip: ip() })
    }

    hostage(hackerId: string, shieldId: string) {
        this.say('warn', [
            '{h} took {s} hostage — human shield inbound',
            '{h} hijacked {s} and is pushing it ahead as cover',
            'privilege escalation: {h} is wearing {s} as a meat-shield'
        ], { h: this.proc(hackerId), s: this.proc(shieldId) })
    }

    decoys() {
        this.say('warn', ['decoy traffic: sappers flooding the perimeter', 'noise burst at the fence — they want you looking the wrong way'])
    }

    deploy(kind: string, chipId: number | null) {
        if (kind === 'honeypot') return this.say('info', ['honeypot spun up at {ip} — fake root password set to "hunter2"', 'honeypot online. bait: /etc/shadow (fake)'], { ip: ip() })
        if (kind === 'bomb' && chipId !== null) return this.say('info', ['logic bomb wired into {c}. touch it and see.', 'cron @reboot on {c}: boom.'], { c: this.chip(chipId) })
        if (kind === 'bomb') return this.say('info', ['logic bomb armed — trip wire set', 'logic bomb planted. counting footsteps.'])
        if (kind === 'portscan') return this.say('info', ['nmap -sS -p- 0.0.0.0/0 — standing sweep running', 'portscan up: every open port answers, every few seconds'])
        if (kind === 'surge') return this.say('info', ['power surge routed into the grid — do not touch', 'overvoltage on sector {s}. stand clear.'], { s: Math.floor(Math.random() * 90) + 10 })
        this.say('info', ['proxy wall up: ACL deny any any', 'proxy wall deployed. nobody gets through without a ticket.'])
    }

    /** A Cosmic Blip flipped `count` nodes back to us. */
    blip(count: number) {
        this.say('good', ['single-event upset: {n} node(s) flipped back to us. thanks, sun.', 'cosmic ray bit-flip — {n} node(s) reclaimed. no one can explain it.'], { n: count })
    }

    /** A White Hat turned `count` hostiles. */
    whiteHat(count: number) {
        this.say('good', ['bug bounty paid: {n} process(es) now report to us', '{n} hostile process(es) switched sides. responsible disclosure.'], { n: count })
    }

    blast(kind: string, kills: number) {
        if (kind === 'honeypot') return this.say('good', ['honeypot sprung — {k} process(es) trapped and wiped', 'they took the bait. {k} down.'], { k: kills })
        this.say('good', ['logic bomb triggered — {k} process(es) zeroed', 'boom. {k} process(es) no longer exist.'], { k: kills })
    }

    ping(found: number) {
        this.say('info', ['radar sweep: {n} signature(s) resolved', 'nmap -sS: {n} host(s) up'], { n: found })
    }

    chain(length: number) {
        this.say('good', ['exploit chain ×{n} — credit multiplier up', '{n} clean kills in a row. the SOC is impressed.'], { n: length })
    }
}
