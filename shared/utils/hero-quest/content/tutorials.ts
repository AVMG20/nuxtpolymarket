/**
 * The guide's lines (`tutorials.ts`). **Mossimer** is a snail who keeps the Chronicle: every run
 * any hero has made toward the Void is written into the turns of its shell. When a run is beaten
 * the Void folds the world back to Thornwick Vale and forgets it ever happened, but a snail carries
 * everything it owns, so the Chronicle comes through every prestige intact. That is why it can
 * guide you: it has watched this road walked more times than anyone. Unhurried, warm, a little
 * wry about its pace (the user's call on a snail, 2026-10-09; the name and lore, 2026-10-09).
 *
 * Each tutorial is a few short pages, read one at a time. Nothing numeric is written into a line, so
 * a retuned constant can't leave the guide saying the old number.
 *
 * Display only: saves reference the tutorial IDs, never the text.
 */

import type { TutorialId } from '../tutorials'

/** Display only, so a rename touches no save. */
export const GUIDE_NAME = 'Mossimer'

export const TUTORIAL_PAGES: Readonly<Record<TutorialId, readonly string[]>> = {
    'intro': [
        'Ah, a new hero. I\'m Mossimer, keeper of the Chronicle. Don\'t mind the pace.',
        'Every hero who ever marched on the Void is written in my shell. You\'re next.',
        'Your party fights on its own, even while you\'re away. Come back and collect.',
        'Bosses are different. They only fight while you\'re watching. Glory wants a witness.',
        'Off you go, then. I\'ll catch up. Eventually.'
    ],

    'loss_reminder': [
        'Knocked back again? No shame in it. I\'ve lost a race or two myself.',
        'Pull at the Gacha, then equip what you find in Collections. Bosses hate that.'
    ],

    'gacha:unlock': ['Knocked flat? Happens to the best of us. Time to find some help: the Gacha is now available.'],
    'gacha:visit': [
        'Four shrines, four gachas: Gear, Champions, Skills and Artifacts.',
        'Feed one Seals and it gives something back. Some days, something wonderful.',
        'A few free 10-pulls come round each day. Short on Seals? A pull buys them with Gold.',
        'Every pull levels its gacha up, and a higher level brings rarer rewards.'
    ],

    'collections:unlock': ['Everything you pull is kept in your Collections. I do like a tidy hoard.'],
    'collections:visit': [
        'Equip Gear, Skills and Artifacts here, and choose which Champions march with you.',
        'A duplicate levels up the copy you own. In my experience, nothing is ever wasted.',
        'Even what you leave on the shelf lends you a little strength.'
    ],

    'milestones:unlock': ['A whole World cleared! That earns a line in the Chronicle. Milestones are now available.'],
    'milestones:visit': [
        'Every deed worth writing down is counted here: Worlds, prestiges, raids, collections.',
        'The tracks never end and nothing expires. Claim whenever you like. I never rush.'
    ],

    'calendar:unlock': ['The Calendar is now available. Visit once a day and I\'ll have something for you.'],
    'calendar:visit': [
        'One gift a day, and the cycle builds to a grand one at the end.',
        'Missed a day? It happens to the best of us. A few make-ups a cycle let you claim late.'
    ],

    'loadouts:unlock': ['Two Worlds behind you. Time to plan ahead: Loadouts are now available.'],
    'loadouts:visit': [
        'A Loadout saves your party, formation, Skills, Artifacts and Gear.',
        'Keep one for waves and one for bosses. Saving is free, and swapping is one tap.'
    ],

    'speed:unlock': ['Battle Speed is now available, in the Shop. I\'ve never tried it myself, but I hear it\'s thrilling.'],
    'speed:visit': [
        'Spend Gems on a stretch of faster battles.',
        'It keeps running while you\'re away. Take it from a snail: speed is precious.'
    ],

    'tree:unlock': ['Three Worlds behind you, and every level you\'ve earned is worth a point. The Passive Tree is now available.'],
    'tree:visit': [
        'Every level your Hero gains is a point to spend here, and levels never go away.',
        'Start at the root and grow outward. A node opens once the one before it holds a level.',
        'The three paths follow the class lines. Their class nodes only work while your Hero walks that line.',
        'Each path ends in a node with no cap. Spend there once the rest is full.',
        'Changed your mind? Every prestige brings a free respec. Any other time, it costs Gems.'
    ],

    'raids:unlock': ['Four Worlds cleared, and something big has noticed you. Raids are now available.'],
    'raids:visit': [
        'Five great beasts wait in the raids, each with a trick of its own.',
        'Each reward costs a Key, and Keys come back every day.',
        'Beat a level to open the next, and quick-clear your best whenever you like.',
        'Raids pay Seals, and the Trait raid pays Trait Gems. A higher level pays more.'
    ],

    'traits:unlock': ['The Trait raid pays in Trait Gems, and here is where they go. Traits are now available.'],
    'traits:visit': [
        'Five slots, each a bonus for the whole party. Roll them with Trait Gems.',
        'A Roll rerolls every slot you haven\'t locked. Locking is free, but each lock makes the next Roll dearer.',
        'Match Sets across slots for a bonus of their own.',
        'Save a good board to come back to. Even I write the best ones down.'
    ],

    'arena:unlock': ['Five Worlds cleared, and word of you has spread. Other heroes want a turn. The Arena is now available.'],
    'arena:visit': [
        'Heroes fight each other here. Not in person, mind: you fight their defence, and they fight yours.',
        'So set your current loadout as your defence first. It holds the gate while you\'re away.',
        'Win and your Rating climbs; lose, even defending, and it slips. You\'re matched with heroes near it.',
        'Every fight pays Medals, a win more. The Arena Shop takes them for Seals, Keys and Gems.',
        'A few free attacks a day, and a couple of free refreshes. Pick the loadout you fight with below.',
        'Each season ends with rewards by rank. I write down every result. I have the shell space.'
    ],

    'shop:unlock': ['Your first boss down! A merchant has set up shop. The Shop is now available.'],
    'shop:visit': [
        'The Shop sells upgrades that last through everything, even the Void.',
        'Offline Efficiency is the best buy here: it raises what you earn while you\'re away.',
        'Take it from a snail, the time away adds up. Offline Cap keeps it counting longer.',
        'The rest is paid in Void Shards, and only the Void pays those.'
    ],

    'classes:unlock': ['You beat the Void, and here is your first class token! Classes are now available.'],
    'classes:visit': [
        'The secret of the Chronicle: the Void is never gone. It folds the world back up, on a harder road.',
        'Your Hero keeps every level, and the Void pays in Shards. Spend them in the Shop.',
        'The Void forgets every run. I don\'t. A snail carries everything it owns.',
        'A token takes your class one step deeper down the tree.',
        'Switching back to a class you\'ve had is always free.',
        'Prestige once as every master, and something waits at the end. Even I\'ve only heard of it.'
    ]
}
