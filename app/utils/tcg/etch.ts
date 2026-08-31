/**
 * Is this printing engraved?
 *
 * The card data separates the two halves of a foil: `foilEffect` names the
 * COLOUR treatment (Rainbow, SvUltra, Tinsel…) and `foilMask` names the
 * SURFACE — 'Etched' when the foil is engraved, 'ColdFoilEtched' for the gold
 * rainbow secrets, 'Holo'/'Reverse' when it is flat.
 *
 * foil.js keys everything on the effect, so its `etch` flag lives on the
 * effect preset — which cannot be right, because an effect is not etched or
 * flat by nature. 'Rainbow' is etched on Black Bolt's two Black White Rares
 * and flat across 2472 BW-era reverse holos. Reading the mask instead settles
 * it per card: 813 of them across 38 sets carry an etched mask.
 *
 * This only ever ADDS the engraving — never removes one — so a preset that
 * knows better than its cards keeps its own flag. BREAK cards are the case in
 * point: `squares` etches them while their mask reads 'Holo'.
 */
export function isEtchedMask(foilMask: string | null | undefined): boolean {
    return /etched/i.test(foilMask ?? '')
}

/**
 * The `etch` argument for foil.js `resolve()`: true when the mask says so,
 * otherwise undefined, which leaves the effect preset's own flag to decide.
 * Passing `false` would override it — that is the bug this shape avoids.
 */
export function etchFor(foilMask: string | null | undefined): true | undefined {
    return isEtchedMask(foilMask) || undefined
}
