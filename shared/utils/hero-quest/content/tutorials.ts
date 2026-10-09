/**
 * The guide's lines (`tutorials.ts`): a snail familiar who tags along with the party, unhurried and
 * a little wry, which suits a game that plays on while you're away (the user's call, 2026-10-09).
 *
 * Each tutorial is a few short pages, read one at a time. Nothing numeric is written into a line, so
 * a retuned constant can't leave the guide saying the old number.
 *
 * Display only: saves reference the tutorial IDs, never the text.
 */

import type { TutorialId } from '../tutorials'

/** A working name, display only (2026-10-09). */
export const GUIDE_NAME = 'Shellby'

export const TUTORIAL_PAGES: Readonly<Record<TutorialId, readonly string[]>> = {
    'intro': [
        'Oh, hello. I\'m Shellby. I\'ll tag along, at my own pace.',
        'Your party fights on its own, even while you\'re away. Come back and collect.',
        'Bosses wait for you, though. They only fight while you\'re watching.'
    ],

    'gacha:unlock': ['That boss was guarding something. The Gacha is open!'],
    'gacha:visit': [
        'Four gachas: Gear, Champions, Skills and Artifacts.',
        'A pull costs Seals. A few free 10-pulls come round every day.',
        'Short on Seals? A pull buys what it needs with Gold.'
    ],

    'collections:unlock': ['Whatever you pull lands in your Collections.'],
    'collections:visit': [
        'Equip Gear, Skills and Artifacts here, and field your Champions.',
        'A duplicate levels up the copy you own. Nothing is wasted.',
        'Even unequipped, everything you own helps a little.'
    ],

    'milestones:unlock': ['A whole World cleared! That deserves a trophy. Milestones are open.'],
    'milestones:visit': [
        'Every feat pays here: Worlds, prestiges, raid levels, collections.',
        'They never run out. Claim whenever you like. No hurry.'
    ],

    'calendar:unlock': ['The Calendar is open: a gift for every day you stop by.'],
    'calendar:visit': [
        'One reward a day, and the cycle climbs to a big one at the end.',
        'Missed a day? A few make-ups a cycle let you claim it late.'
    ],

    'loadouts:unlock': ['Loadouts are open. Save a party, swap it back in one tap.'],
    'loadouts:visit': [
        'A Loadout saves your party, formation, Skills, Artifacts and Gear.',
        'Keep one for waves and one for bosses. Saving costs nothing.'
    ],

    'speed:unlock': ['Battle Speed is open. Even I could go faster.'],
    'speed:visit': [
        'Spend Gems on a block of faster battles.',
        'It keeps running while you\'re away. Take it from a snail: worth it.'
    ],

    'raids:unlock': ['Raids are open: five big bosses, each with a trick.'],
    'raids:visit': [
        'Each raid costs a Key. Keys come back every day.',
        'Beat a level to open the next. Quick-clear your best any time.',
        'Raids pay Seals, and the Trait raid pays Trait Gems.'
    ],

    'traits:unlock': ['Traits are open: five slots of bonus stats for the whole party.'],
    'traits:visit': [
        'A Roll rerolls every slot you haven\'t locked, for Trait Gems.',
        'Locking is free, but each lock makes the next Roll pricier.',
        'Match Sets across slots for extra bonuses. Save a good board to come back to.'
    ],

    'prestige:unlock': ['You beat the whole run! Prestige is open.'],
    'prestige:visit': [
        'Prestige starts the run over, harder, for Void Shards.',
        'Your Hero keeps his level. Spend the Shards in the shop here.',
        'Every prestige grants a class token, too.'
    ],

    'classes:unlock': ['Your first class token! Classes are open.'],
    'classes:visit': [
        'A token takes your class one step deeper down the tree.',
        'Switching back to a class you\'ve had is always free.',
        'Prestige once as every master, and something waits at the end.'
    ]
}
