/**
 * Company names: cleaning a player-supplied name and telling names apart that only look different.
 * Fixed code point tables only, so every peer reaches the same answer.
 */

import { clampUtf8 } from './bytes'
import { RT_CATALOG } from './catalog'

/** Characters that draw nothing, so two names that differ only by them look the same. */
function invisibleChar(code: number): boolean {
    return code === 0xad || code === 0x34f || code === 0x61c || code === 0x115f || code === 0x1160 || code === 0x17b4
        || code === 0x17b5 || code === 0x180e || code === 0x3164 || code === 0xfeff || code === 0xffa0
        || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2060 && code <= 0x206f)
        || (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0000 && code <= 0xe0fff)
}

/**
 * A player-supplied company name made safe to store: anything but a string is empty; control and
 * invisible characters are dropped, runs of whitespace become one space, and lone surrogates become
 * U+FFFD (so the UTF-8 save round-trips the name exactly and the hash agrees); whitespace is trimmed;
 * the result is clamped to RT_CATALOG.caps.maxNameBytes of UTF-8. May return ''; the caller supplies a
 * default.
 */
export function rtCleanCompanyName(name: unknown): string {
    if (typeof name !== 'string') return ''
    let clean = ''
    for (const char of name) {
        const code = char.codePointAt(0)!
        if (code < 0x20 || (code >= 0x7f && code < 0xa0) || invisibleChar(code)) continue
        if (char.trim() === '') {
            if (clean !== '' && !clean.endsWith(' ')) clean += ' '
            continue
        }
        clean += code >= 0xd800 && code <= 0xdfff ? '�' : char
        // stop early on hostile input: the clamp keeps at most maxNameBytes anyway
        if (clean.length > RT_CATALOG.caps.maxNameBytes * 2) break
    }
    return clampUtf8(clean.trim(), RT_CATALOG.caps.maxNameBytes).trim()
}

/** Letters and digits drawn like a Latin one, by code point: Greek and Cyrillic capitals and small letters, and I, 1, |, 0. */
const LOOKALIKES: Readonly<Record<number, string>> = Object.freeze({
    0x49: 'l', 0x31: 'l', 0x7c: 'l', 0x30: 'o',
    0x391: 'a', 0x392: 'b', 0x395: 'e', 0x396: 'z', 0x397: 'h', 0x399: 'l', 0x39a: 'k', 0x39c: 'm', 0x39d: 'n',
    0x39f: 'o', 0x3a1: 'p', 0x3a4: 't', 0x3a5: 'y', 0x3a7: 'x', 0x3b1: 'a', 0x3b5: 'e', 0x3b9: 'i', 0x3ba: 'k',
    0x3bd: 'v', 0x3bf: 'o', 0x3c1: 'p', 0x3c4: 't', 0x3c5: 'u', 0x3c7: 'x',
    0x405: 's', 0x406: 'l', 0x408: 'j', 0x410: 'a', 0x412: 'b', 0x415: 'e', 0x41a: 'k', 0x41c: 'm', 0x41d: 'h',
    0x41e: 'o', 0x420: 'p', 0x421: 'c', 0x422: 't', 0x423: 'y', 0x425: 'x', 0x430: 'a', 0x435: 'e', 0x43e: 'o',
    0x440: 'p', 0x441: 'c', 0x443: 'y', 0x445: 'x', 0x455: 's', 0x456: 'i', 0x458: 'j', 0x501: 'd', 0x51b: 'q', 0x51d: 'w'
})

/**
 * What a company name looks like: look-alike letters become the Latin one they pass for, ASCII is
 * lower-cased, spaces are dropped and rn reads as m. Two names with the same skeleton are one name to
 * a reader, so a company may not take another's.
 */
export function rtNameSkeleton(name: string): string {
    let out = ''
    for (const char of name) {
        const code = char.codePointAt(0)!
        const lookalike = LOOKALIKES[code]
        if (lookalike !== undefined) out += lookalike
        else if (code >= 0x41 && code <= 0x5a) out += String.fromCharCode(code + 0x20)
        else if (code !== 0x20) out += char
    }
    return out.replaceAll('rn', 'm')
}

/** The name a company gets when its player supplied none. */
export function rtDefaultCompanyName(id: number): string {
    return `Company ${id + 1}`
}
