/**
 * Cards printed sideways: LEGEND halves and BREAK evolutions.
 *
 * Their faces are stored upright like every other card, with the layout
 * turned a quarter clockwise inside the portrait frame, so they read only
 * once the card is laid on its side. The card data has no orientation
 * field — the names are the only tell — and not every payload that draws a
 * card carries its name, so this keys on the face bundle, which every
 * renderer already has.
 *
 * 38 faces across 69 printings (XY-era BREAK cards, their promos, and the
 * 30th Celebration Classic Collection's Darkrai & Cresselia LEGEND and
 * Greninja BREAK). None is shared with an upright card. Neither card type
 * is printed any more, so the list only grows when a set reprints one;
 * regenerate it from the sidecar's all-cards.json, taking every bundle whose
 * card name ends in " LEGEND" or " BREAK".
 */
const LANDSCAPE_BUNDLES = new Set([
    'me5-5c_en_016', 'me5-5c_en_017', 'me5-5c_en_022',
    'xy8_en_012', 'xy8_en_050', 'xy8_en_079', 'xy8_en_092', 'xy8_en_104', 'xy8_en_113',
    'xy9_en_018', 'xy9_en_041', 'xy9_en_047', 'xy9_en_066', 'xy9_en_089',
    'xy10_en_014', 'xy10_en_019', 'xy10_en_051', 'xy10_en_062', 'xy10_en_079',
    'xy11_en_008', 'xy11_en_021', 'xy11_en_024', 'xy11_en_035', 'xy11_en_066',
    'xy11_en_082', 'xy11_en_087',
    'xy12_en_016', 'xy12_en_032', 'xy12_en_046', 'xy12_en_060',
    'xybsp_en_134', 'xybsp_en_135', 'xybsp_en_136', 'xybsp_en_154', 'xybsp_en_155',
    'xybsp_en_180', 'xybsp_en_181', 'xybsp_en_182'
])

/** Whether a card face is laid out sideways and should be shown turned. */
export function isLandscapeBundle(bundle: string | null | undefined): boolean {
    return !!bundle && LANDSCAPE_BUNDLES.has(bundle)
}
