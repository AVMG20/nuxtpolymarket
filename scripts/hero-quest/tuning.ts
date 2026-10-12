/**
 * Runtime constant overrides for the combat sim.
 *
 * `constants.ts` is a flat list of literals by design, so the sim can rewrite it at load
 * time via a Bun plugin and explore a dial without anyone editing the file. Dev tooling
 * only — this lives entirely in `scripts/`, and `shared/` never learns it exists.
 *
 * Fails loudly: if a `--set` name matches nothing, the run aborts rather than silently
 * reporting numbers for the un-overridden value.
 */

import { plugin } from 'bun'

export type Overrides = Record<string, number>

/** `--set=K=3`, `--set=K=3,BASE_HP=200`, or `--set=STAT_TIER_VALUES.high=20`. Repeatable. */
export function parseOverrides(argv: readonly string[]): Overrides {
    const out: Overrides = {}
    for (const entry of argv) {
        if (!entry.startsWith('--set=')) continue
        for (const pair of entry.slice('--set='.length).split(',')) {
            if (!pair.trim()) continue
            const split = pair.indexOf('=')
            if (split < 0) throw new Error(`--set expects NAME=VALUE, got "${pair}"`)
            const name = pair.slice(0, split).trim()
            const value = Number(pair.slice(split + 1).trim())
            if (!Number.isFinite(value)) throw new Error(`--set ${name}: "${pair.slice(split + 1)}" is not a number`)
            out[name] = value
        }
    }
    return out
}

// Matches a numeric literal, including the `1 / 3` form and exponent notation.
const NUMERIC = String.raw`-?\d+(?:\.\d+)?(?:e[-+]?\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?`

/**
 * Rewrites `export const NAME = <number>` and `NAME.member` inside a const object literal.
 * Returns which keys actually matched so the caller can reject typos.
 */
export function applyOverridesToSource(source: string, overrides: Overrides): { source: string; applied: string[] } {
    const applied: string[] = []
    let out = source

    for (const [key, value] of Object.entries(overrides)) {
        const [name, member] = key.split('.')
        if (!name) continue

        if (member) {
            // Scope the member search to that constant's object literal, so a common key
            // name can't match something elsewhere in the file.
            const block = new RegExp(`(export const ${name}\\b[^=]*=\\s*\\{)([\\s\\S]*?)(\\n\\})`)
            const found = out.match(block)
            if (!found?.[2]) continue
            const memberPattern = new RegExp(`(\\b${member}\\s*:\\s*)(${NUMERIC})`)
            if (!memberPattern.test(found[2])) continue
            out = out.replace(block, (_all, head: string, body: string, tail: string) =>
                head + body.replace(memberPattern, `$1${value}`) + tail)
            applied.push(key)
            continue
        }

        const scalar = new RegExp(`(export const ${name}\\b[^=\\n]*=\\s*)(${NUMERIC})`)
        if (!scalar.test(out)) continue
        out = out.replace(scalar, `$1${value}`)
        applied.push(key)
    }

    return { source: out, applied }
}

/**
 * Must run before anything imports `constants.ts` — the CLI registers this, then reaches
 * the sim through a dynamic import so the plugin is in place first.
 */
export function registerTuning(overrides: Overrides): void {
    const requested = Object.keys(overrides)
    if (requested.length === 0) return

    plugin({
        name: 'hero-quest-tuning',
        setup(build) {
            build.onLoad({ filter: /hero-quest[/\\]constants\.ts$/ }, async (args) => {
                const original = await Bun.file(args.path).text()
                const { source, applied } = applyOverridesToSource(original, overrides)
                const missed = requested.filter(key => !applied.includes(key))
                if (missed.length > 0) {
                    throw new Error(`--set matched no constant: ${missed.join(', ')}`)
                }
                return { contents: source, loader: 'ts' }
            })
        }
    })
}

export function describeOverrides(overrides: Overrides): string {
    const entries = Object.entries(overrides)
    return entries.length === 0 ? '' : entries.map(([key, value]) => `${key}=${value}`).join(' ')
}
