/**
 * Booster-wrapper art URLs, served by the sidecar at /images/boosters.
 *
 * Files are keyed by the game's lowercase set code (`sv8-5.png`); the WOTC
 * sets have composed wraps under their TCGdex ids (`base1.png`). One alias:
 * CZM's source set (SWSH12A) never had its own wrap — it wore Crown Zenith's.
 */
const WRAP_ALIAS: Record<string, string> = { swsh12a: 'swsh12-5' }

export function wrapCandidates(plaatjesSetCode: string | null | undefined): string[] {
    const code = (plaatjesSetCode ?? '').trim().toLowerCase()
    if (!code) return []
    return [...new Set([WRAP_ALIAS[code] ?? code, code])]
}

export function wrapUrl(apiBase: string, plaatjesSetCode: string | null | undefined): string | null {
    const [first] = wrapCandidates(plaatjesSetCode)
    return first ? `${apiBase}/images/boosters/${first}.png` : null
}
