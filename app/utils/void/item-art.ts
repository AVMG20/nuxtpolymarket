/**
 * Gear icons, drawn as SVG markup on a 64×64 canvas.
 *
 * Every icon is gunmetal hardware with the item's own colour as the accent, so
 * the colour still identifies the type at 18px while the big sizes read as an
 * object rather than a glyph. Fills come from the classes in VoidItemArt.vue:
 *
 *   m1–m4  metal, light to near-black      a1–a4  accent, light to dark
 *   g      white-hot and glowing           e      accent and glowing
 *   gl     see-through accent (glass)      hl/sh  highlight and shade overlays
 *   l l2 l3 lw ln hs o                     strokes (accent, white-hot, seams, rings)
 *
 * `url(#~M)`, `#~A` and `#~G` are the metal, accent and glow gradients; the
 * component swaps `~` for a per-instance id so icons never share a gradient.
 */

const aim = (deg: number, cx: number, cy: number, inner: string) => `<g transform="rotate(${deg} ${cx} ${cy})">${inner}</g>`
const spin = (steps: number[], inner: string) => steps.map(deg => `<g transform="rotate(${deg} 32 32)">${inner}</g>`).join('')

/** Guns hang off a hull hardpoint, so each carries its clamp rather than a grip. */
const CLAMP = `
    <path d="M7 39 L23 39 L20 46 L10 46 Z" class="m3" />
    <rect x="5" y="45.5" width="20" height="3.6" rx="1.2" class="m2" />`

/** The deck mount every turret sits on. */
const MOUNT = `
    <ellipse cx="32" cy="58" rx="23" ry="4" class="sh" />
    <path d="M11 57 L19 46 L45 46 L53 57 Z" fill="url(#~M)" />
    <path d="M11 57 L53 57 L51 60 L13 60 Z" class="m4" />
    <path d="M19.6 46.6 L44.4 46.6" class="hs" />
    <rect x="22" y="42" width="20" height="4.5" rx="1" class="a3" />
    <rect x="16" y="52" width="7" height="2.2" rx="1.1" class="e" />
    <rect x="41" y="52" width="7" height="2.2" rx="1.1" class="m4" />`

/** The armoured cheeks a turret's gun elevates between. */
const HOUSING = `
    <path d="M16 44 L16 33 L22 25 L36 25 L42 33 L42 44 Z" fill="url(#~M)" />
    <path d="M16 44 L16 33 L22 25 L25 25 L19.5 33 L19.5 44 Z" class="hl" />
    <path d="M36 25 L42 33 L42 44 L38.5 44 L38.5 33.6 L33.5 25 Z" class="sh" />`

const PIVOT = `
    <circle cx="29" cy="35" r="5.2" class="m4" />
    <circle cx="29" cy="35" r="3" class="e" />`

/** A hologram is scanlines, so the decoy's ship is built from slices. */
const HOLO_SHIP = Array.from({ length: 8 }, (_, i) => {
    const y = 9 + i * 4
    const half = 1.5 + i * 2.1
    if (i < 7) return `<rect x="${32 - half}" y="${y}" width="${half * 2}" height="2.4" rx="1.2" class="e" />`
    return `<rect x="${32 - half}" y="${y}" width="5" height="2.4" rx="1.2" class="e" /><rect x="${32 + half - 5}" y="${y}" width="5" height="2.4" rx="1.2" class="e" />`
}).join('')

const ROCKET = `
    <path d="M17 56 L32 53.6 L32 58.4 Z" class="g" />
    <path d="M32 52 L27 46.5 L38 52 Z M32 60 L27 65.5 L38 60 Z" class="a3" />
    <rect x="31" y="51.5" width="19" height="9" rx="2" fill="url(#~M)" />
    <rect x="43" y="51.5" width="3.5" height="9" class="a2" />
    <path d="M50 51.5 L60 56 L50 60.5 Z" fill="url(#~A)" />
    <path d="M32 52.4 L50 52.4" class="hs" />`

export const VOID_ITEM_ART: Record<string, string> = {
    // ─── Guns: shouldered, muzzle up and to the right ───────────────────────
    blaster: aim(-30, 32, 32, `
        ${CLAMP}
        <rect x="26" y="20" width="28" height="7.5" rx="2" fill="url(#~A)" />
        <rect x="26" y="36.5" width="28" height="7.5" rx="2" fill="url(#~A)" />
        <rect x="26" y="25" width="28" height="2.5" class="sh" />
        <rect x="26" y="41.5" width="28" height="2.5" class="sh" />
        <path d="M0 24.5 L19 18.5 L30 20 L30 44 L19 45.5 L0 39.5 Z" fill="url(#~M)" />
        <rect x="6" y="28" width="16" height="8" rx="2" class="m4" />
        <rect x="8" y="30" width="3" height="4" rx="0.8" class="e" />
        <rect x="12.5" y="30" width="3" height="4" rx="0.8" class="e" />
        <rect x="17" y="30" width="3" height="4" rx="0.8" class="e" />
        <rect x="35" y="18.5" width="5" height="10.5" rx="1.5" class="m1" />
        <rect x="35" y="35" width="5" height="10.5" rx="1.5" class="m1" />
        <rect x="51" y="19" width="5.5" height="9.5" rx="1.5" class="m2" />
        <rect x="51" y="35.5" width="5.5" height="9.5" rx="1.5" class="m2" />
        <path d="M1 25.1 L19 19.4 L29 20.8" class="hs" />
        <circle cx="59.5" cy="23.8" r="3" class="g" />
        <rect x="60" y="39" width="8" height="2.6" rx="1.3" class="g" />`),
    autocannon: aim(-30, 32, 32, `
        <rect x="28" y="28.5" width="32" height="7" rx="1.5" class="m2" />
        <path d="M0 23 L26 23 L31 28 L31 37 L26 41 L0 41 Z" fill="url(#~M)" />
        <circle cx="14" cy="45" r="10" class="m3" />
        <circle cx="14" cy="45" r="8" fill="url(#~A)" />
        <path d="M14 38 L14 41 M14 49 L14 52 M7 45 L10 45 M18 45 L21 45 M9 40 L11.2 42.2 M16.8 47.8 L19 50 M19 40 L16.8 42.2 M11.2 47.8 L9 50" class="ln" />
        <circle cx="14" cy="45" r="3.2" class="m4" />
        <circle cx="14" cy="45" r="1.4" class="e" />
        <rect x="32" y="26" width="17" height="12" rx="2.5" fill="url(#~A)" />
        <path d="M36 28.5 L36 35.5 M40.5 28.5 L40.5 35.5 M45 28.5 L45 35.5" class="ln" />
        <rect x="55" y="25" width="8.5" height="14" rx="2" class="m1" />
        <path d="M58 27.5 L58 36.5 M60.8 27.5 L60.8 36.5" class="ln" />
        <path d="M1 23.8 L26 23.8" class="hs" />
        <path d="M64.5 32 L73 28.5 L69.5 32 L73 35.5 Z" class="g" />`),
    scatter: aim(-30, 32, 32, `
        ${CLAMP}
        <path d="M0 24 L22 24 L27 28 L27 37 L22 41 L0 41 Z" fill="url(#~M)" />
        <rect x="5" y="28" width="12" height="4" rx="2" class="e" />
        <path d="M25 27 L45 18 L45 47 L25 38 Z" fill="url(#~A)" />
        <path d="M25 34 L45 38 L45 47 L25 38 Z" class="sh" />
        <path d="M31 25.5 L31 39.5 M37 23 L37 42" class="ln" />
        <rect x="43" y="15.5" width="6.5" height="34" rx="2.8" class="m1" />
        <path d="M1 24.8 L22 24.8" class="hs" />
        <circle cx="55" cy="18" r="2.4" class="g" />
        <circle cx="59" cy="25.5" r="2.4" class="g" />
        <circle cx="61" cy="32.5" r="2.4" class="g" />
        <circle cx="59" cy="39.5" r="2.4" class="g" />
        <circle cx="55" cy="47" r="2.4" class="g" />`),
    plasma: aim(-30, 32, 32, `
        ${CLAMP}
        <path d="M0 26 L13 25 L16 28 L16 38 L13 41 L0 40 Z" fill="url(#~M)" />
        <path d="M40 27 L50 22.5 L50 43.5 L40 39 Z" class="m2" />
        <ellipse cx="27" cy="33" rx="13.5" ry="11" class="a4" />
        <ellipse cx="27" cy="33" rx="13.5" ry="11" fill="url(#~G)" />
        <ellipse cx="27" cy="33" rx="13.5" ry="11" class="o" />
        <circle cx="25" cy="32" r="3.4" class="g" />
        <circle cx="32" cy="37" r="1.6" class="hl" />
        <circle cx="20" cy="37.5" r="1.2" class="hl" />
        <rect x="13.5" y="23" width="4.5" height="20" rx="1.5" class="m1" />
        <rect x="36.5" y="23" width="4.5" height="20" rx="1.5" class="m1" />
        <path d="M50 22.5 L61 20 L61 24.5 L50 28 Z" fill="url(#~A)" />
        <path d="M50 38 L61 41.5 L61 46 L50 43.5 Z" fill="url(#~A)" />
        <circle cx="59" cy="33" r="7" fill="url(#~G)" />
        <circle cx="59" cy="33" r="3" class="g" />`),
    lancer: aim(-30, 32, 32, `
        ${CLAMP}
        <path d="M16 21.5 L57 28.5 L57 30.7 L16 26 Z" fill="url(#~A)" />
        <path d="M16 43.5 L57 36.5 L57 34.3 L16 39 Z" fill="url(#~A)" />
        <path d="M0 27 L17 23.5 L37 27 L37 38 L17 41.5 L0 38 Z" fill="url(#~M)" />
        <rect x="6" y="30" width="18" height="5" rx="2.5" class="e" />
        <path d="M28 27 L28 38" class="ln" />
        <ellipse cx="42" cy="32.5" rx="1.9" ry="6.2" class="a1" />
        <ellipse cx="48" cy="32.5" rx="1.6" ry="4.8" class="a1" />
        <ellipse cx="53.5" cy="32.5" rx="1.3" ry="3.4" class="a1" />
        <rect x="37" y="31.4" width="34" height="2.2" rx="1.1" class="g" />
        <path d="M1 27.7 L17 24.3 L36 27.6" class="hs" />`),
    driver: aim(-30, 32, 32, `
        <g transform="translate(-4 2)">${CLAMP}</g>
        <rect x="14" y="29" width="48" height="7" class="m4" />
        <rect x="16" y="31.4" width="44" height="2.2" rx="1.1" class="e" />
        <rect x="14" y="24" width="49" height="5.5" rx="1" class="m2" />
        <rect x="14" y="35.5" width="49" height="5.5" rx="1" class="m2" />
        <path d="M-2 22 L13 22 L18 27 L18 38 L13 43 L-2 43 Z" fill="url(#~M)" />
        <rect x="1" y="26.5" width="10" height="12" rx="2" class="m4" />
        <rect x="3.2" y="28.7" width="5.6" height="7.6" rx="1" class="e" />
        <rect x="22" y="20.5" width="6.5" height="24" rx="2.2" fill="url(#~A)" />
        <rect x="33" y="20.5" width="6.5" height="24" rx="2.2" fill="url(#~A)" />
        <rect x="44" y="20.5" width="6.5" height="24" rx="2.2" fill="url(#~A)" />
        <rect x="55" y="22" width="5" height="21" rx="1.5" class="m1" />
        <path d="M-1 22.8 L13 22.8" class="hs" />
        <path d="M63 29.5 L72 32.5 L63 35.5 Z" class="g" />`),

    // ─── Turrets: on a deck mount, barrels elevated ─────────────────────────
    pulse: `${MOUNT}${aim(-48, 29, 35, `
        <rect x="31" y="28.5" width="27" height="13" rx="3" fill="url(#~A)" />
        <rect x="31" y="37.5" width="27" height="4" rx="2" class="sh" />
        <rect x="40" y="26.5" width="6" height="17" rx="2" class="m1" />
        <rect x="49" y="27.5" width="3" height="15" rx="1.5" class="m2" />
        <rect x="55" y="29.5" width="7" height="11" rx="2" class="m2" />
        <circle cx="65.5" cy="35" r="3.8" class="g" />
        <rect x="70" y="33.6" width="6" height="2.8" rx="1.4" class="e" />`)}${HOUSING}${PIVOT}`,
    gatling: `${MOUNT}${aim(-48, 29, 35, `
        <rect x="31" y="27.5" width="12" height="15" rx="2" class="m3" />
        <rect x="41" y="28" width="23" height="3.4" rx="1" fill="url(#~A)" />
        <rect x="41" y="33.3" width="25" height="3.4" rx="1" fill="url(#~A)" />
        <rect x="41" y="38.6" width="23" height="3.4" rx="1" fill="url(#~A)" />
        <rect x="47" y="26.5" width="4.5" height="17" rx="1.6" class="m1" />
        <rect x="57.5" y="27" width="4" height="16" rx="1.6" class="m1" />
        <circle cx="68.5" cy="35" r="2.6" class="g" />`)}${HOUSING}
        <circle cx="21" cy="37" r="7.5" class="m4" />
        <circle cx="21" cy="37" r="5.6" fill="url(#~A)" />
        <circle cx="21" cy="37" r="2" class="m4" />`,
    flak: `${MOUNT}${aim(-56, 29, 36, `
        <rect x="31" y="26" width="19" height="9" rx="2" fill="url(#~A)" />
        <rect x="31" y="37" width="19" height="9" rx="2" fill="url(#~A)" />
        <rect x="36" y="24.5" width="4.5" height="23" rx="1.6" class="m2" />
        <rect x="47" y="24.5" width="7.5" height="12" rx="2" class="m1" />
        <rect x="47" y="35.5" width="7.5" height="12" rx="2" class="m1" />`)}${HOUSING}${PIVOT}
        <circle cx="51" cy="10" r="7" fill="url(#~G)" />
        <circle cx="51" cy="10" r="2.6" class="g" />
        <path d="M51 0 L51 3.5 M51 16.5 L51 20 M41 10 L44.5 10 M57.5 10 L61 10 M44 3 L46.4 5.4 M55.6 14.6 L58 17 M58 3 L55.6 5.4 M46.4 14.6 L44 17" class="l2" />`,
    tesla: `${MOUNT}
        <rect x="28" y="18" width="8" height="27" rx="2" class="m2" />
        <rect x="28" y="18" width="2.6" height="27" rx="1.3" class="hl" />
        <ellipse cx="32" cy="40" rx="13" ry="3.8" fill="url(#~A)" />
        <ellipse cx="32" cy="33" rx="10.5" ry="3.2" fill="url(#~A)" />
        <ellipse cx="32" cy="26.5" rx="8" ry="2.7" fill="url(#~A)" />
        <circle cx="32" cy="14" r="10" fill="url(#~G)" />
        <circle cx="32" cy="14" r="5" class="g" />
        <path d="M39 11 L46 7 L45 13 L54 8" class="lw" />
        <path d="M25 11 L18 7 L19 13 L10 8" class="lw" />
        <path d="M40 19 L47 22 L45 26 L53 31" class="l2" />
        <path d="M24 19 L17 22 L19 26 L11 31" class="l2" />`,
    beam: `${MOUNT}${aim(-48, 29, 35, `
        <path d="M31 28.5 L47 31 L47 39 L31 41.5 Z" class="m2" />
        <path d="M43 26.5 L60 32.2 L60 33.8 L43 30.5 Z" fill="url(#~A)" />
        <path d="M43 43.5 L60 37.8 L60 36.2 L43 39.5 Z" fill="url(#~A)" />
        <path d="M46 35 L50.5 31 L55 35 L50.5 39 Z" class="g" />
        <rect x="55" y="34" width="21" height="2" rx="1" class="g" />`)}${HOUSING}
        <circle cx="29" cy="35" r="5.6" class="m4" />
        <circle cx="29" cy="35" r="3.6" fill="url(#~G)" />
        <circle cx="29" cy="35" r="1.8" class="g" />`,
    missile: `${MOUNT}
        <path d="M22 45 L27 32 L37 32 L42 45 Z" class="m3" />${aim(-38, 31, 34, `
        <rect x="14" y="21" width="35" height="26" rx="3.5" fill="url(#~M)" />
        <rect x="14" y="41" width="35" height="6" rx="3" class="sh" />
        <rect x="20" y="21" width="5" height="26" class="a2" />
        <path d="M28 29.5 L46 29.5 M28 38.5 L46 38.5" class="ln" />
        <rect x="46" y="19.5" width="5.5" height="29" rx="2" class="a3" />
        <path d="M51.5 21.5 L60 25.2 L51.5 29 Z" fill="url(#~A)" />
        <path d="M51.5 30.3 L60 34 L51.5 37.7 Z" fill="url(#~A)" />
        <path d="M51.5 39 L60 42.8 L51.5 46.5 Z" fill="url(#~A)" />
        <circle cx="59" cy="25.2" r="1.5" class="g" />
        <circle cx="59" cy="34" r="1.5" class="g" />
        <circle cx="59" cy="42.8" r="1.5" class="g" />
        <path d="M15 21.8 L46 21.8" class="hs" />`)}`,
    mortar: `${MOUNT}
        <path d="M18 45 L24 30 L40 30 L46 45 Z" class="m3" />${aim(-63, 30, 38, `
        <rect x="22" y="26" width="32" height="24" rx="5" fill="url(#~A)" />
        <rect x="22" y="43" width="32" height="7" rx="3.5" class="sh" />
        <rect x="27" y="24" width="5.5" height="28" rx="2" class="m1" />
        <rect x="40" y="24" width="5.5" height="28" rx="2" class="m1" />
        <ellipse cx="54" cy="38" rx="4" ry="12" class="m4" />
        <ellipse cx="54" cy="38" rx="2.4" ry="8" class="e" />`)}
        <circle cx="31" cy="37" r="4.6" class="m4" />
        <circle cx="31" cy="37" r="2.4" class="e" />
        <path d="M44 12 Q51 1 59 9" class="l2" stroke-dasharray="1.5 3.5" />
        <circle cx="59.5" cy="10.5" r="3.4" class="g" />`,
    rail: `${MOUNT}${aim(-48, 29, 35, `
        <rect x="31" y="26.5" width="14" height="17" rx="2" class="m3" />
        <rect x="34" y="29.5" width="3" height="11" rx="1" class="e" />
        <rect x="39" y="29.5" width="3" height="11" rx="1" class="e" />
        <rect x="43" y="27" width="31" height="4.5" rx="1" fill="url(#~A)" />
        <rect x="43" y="38.5" width="31" height="4.5" rx="1" fill="url(#~A)" />
        <rect x="45" y="33.9" width="27" height="2.2" rx="1.1" class="g" />
        <rect x="51" y="25.5" width="4" height="19" rx="1.6" class="m1" />
        <rect x="62.5" y="25.5" width="4" height="19" rx="1.6" class="m1" />`)}${HOUSING}${PIVOT}`,

    // ─── Armour ─────────────────────────────────────────────────────────────
    plating: `
        <path d="M37 1 L61 10 L61 36 L37 58 L13 36 L13 10 Z" class="m3" />
        <path d="M37 1 L61 10 L61 36 L37 58 L37 1 Z" class="sh" />
        <path d="M14 10.4 L37 1.8 L60 10.4" class="hs" />
        <path d="M29 6 L53 15 L53 41 L29 63 L5 41 L5 15 Z" class="m4" />
        <path d="M29 6 L5 15 L5 41 L29 63 L29 55 L11.5 38.5 L11.5 19.5 L29 12.8 Z" class="m1" />
        <path d="M29 6 L53 15 L53 41 L29 63 L29 55 L46.5 38.5 L46.5 19.5 L29 12.8 Z" class="m2" />
        <path d="M29 12.8 L46.5 19.5 L46.5 38.5 L29 55 L11.5 38.5 L11.5 19.5 Z" fill="url(#~M)" />
        <path d="M29 12.8 L46.5 19.5 L46.5 38.5 L29 55 Z" class="sh" />
        <path d="M29 12.8 L29 24 M29 44 L29 55 M11.5 30 L20 33 M46.5 30 L38 33" class="ln" />
        <path d="M29 24 L38 33 L29 44 L20 33 Z" class="m4" />
        <path d="M29 27.5 L34.5 33 L29 40 L23.5 33 Z" class="e" />
        <circle cx="16" cy="22" r="1.6" class="m4" />
        <circle cx="42" cy="22" r="1.6" class="m4" />
        <circle cx="29" cy="50" r="1.6" class="m4" />
        <path d="M6 15.6 L29 7" class="hs" />`,
    bulkhead: `
        <path d="M20 4 L44 4 L60 20 L60 44 L44 60 L20 60 L4 44 L4 20 Z" fill="url(#~M)" />
        <path d="M22.5 10 L41.5 10 L54 22.5 L54 41.5 L41.5 54 L22.5 54 L10 41.5 L10 22.5 Z" class="m4" />
        <path d="M24 13.5 L40 13.5 L50.5 24 L50.5 40 L40 50.5 L24 50.5 L13.5 40 L13.5 24 Z" class="m3" />
        <path d="M16 21.5 L21.5 16 L48 42.5 L42.5 48 Z" fill="url(#~A)" />
        <path d="M48 21.5 L42.5 16 L16 42.5 L21.5 48 Z" fill="url(#~A)" />
        <circle cx="32" cy="32" r="10" class="m2" />
        <circle cx="32" cy="32" r="7" class="m4" />
        <circle cx="32" cy="32" r="4" class="e" />
        <path d="M32 22 L32 25 M32 39 L32 42 M22 32 L25 32 M39 32 L42 32" class="ln" />
        <circle cx="21.5" cy="7.5" r="1.6" class="m4" />
        <circle cx="42.5" cy="7.5" r="1.6" class="m4" />
        <circle cx="56.5" cy="21.5" r="1.6" class="m4" />
        <circle cx="56.5" cy="42.5" r="1.6" class="m4" />
        <circle cx="42.5" cy="56.5" r="1.6" class="m4" />
        <circle cx="21.5" cy="56.5" r="1.6" class="m4" />
        <circle cx="7.5" cy="42.5" r="1.6" class="m4" />
        <circle cx="7.5" cy="21.5" r="1.6" class="m4" />
        <path d="M20.4 4.8 L43.6 4.8" class="hs" />`,

    // ─── Shields ────────────────────────────────────────────────────────────
    deflector: `
        <path d="M10 47 A22 22 0 0 1 54 47 Z" class="gl" />
        <path d="M38 30 L35 35.2 L29 35.2 L26 30 L29 24.8 L35 24.8 Z M47 35.2 L44 40.4 L38 40.4 L35 35.2 L38 30 L44 30 Z M29 35.2 L26 40.4 L20 40.4 L17 35.2 L20 30 L26 30 Z M38 40.4 L35 45.6 L29 45.6 L26 40.4 L29 35.2 L35 35.2 Z" class="l3" />
        <path d="M4 47 A28 28 0 0 1 60 47 L54 47 A22 22 0 0 0 10 47 Z" fill="url(#~A)" />
        <path d="M7 40 A26 26 0 0 1 32 21" class="hs" />
        <path d="M20 62 L25 50 L39 50 L44 62 Z" fill="url(#~M)" />
        <rect x="2" y="46" width="60" height="4.5" rx="2.2" class="m2" />
        <rect x="26" y="45" width="12" height="6.5" rx="2" class="e" />
        <circle cx="14.5" cy="26.5" r="3.2" class="g" />
        <path d="M8 27 A9 9 0 0 1 16 19 M21 25 A9 9 0 0 1 14 33.5" class="l2" />`,
    regenerator: `
        <circle cx="32" cy="32" r="27" class="o" />
        <circle cx="32" cy="32" r="14" fill="url(#~G)" />
        <path d="M32 22 L40 25.5 L40 32.5 C40 37.5 36.5 40.5 32 42.5 C27.5 40.5 24 37.5 24 32.5 L24 25.5 Z" class="g" />
        ${spin([0, 180], `
        <path d="M12.3 24.8 A21 21 0 0 1 50.2 21.5" class="l4" />
        <path d="M54.5 28.6 L56 17.8 L45 23 Z" class="a1" />`)}`,

    // ─── Secondary weapons ──────────────────────────────────────────────────
    seekers: `
        <path d="M5 63 Q3 46 16 41.5" class="l2" style="stroke-width: 3" opacity="0.75" />
        <path d="M21 64 Q21 55 30 53" class="l2" opacity="0.7" />${aim(-35, 34, 30, `
        <path d="M20 25.5 L12 16 L29 25.5 Z M20 36.5 L12 46 L29 36.5 Z" class="a3" />
        <path d="M18 25.5 L46 25.5 L57 31 L46 36.5 L18 36.5 Z" fill="url(#~M)" />
        <path d="M46 25.5 L57 31 L46 36.5 Z" fill="url(#~A)" />
        <rect x="31" y="25.5" width="3.5" height="11" class="a2" />
        <rect x="38" y="25.5" width="2" height="11" class="m4" />
        <circle cx="49.5" cy="31" r="1.9" class="g" />
        <path d="M18 27.5 L6 31 L18 34.5 Z" class="g" />
        <path d="M19 26.3 L46 26.3" class="hs" />`)}${aim(-35, 40, 52, `
        <path d="M30 49 L44 49 L50 52 L44 55 L30 55 Z" class="m2" />
        <path d="M44 49 L50 52 L44 55 Z" class="a2" />
        <path d="M30 50.3 L24 52 L30 53.7 Z" class="g" />`)}
        <path d="M47 4 L47 0.5 L50.5 0.5 M59.5 0.5 L63 0.5 L63 4 M63 13 L63 16.5 L59.5 16.5 M50.5 16.5 L47 16.5 L47 13" class="l2" />`,
    rockets: `${aim(-72, 4, 60, ROCKET)}${aim(-14, 4, 60, ROCKET)}<g transform="translate(4 -4)">${aim(-43, 4, 60, ROCKET)}</g>`,
    mines: `${spin([0, 45, 90, 135, 180, 225, 270, 315], `
        <rect x="29.6" y="5" width="4.8" height="12" rx="1" class="m2" />
        <rect x="28.2" y="2.5" width="7.6" height="4.6" rx="1.8" class="a2" />`)}
        <circle cx="32" cy="32" r="18" fill="url(#~M)" />
        <path d="M14 32 A18 18 0 0 0 50 32 Z" class="sh" />
        <rect x="14" y="30" width="36" height="4" class="m4" />
        <circle cx="32" cy="32" r="9.5" class="m4" />
        <circle cx="32" cy="32" r="7.5" fill="url(#~G)" />
        <circle cx="32" cy="32" r="3.2" class="g" />
        <path d="M19 25 A15 15 0 0 1 31 17" class="hs" />`,
    torpedo: aim(-35, 32, 32, `
        <path d="M9 26 L1 13 L20 24.5 Z M9 38 L1 51 L20 39.5 Z" class="a3" />
        <path d="M5 32 L11 23.5 L44 22.5 Q59 25 64 32 Q59 39 44 41.5 L11 40.5 Z" fill="url(#~M)" />
        <path d="M44 22.5 Q59 25 64 32 Q59 39 44 41.5 Z" fill="url(#~A)" />
        <rect x="39.5" y="22.6" width="4.5" height="18.8" class="a3" />
        <rect x="21" y="23.2" width="3" height="17.6" class="m4" />
        <rect x="27" y="29" width="9" height="6" rx="1.5" class="e" />
        <circle cx="56" cy="32" r="2.6" class="g" />
        <ellipse cx="6.5" cy="32" rx="2.6" ry="5.4" class="e" />
        <path d="M4.5 28.5 L-8 32 L4.5 35.5 Z" class="g" />
        <path d="M12 24.5 L44 23.4" class="hs" />`),

    // ─── Devices ────────────────────────────────────────────────────────────
    booster: `
        <path d="M13 13 Q3 32 13 51" class="l" />
        <path d="M51 13 Q61 32 51 51" class="l" />
        <rect x="27.5" y="2" width="9" height="6" rx="1.8" class="m3" />
        <rect x="22" y="14" width="20" height="37" class="a4" />
        <rect x="22" y="24" width="20" height="27" fill="url(#~A)" />
        <path d="M26 42.5 L32 36.5 L38 42.5 L38 46.5 L32 40.5 L26 46.5 Z M26 32.5 L32 26.5 L38 32.5 L38 36.5 L32 30.5 L26 36.5 Z" class="g" />
        <rect x="22" y="14" width="4.5" height="37" class="hl" />
        <rect x="19.5" y="7" width="25" height="8" rx="2.2" class="m1" />
        <rect x="19.5" y="50" width="25" height="8" rx="2.2" class="m2" />
        <path d="M21 8 L43 8" class="hs" />`,
    decoy: `
        <path d="M24 55 L4 6 L60 6 L40 55 Z" class="gl" opacity="0.45" />
        ${HOLO_SHIP}
        <ellipse cx="32" cy="57" rx="16" ry="4.6" fill="url(#~M)" />
        <ellipse cx="32" cy="55.6" rx="11" ry="2.8" class="m4" />
        <ellipse cx="32" cy="55.6" rx="7.5" ry="1.8" class="g" />`,
    sentry: `
        <ellipse cx="32" cy="60" rx="13" ry="2.6" class="sh" />
        <rect x="6.8" y="21" width="3.4" height="9" class="m3" />
        <rect x="53.8" y="21" width="3.4" height="9" class="m3" />
        <path d="M6 25 L24 28 L24 35 L6 31 Z" fill="url(#~M)" />
        <path d="M58 25 L40 28 L40 35 L58 31 Z" fill="url(#~M)" />
        <ellipse cx="8.5" cy="20" rx="8.5" ry="2.4" class="e" />
        <ellipse cx="55.5" cy="20" rx="8.5" ry="2.4" class="e" />
        <rect x="29.2" y="40" width="5.6" height="14" rx="1.6" fill="url(#~A)" />
        <rect x="27.8" y="51" width="8.4" height="4.4" rx="1.6" class="m1" />
        <path d="M32 18 L32 9" class="ln2" />
        <circle cx="32" cy="8" r="2.4" class="e" />
        <circle cx="32" cy="30" r="13" fill="url(#~M)" />
        <path d="M19 30 A13 13 0 0 0 45 30 Z" class="sh" />
        <circle cx="32" cy="30" r="8" class="m4" />
        <circle cx="32" cy="30" r="5.6" fill="url(#~G)" />
        <circle cx="32" cy="30" r="2.6" class="g" />
        <path d="M22 24 A11.5 11.5 0 0 1 31 18.6" class="hs" />`,
    cloak: `
        <path d="M32 4 L16 36 L9 56 L25 45 L32 50 Z" fill="url(#~A)" />
        <path d="M32 4 L16 36 L9 56 L12.5 47 L19 36.5 L32 12 Z" class="hl" />
        <path d="M32 16 L26 32 L32 37 Z" class="m4" />
        <path d="M32 4 L48 36 L55 56 L39 45 L32 50" class="l2" stroke-dasharray="3.5 3" />
        <rect x="33.5" y="17" width="4" height="4" class="e" />
        <rect x="35" y="25" width="5" height="5" class="a2" />
        <rect x="41.5" y="31" width="3.5" height="3.5" class="e" />
        <rect x="34" y="35" width="4.5" height="4.5" class="a2" opacity="0.8" />
        <rect x="42" y="39.5" width="4" height="4" class="a2" opacity="0.6" />
        <rect x="48.5" y="45" width="3" height="3" class="e" opacity="0.7" />
        <rect x="51" y="33" width="2.6" height="2.6" class="a2" opacity="0.5" />
        <rect x="56" y="40" width="2.2" height="2.2" class="a2" opacity="0.4" />
        <rect x="46" y="22" width="2.4" height="2.4" class="a2" opacity="0.45" />
        <rect x="58" y="50" width="2" height="2" class="a2" opacity="0.3" />`,
    dilator: `
        <rect x="27.5" y="0" width="9" height="7" rx="1.8" class="m2" />
        <circle cx="32" cy="33" r="27" fill="url(#~M)" />
        <circle cx="32" cy="33" r="21.5" class="m4" />
        <path d="M32 33 L32 11.5 A21.5 21.5 0 0 1 50.6 43.75 Z" class="a2" opacity="0.28" />
        <path d="M32 33 L42 15.7" class="l2" opacity="0.35" />
        <path d="M32 33 L50 27" class="l2" opacity="0.55" />
        <g transform="translate(0 1)">${spin([0, 90, 180, 270], '<rect x="30.8" y="12.5" width="2.4" height="5.5" rx="1" class="a1" />')}${spin([30, 60, 120, 150, 210, 240, 300, 330], '<rect x="31.3" y="12.5" width="1.4" height="3.4" rx="0.7" class="m2" />')}</g>
        <path d="M32 33 L47.5 42" class="l" />
        <path d="M32 33 L32 16" class="lw" />
        <circle cx="32" cy="33" r="3.2" class="g" />
        <path d="M12 22 A23.5 23.5 0 0 1 31 9.6" class="hs" />`,

    // ─── Relic mods: emblems that still read at 18px ────────────────────────
    chain: `
        <path d="M37 2 L12 35 L27 35 L20 62 L52 25 L35.5 25 Z" fill="url(#~A)" />
        <path d="M33.5 13 L20 31 L31.5 31 L27 48 L43.5 29 L30.5 29 Z" class="g" />`,
    burn: `
        <path d="M32 2 C36 15 52 22 52 41 A20 20 0 0 1 12 41 C12 30 19 26 21 15 C27 20 29 23 32 2 Z" fill="url(#~A)" />
        <path d="M32 22 C35 30 44 35 44 45 A12 12 0 0 1 20 45 C20 38 25 36 27 29 C30 33 31 31 32 22 Z" class="a1" />
        <path d="M32 39 C34 43 38 45 38 50 A6 6 0 0 1 26 50 C26 45 30 44 32 39 Z" class="g" />`,
    overcharge: `
        <rect x="23" y="2" width="18" height="9" rx="2.5" class="m1" />
        <rect x="10" y="9" width="44" height="53" rx="6" fill="url(#~M)" />
        <rect x="15" y="14" width="34" height="43" rx="3" class="m4" />
        <rect x="18.5" y="44.5" width="27" height="9" rx="1.8" class="a3" />
        <rect x="18.5" y="31" width="27" height="9" rx="1.8" class="a2" />
        <rect x="18.5" y="17.5" width="27" height="9" rx="1.8" class="a1" />
        <path d="M36 12 L21 37 L30.5 37 L27 59 L44 31 L34 31 Z" class="g" />`,
    frost: `
        ${spin([0, 60, 120], '<path d="M32 3 L32 61 M32 12 L25 5 M32 12 L39 5 M32 52 L25 59 M32 52 L39 59 M32 21 L26.5 15.5 M32 21 L37.5 15.5 M32 43 L26.5 48.5 M32 43 L37.5 48.5" class="l" />')}
        <path d="M32 23.5 L39.4 27.8 L39.4 36.2 L32 40.5 L24.6 36.2 L24.6 27.8 Z" class="g" />`,
    prism: `
        <path d="M0 40 L24 33" class="lw" />
        <path d="M38 30 L64 19" class="l" stroke-opacity="0.55" />
        <path d="M40 34.5 L64 33" class="l" />
        <path d="M40 39 L64 48" class="l" stroke-opacity="0.75" />
        <path d="M32 5 L58 53 L6 53 Z" class="a4" />
        <path d="M32 5 L58 53 L6 53 Z" fill="url(#~G)" />
        <path d="M32 5 L32 53 L6 53 Z" class="hl" />
        <path d="M32 5 L58 53 L6 53 Z" class="l" />`,
    reactive: `
        <path d="M32 3 L57 17.5 L57 46.5 L32 61 L7 46.5 L7 17.5 Z" fill="url(#~M)" />
        <path d="M32 9.5 L51.4 20.8 L51.4 43.2 L32 54.5 L12.6 43.2 L12.6 20.8 Z" class="m4" />
        <path d="M32 12 L36 25 L48 18 L41 30 L54 32 L41 35 L47 47 L36 40 L32 53 L28 40 L17 47 L23 35 L10 32 L23 30 L16 18 L28 25 Z" class="e" />
        <circle cx="32" cy="32" r="5.5" class="g" />`,
    nanoweave: `
        <path d="M32 3 L57 17.5 L57 46.5 L32 61 L7 46.5 L7 17.5 Z" class="a4" />
        <path d="M19.5 10.3 L57 32 M7 24 L51 49.5 M7 38 L38 56 M32 3 L57 17.5 M44.5 10.3 L7 32 M57 24 L13 49.5 M57 38 L26 56" class="l3" />
        <path d="M32 3 L57 17.5 L57 46.5 L32 61 L7 46.5 L7 17.5 Z" class="l" />
        <path d="M28 18 L36 18 L36 28 L46 28 L46 36 L36 36 L36 46 L28 46 L28 36 L18 36 L18 28 L28 28 Z" class="g" />`,
    surge: `
        <circle cx="32" cy="32" r="25" class="o" />
        <path d="M32 7 A25 25 0 0 1 32 57" class="l5" />
        <path d="M35.5 12 L19 35 L29.5 35 L26 53 L45 28 L33.5 28 Z" fill="url(#~A)" />
        <path d="M33.5 19 L25 32 L32.5 32 L30 44 L39.5 31 L32 31 Z" class="g" />`,
    static: `
        <circle cx="32" cy="32" r="27" class="o" stroke-dasharray="10 7" />
        <circle cx="32" cy="32" r="17" class="o" />
        <circle cx="32" cy="32" r="12" fill="url(#~G)" />
        <circle cx="32" cy="32" r="6" class="g" />
        ${spin([0, 90, 180, 270], '<path d="M32 13 L29 8 L35 6 L32 1" class="lw" />')}`
}

export const VOID_ITEM_ART_FALLBACK = `
    <rect x="9" y="9" width="46" height="46" rx="8" fill="url(#~M)" />
    <rect x="15" y="15" width="34" height="34" rx="5" class="m4" />
    <circle cx="32" cy="32" r="11" fill="url(#~G)" />
    <circle cx="32" cy="32" r="5" class="g" />`
