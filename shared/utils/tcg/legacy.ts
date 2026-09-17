// Legacy (pre-Black&White) printings: the sidecar serves them as TCGdex
// scans instead of TCG Live bundles. A printing is legacy iff its `bundle`
// is null — modern ids (even suffixed ones like 'sv8-5_106') always carry a
// bundle and must never hit the legacy path.

/**
 * Scan folder of a legacy plaatjes card id: everything up to the LAST '-'
 * ('base1-1' → 'base1'). Returns null when the id carries no usable folder.
 */
export function legacySetOf(plaatjesCardId: string): string | null {
    const cut = plaatjesCardId.lastIndexOf('-')
    return cut > 0 ? plaatjesCardId.slice(0, cut) : null
}
