import type { DfAttachmentChoice, DfAttachmentId, DfAttachmentSlot, DfWeaponClass, DfWeaponId } from './types'

// Weapon definitions, attachments, Pack-a-Punch tiers and weapon levels for
// Dead Front. Owned by the weapons agent; the exported API (names and
// signatures) is a contract with the server simulation, the client engine and
// the menus.
//
// Stat resolution (`dfWeaponStats`): base stats -> Pack-a-Punch tier -> attachments.
//
//   1. Base: the weapon's tier-0 stats (`BASE`).
//   2. Pack-a-Punch (pap 1..3): every tier first applies the generic scaling
//      (`PAP_SCALE`: damage, magazine, reserve, reload, recoil, rate, range), then the
//      weapon's own tier overrides (`PAP_OVERRIDES`) are assigned as absolute
//      values. Overrides are cumulative: tier 2 starts from tier 1's overrides.
//   3. Attachments: every chosen attachment's `mods` are folded in. For the
//      additive fields (`DF_ADDITIVE_MODS`: pellets, penetration, chains) the
//      mod values are summed and added; every other numeric field is
//      multiplied by the product of all the mods that touch it. Integer
//      fields are rounded at the end (`magSize`, `reserve`, `pellets` >= 1;
//      `penetration`, `chains` >= 0). Unknown, locked or mismatched
//      attachments are ignored here; menus and the server sanitise choices
//      with `dfSanitizeAttachments` first.

export type DfFireMode = 'semi' | 'auto' | 'bolt' | 'pump' | 'beam'

/** How a shot resolves on the server. */
export type DfShotKind = 'hitscan' | 'grenade' | 'xray-bolt' | 'arc'

export interface DfWeaponStats {
    name: string // display name at this PaP tier
    fireMode: DfFireMode
    shot: DfShotKind
    damage: number // per bullet / pellet before zone multipliers
    headMult: number
    limbMult: number
    rpm: number
    pellets: number
    magSize: number
    reserve: number // max reserve ammo
    reloadTime: number // seconds, tactical
    reloadEmptyTime: number // seconds, from empty
    /** Shotguns and bolt actions load per round: time per shell. 0 = magazine reload. */
    perRoundReload: number
    range: number // metres of full damage
    maxRange: number // metres where damage reaches `minDamageMult`
    minDamageMult: number
    penetration: number // extra zombies a bullet can pass through
    hipSpread: number // radians
    adsSpread: number
    adsTime: number // seconds
    adsZoom: number // FOV divisor while aiming (1.2 irons, 2.5+ scopes)
    moveMult: number // movement speed while held
    recoil: number // camera kick per shot, radians
    splashRadius: number // explosive / bolt splash, 0 for none
    splashDamage: number
    projectileSpeed: number // m/s for projectile weapons
    /** Wunderweapon: number of chain jumps. */
    chains: number
}

type DfNumericStat = { [K in keyof DfWeaponStats]: DfWeaponStats[K] extends number ? K : never }[keyof DfWeaponStats]

export interface DfAttachmentDef {
    id: DfAttachmentId
    slot: DfAttachmentSlot
    name: string
    description: string
    /** Weapon level that unlocks it (2..5). */
    level: number
    /**
     * Applied on top of the weapon's PaP-tier stats. Fields in
     * `DF_ADDITIVE_MODS` (pellets, penetration, chains) add; every other
     * field multiplies. Several attachments touching one field stack the
     * same way (sum / product). See the header of this file.
     */
    mods: Partial<Record<DfNumericStat, number>>
}

export interface DfWeaponDef {
    id: DfWeaponId
    name: string
    class: DfWeaponClass
    year: number // era flavour shown in the armory
    description: string
    /** Wall-buy price; undefined = not on the wall. */
    wallCost?: number
    /** Ammo refill price at the wall. */
    ammoCost?: number
    inBox: boolean
    /** Can be picked as the loadout start weapon once unlocked. */
    startable: boolean
    /** Names for PaP tiers 1..3. */
    papNames: [string, string, string]
    attachments: DfAttachmentDef[]
}

/** Attachment mod fields that add instead of multiply. */
export const DF_ADDITIVE_MODS: readonly DfNumericStat[] = ['pellets', 'penetration', 'chains']

export const DF_WEAPON_IDS: DfWeaponId[] = ['m1911', 'c96', 'm1897', 'kar98k', 'thompson', 'mp18', 'ppsh', 'bar', 'lewis', 'xray', 'wunder']

/** Pack-a-Punch camo colours per tier 1..3 (violet, crimson, gold). */
export const DF_PAP_COLORS: [string, string, string] = ['#a04dff', '#ff2a45', '#ffc23a']

const att = (id: string, slot: DfAttachmentSlot, name: string, level: number, description: string, mods: DfAttachmentDef['mods']): DfAttachmentDef =>
    ({ id, slot, name, level, description, mods })

export const DF_WEAPONS: Record<DfWeaponId, DfWeaponDef> = {
    m1911: {
        id: 'm1911',
        name: 'M1911',
        class: 'pistol',
        year: 1911,
        description: 'The Colt service pistol every soldier on the line carries. Seven .45 rounds of stopping power and one in the pipe.',
        inBox: false,
        startable: true,
        papNames: ['Brimstone Brothers', 'Brimstone Furies', 'Brimstone Eternal'],
        attachments: [
            att('m1911-reddot', 'optic', 'Red Dot Sight', 2, 'A slim open reflex sight with a glowing red dot. Aim with both eyes open: tighter aimed and hip fire, a beat slower to line up.', { adsSpread: 0.7, hipSpread: 0.9, adsTime: 1.06 }),
            att('m1911-maxim', 'muzzle', 'Maxim Silencer', 3, 'A threaded Maxim can. Soft-shooting and steady, and the clean report rewards headshots (+20%), but it bleeds a little punch and reach.', { recoil: 0.78, hipSpread: 0.9, damage: 0.92, range: 0.85, maxRange: 0.9, headMult: 1.2 }),
            att('m1911-cutts', 'muzzle', 'Cutts Compensator', 3, 'A slotted brake that keeps the muzzle down for quick follow-ups. Loud, and the blast widens the hip cone.', { recoil: 0.72, hipSpread: 1.1 }),
            att('m1911-extended', 'magazine', 'Extended Magazine', 4, 'A twelve-round trench magazine. More rounds, a slower swap.', { magSize: 1.5, reserve: 1.2, reloadTime: 1.12, reloadEmptyTime: 1.12 }),
            att('m1911-grips', 'stock', 'Checkered Walnut Grips', 5, 'Hand-checkered grips that tame the kick, at the cost of a slower draw to the sights.', { recoil: 0.8, hipSpread: 0.85, adsTime: 1.08 })
        ]
    },
    c96: {
        id: 'c96',
        name: 'C96 Broomhandle',
        class: 'pistol',
        year: 1896,
        description: 'Mauser\'s broomhandle: a long barrel, a fixed ten-round magazine fed by stripper clip and a bite well beyond its size.',
        inBox: true,
        startable: true,
        papNames: ['Witch\'s Broom', 'Hexenbesen', 'Broom of Ages'],
        attachments: [
            att('c96-reddot', 'optic', 'Red Dot Sight', 2, 'A slim open reflex sight bolted over the receiver. Tighter aimed and hip fire, a beat slower to line up.', { adsSpread: 0.68, hipSpread: 0.9, adsTime: 1.08 }),
            att('c96-maxim', 'muzzle', 'Maxim Silencer', 3, 'A threaded Maxim can on the long barrel. Soft-shooting and steady, with +20% headshot damage, but it bleeds some punch and reach.', { recoil: 0.8, damage: 0.93, range: 0.88, maxRange: 0.92, headMult: 1.2 }),
            att('c96-cutts', 'muzzle', 'Cutts Compensator', 3, 'Slotted brake that keeps the muzzle down. Loud, and the blast widens the hip cone.', { recoil: 0.68, hipSpread: 1.12 }),
            att('c96-box', 'magazine', '20-Round Box Magazine', 4, 'A detachable box magazine in place of stripper clips. Twice the rounds, heavier in hand.', { magSize: 2, reserve: 1.2, reloadTime: 1.1, reloadEmptyTime: 1.05, moveMult: 0.97 }),
            att('c96-holster', 'stock', 'Shoulder-Stock Holster', 5, 'The walnut holster clipped on as a stock. Rock-steady aim, clumsy from the hip.', { recoil: 0.58, adsSpread: 0.6, hipSpread: 1.15, adsTime: 1.2, moveMult: 0.96 })
        ]
    },
    m1897: {
        id: 'm1897',
        name: 'M1897 Trench Gun',
        class: 'shotgun',
        year: 1897,
        description: 'Winchester\'s pump gun with a ventilated heat shield and a bayonet lug. Six shells of buckshot, loaded one by one.',
        wallCost: 1500,
        ammoCost: 750,
        inBox: true,
        startable: true,
        papNames: ['Gravedigger', 'Grave Monarch', 'Grave Emperor'],
        attachments: [
            att('m1897-bead', 'optic', 'Ivory Bead Sight', 2, 'A bright ivory bead. Tighter aimed patterns, a touch slower to the shoulder.', { adsSpread: 0.8, hipSpread: 0.95, adsTime: 1.08 }),
            att('m1897-reddot', 'optic', 'Red Dot Sight', 3, 'A slim open reflex sight over the receiver. Quicker, tighter patterns both from the hip and aimed, a touch slower to the shoulder.', { adsSpread: 0.78, hipSpread: 0.9, adsTime: 1.06 }),
            att('m1897-choke', 'muzzle', 'Full Choke', 3, 'Squeezes the pattern for reach, but one pellet less and a little less bite per pellet.', { hipSpread: 0.7, adsSpread: 0.68, range: 1.4, maxRange: 1.3, damage: 0.95, pellets: -1 }),
            att('m1897-tube', 'magazine', 'Extended Tube', 4, 'A magazine tube to the muzzle: eight shells, a heavier gun.', { magSize: 1.34, reserve: 1.15, moveMult: 0.96, adsTime: 1.1 }),
            att('m1897-sawn', 'stock', 'Sawn-Off Stock', 5, 'Cut down to a grip. Quick to swing and aim, kicks like a mule.', { moveMult: 1.06, adsTime: 0.8, recoil: 1.3, hipSpread: 1.1 })
        ]
    },
    kar98k: {
        id: 'kar98k',
        name: 'Kar98k',
        class: 'rifle',
        year: 1935,
        description: 'The Mauser bolt-action carbine. Five rounds by stripper clip, each one enough to drop a man at any range.',
        wallCost: 200,
        ammoCost: 100,
        inBox: true,
        startable: true,
        papNames: ['Iron Verdict', 'Iron Requiem', 'Iron Absolution'],
        attachments: [
            att('kar98k-maxim', 'muzzle', 'Maxim Silencer', 2, 'A long Maxim can. Softer kick and +20% headshot damage, at a little damage and reach.', { recoil: 0.85, damage: 0.92, range: 0.88, maxRange: 0.92, headMult: 1.2 }),
            att('kar98k-scope', 'optic', 'Telescopic Sight', 3, 'A Zeiss 4x telescope. Deep zoom and pinpoint aim, slower to raise, worse from the hip.', { adsZoom: 2.3, adsTime: 1.5, adsSpread: 0.5, hipSpread: 1.2, moveMult: 0.97 }),
            att('kar98k-trench', 'magazine', 'Trench Magazine', 4, 'The 20-round detachable trench magazine. Fewer clip reloads, a much heavier rifle.', { magSize: 4, reserve: 1.2, reloadTime: 1.12, reloadEmptyTime: 1.05, moveMult: 0.94, adsTime: 1.15 }),
            att('kar98k-light', 'stock', 'Lightened Stock', 5, 'A stock drilled out for weight. Faster to aim and to move with, more kick.', { moveMult: 1.05, adsTime: 0.85, recoil: 1.25 })
        ]
    },
    thompson: {
        id: 'thompson',
        name: 'M1921 Thompson',
        class: 'smg',
        year: 1921,
        description: 'The trench broom. A fast-cycling .45 submachine gun with finned barrel and twin walnut grips.',
        wallCost: 1200,
        ammoCost: 600,
        inBox: true,
        startable: true,
        papNames: ['Chicago Choir', 'Crimson Choir', 'Gilded Choir'],
        attachments: [
            att('thompson-reddot', 'optic', 'Red Dot Sight', 2, 'A slim open reflex sight over the receiver. Tighter aimed and hip fire, a beat slower to aim.', { adsSpread: 0.7, hipSpread: 0.9, adsTime: 1.08 }),
            att('thompson-maxim', 'muzzle', 'Maxim Silencer', 3, 'A Maxim can on the finned barrel. Steadier bursts and +20% headshot damage, but less reach and punch.', { recoil: 0.82, damage: 0.93, range: 0.88, maxRange: 0.92, headMult: 1.2 }),
            att('thompson-cutts', 'muzzle', 'Cutts Compensator', 3, 'Keeps the climb in check. The blast widens hip fire a little.', { recoil: 0.7, hipSpread: 1.1, range: 0.95 }),
            att('thompson-drum', 'magazine', '50-Round Drum', 4, 'The famous drum magazine. Fifty rounds, slower to swap and heavier to carry.', { magSize: 1.67, reserve: 1.25, reloadTime: 1.3, reloadEmptyTime: 1.22, moveMult: 0.95, adsTime: 1.1 }),
            att('thompson-light', 'stock', 'Lightened Stock', 5, 'A slimmer butt. Quicker on your feet and to the sights, more recoil.', { moveMult: 1.05, adsTime: 0.85, recoil: 1.2 })
        ]
    },
    mp18: {
        id: 'mp18',
        name: 'MP18',
        class: 'smg',
        year: 1918,
        description: 'Bergmann\'s storm-trooper gun: a perforated jacket, a side-fed magazine and a steady, controllable rate.',
        wallCost: 1000,
        ammoCost: 500,
        inBox: true,
        startable: true,
        papNames: ['Bergmann\'s Bane', 'Bergmann\'s Wrath', 'Bergmann\'s Ruin'],
        attachments: [
            att('mp18-reddot', 'optic', 'Red Dot Sight', 2, 'A slim open reflex sight on the receiver. Tighter aimed and hip fire, a little slower to aim.', { adsSpread: 0.72, hipSpread: 0.92, adsTime: 1.08 }),
            att('mp18-maxim', 'muzzle', 'Maxim Silencer', 3, 'Soft, steady bursts and +20% headshot damage, but less reach and punch.', { recoil: 0.8, damage: 0.93, range: 0.88, maxRange: 0.92, headMult: 1.2 }),
            att('mp18-snail', 'magazine', '32-Round Snail Drum', 4, 'The Trommelmagazin 08. Thirty-two rounds, slower to swap, heavier.', { magSize: 1.6, reserve: 1.2, reloadTime: 1.25, reloadEmptyTime: 1.18, moveMult: 0.96 }),
            att('mp18-light', 'stock', 'Lightened Stock', 5, 'A slimmer stock. Quicker to move and aim, more kick.', { moveMult: 1.05, adsTime: 0.85, recoil: 1.2 })
        ]
    },
    ppsh: {
        id: 'ppsh',
        name: 'PPSh-41',
        class: 'smg',
        year: 1941,
        description: 'Shpagin\'s stamped-steel buzzsaw: a walnut stock, a slotted jacket with a slanted brake and a 71-round drum it empties in about four seconds.',
        inBox: true,
        startable: true,
        papNames: ['Red Blizzard', 'Red Tempest', 'General Winter'],
        attachments: [
            att('ppsh-reddot', 'optic', 'Red Dot Sight', 2, 'A slim open reflex sight on the top cover. Tighter aimed and hip fire, a beat slower to aim.', { adsSpread: 0.7, hipSpread: 0.9, adsTime: 1.08 }),
            att('ppsh-maxim', 'muzzle', 'Maxim Silencer', 3, 'A Maxim can on the jacket nose. Steadier bursts and +20% headshot damage, but less reach and punch.', { recoil: 0.8, damage: 0.93, range: 0.88, maxRange: 0.92, headMult: 1.2 }),
            att('ppsh-brake', 'muzzle', 'Extended Brake', 3, 'A longer slanted nose that throws the blast up and forward. Much less climb, a little wider from the hip.', { recoil: 0.72, hipSpread: 1.1, range: 0.95 }),
            att('ppsh-box', 'magazine', '35-Round Box Magazine', 4, 'The curved wartime box. Half the rounds, but quick to swap and lighter to carry.', { magSize: 0.493, reloadTime: 0.75, reloadEmptyTime: 0.78, moveMult: 1.03, adsTime: 0.95 }),
            att('ppsh-light', 'stock', 'Cut-Down Stock', 5, 'A shortened walnut butt. Quicker on your feet and to the sights, more climb.', { moveMult: 1.05, adsTime: 0.85, recoil: 1.2 })
        ]
    },
    bar: {
        id: 'bar',
        name: 'M1918 BAR',
        class: 'rifle',
        year: 1918,
        description: 'Browning\'s automatic rifle: full-power .30-06 on full auto from a twenty-round box. Heavy, hard-hitting, hungry.',
        inBox: true,
        startable: true,
        papNames: ['Doughboy\'s Oath', 'Doughboy\'s Fury', 'Doughboy\'s Glory'],
        attachments: [
            att('bar-cutts', 'muzzle', 'Cutts Compensator', 2, 'A slotted brake that holds the muzzle down; the blast widens hip fire.', { recoil: 0.75, hipSpread: 1.1 }),
            att('bar-reddot', 'optic', 'Red Dot Sight', 2, 'A slim open reflex sight over the receiver. Tighter aimed and hip fire, a little slower to aim.', { adsSpread: 0.75, hipSpread: 0.92, adsTime: 1.06 }),
            att('bar-maxim', 'muzzle', 'Maxim Silencer', 3, 'A heavy Maxim can on the Browning. Much softer kick and +20% headshot damage, but less reach and a heavier gun.', { recoil: 0.8, damage: 0.94, range: 0.9, maxRange: 0.92, headMult: 1.2, moveMult: 0.98 }),
            att('bar-scope', 'optic', 'Telescopic Sight', 3, 'A 3x telescope. Real zoom and precise fire, slower to raise.', { adsZoom: 1.9, adsTime: 1.4, adsSpread: 0.6, hipSpread: 1.15 }),
            att('bar-40', 'magazine', '40-Round Magazine', 4, 'An extended box. Twice the rounds, slower to swap, heavier.', { magSize: 2, reserve: 1.2, reloadTime: 1.2, reloadEmptyTime: 1.15, moveMult: 0.95 }),
            att('bar-light', 'stock', 'Cut-Down Stock', 5, 'A shortened butt. Quicker to aim and move, more recoil.', { moveMult: 1.06, adsTime: 0.85, recoil: 1.2 })
        ]
    },
    lewis: {
        id: 'lewis',
        name: 'Lewis Gun',
        class: 'lmg',
        year: 1913,
        description: 'The Belgian rattlesnake: an air-cooled light machine gun with a fat aluminium shroud and a 47-round pan on top.',
        inBox: true,
        startable: true,
        papNames: ['Belgian Rattlesnake', 'Crimson Rattlesnake', 'Rattlesnake Sovereign'],
        attachments: [
            att('lewis-ring', 'optic', 'Ring Sight', 2, 'An anti-aircraft ring sight. Faster to aim and better from the hip, looser when aimed.', { hipSpread: 0.85, adsSpread: 1.15, adsTime: 0.85 }),
            att('lewis-stripped', 'muzzle', 'Stripped Barrel', 3, 'The cooling shroud cut away, aircraft style. Much lighter, wilder.', { moveMult: 1.08, adsTime: 0.85, hipSpread: 1.15, recoil: 1.15 }),
            att('lewis-97', 'magazine', '97-Round Pan', 4, 'The double-deck aircraft pan. Twice the belt, slow to swap, heavy.', { magSize: 2.06, reserve: 1.2, reloadTime: 1.25, reloadEmptyTime: 1.2, moveMult: 0.94 }),
            att('lewis-padded', 'stock', 'Padded Butt', 5, 'A leather-padded butt. Less recoil, a little slower to shoulder.', { recoil: 0.8, adsTime: 1.1 })
        ]
    },
    xray: {
        id: 'xray',
        name: 'X-Ray',
        class: 'special',
        year: 1906,
        description: 'Brass, glass and valves. An impossible pistol from a laboratory nobody admits to, spitting green bolts that burst on impact.',
        inBox: true,
        startable: false,
        papNames: ['Röntgen\'s Revenge', 'Röntgen\'s Fury', 'Röntgen\'s Radiance'],
        attachments: []
    },
    wunder: {
        id: 'wunder',
        name: 'The Voltigeur',
        class: 'special',
        year: 1917,
        description: 'A coil rifle wound from the Arc Generator\'s heart. It throws lightning that leaps from one corpse to the next.',
        inBox: false,
        startable: false,
        papNames: ['Le Grand Voltigeur', 'Voltigeur Tempête', 'Voltigeur Apocalypse'],
        attachments: []
    }
}

type DfBaseStats = Omit<DfWeaponStats, 'name'>

const BASE: Record<DfWeaponId, DfBaseStats> = {
    m1911: {
        fireMode: 'semi', shot: 'hitscan', damage: 62, headMult: 2.8, limbMult: 0.85, rpm: 420, pellets: 1,
        magSize: 8, reserve: 80, reloadTime: 1.45, reloadEmptyTime: 1.85, perRoundReload: 0,
        range: 15, maxRange: 45, minDamageMult: 0.55, penetration: 0, hipSpread: 0.035, adsSpread: 0.008,
        adsTime: 0.16, adsZoom: 1.2, moveMult: 1.05, recoil: 0.024, splashRadius: 0, splashDamage: 0, projectileSpeed: 0, chains: 0
    },
    c96: {
        fireMode: 'semi', shot: 'hitscan', damage: 85, headMult: 3, limbMult: 0.85, rpm: 480, pellets: 1,
        magSize: 10, reserve: 100, reloadTime: 2.3, reloadEmptyTime: 2.6, perRoundReload: 0,
        range: 22, maxRange: 55, minDamageMult: 0.55, penetration: 1, hipSpread: 0.032, adsSpread: 0.007,
        adsTime: 0.18, adsZoom: 1.25, moveMult: 1.03, recoil: 0.028, splashRadius: 0, splashDamage: 0, projectileSpeed: 0, chains: 0
    },
    m1897: {
        fireMode: 'pump', shot: 'hitscan', damage: 42, headMult: 1.5, limbMult: 0.9, rpm: 80, pellets: 8,
        magSize: 6, reserve: 54, reloadTime: 0.55, reloadEmptyTime: 0.55, perRoundReload: 0.55,
        range: 5, maxRange: 20, minDamageMult: 0.15, penetration: 0, hipSpread: 0.1, adsSpread: 0.075,
        adsTime: 0.22, adsZoom: 1.15, moveMult: 0.96, recoil: 0.075, splashRadius: 0, splashDamage: 0, projectileSpeed: 0, chains: 0
    },
    kar98k: {
        fireMode: 'bolt', shot: 'hitscan', damage: 320, headMult: 3.5, limbMult: 0.9, rpm: 50, pellets: 1,
        magSize: 5, reserve: 50, reloadTime: 2.5, reloadEmptyTime: 2.9, perRoundReload: 0,
        range: 60, maxRange: 120, minDamageMult: 0.8, penetration: 2, hipSpread: 0.055, adsSpread: 0.0012,
        adsTime: 0.3, adsZoom: 1.5, moveMult: 0.95, recoil: 0.065, splashRadius: 0, splashDamage: 0, projectileSpeed: 0, chains: 0
    },
    thompson: {
        fireMode: 'auto', shot: 'hitscan', damage: 72, headMult: 2.2, limbMult: 0.8, rpm: 700, pellets: 1,
        magSize: 30, reserve: 240, reloadTime: 2.3, reloadEmptyTime: 2.9, perRoundReload: 0,
        range: 14, maxRange: 40, minDamageMult: 0.5, penetration: 0, hipSpread: 0.045, adsSpread: 0.012,
        adsTime: 0.21, adsZoom: 1.25, moveMult: 1, recoil: 0.017, splashRadius: 0, splashDamage: 0, projectileSpeed: 0, chains: 0
    },
    mp18: {
        fireMode: 'auto', shot: 'hitscan', damage: 64, headMult: 2.3, limbMult: 0.8, rpm: 520, pellets: 1,
        magSize: 20, reserve: 200, reloadTime: 2.1, reloadEmptyTime: 2.7, perRoundReload: 0,
        range: 14, maxRange: 38, minDamageMult: 0.5, penetration: 0, hipSpread: 0.04, adsSpread: 0.011,
        adsTime: 0.19, adsZoom: 1.25, moveMult: 1.02, recoil: 0.013, splashRadius: 0, splashDamage: 0, projectileSpeed: 0, chains: 0
    },
    ppsh: {
        fireMode: 'auto', shot: 'hitscan', damage: 50, headMult: 2.2, limbMult: 0.8, rpm: 1000, pellets: 1,
        magSize: 71, reserve: 284, reloadTime: 2.6, reloadEmptyTime: 3.2, perRoundReload: 0,
        range: 12, maxRange: 36, minDamageMult: 0.5, penetration: 0, hipSpread: 0.05, adsSpread: 0.014,
        adsTime: 0.19, adsZoom: 1.25, moveMult: 1.02, recoil: 0.014, splashRadius: 0, splashDamage: 0, projectileSpeed: 0, chains: 0
    },
    bar: {
        fireMode: 'auto', shot: 'hitscan', damage: 140, headMult: 2.6, limbMult: 0.85, rpm: 450, pellets: 1,
        magSize: 20, reserve: 200, reloadTime: 2.6, reloadEmptyTime: 3.1, perRoundReload: 0,
        range: 40, maxRange: 90, minDamageMult: 0.7, penetration: 1, hipSpread: 0.055, adsSpread: 0.006,
        adsTime: 0.28, adsZoom: 1.4, moveMult: 0.9, recoil: 0.036, splashRadius: 0, splashDamage: 0, projectileSpeed: 0, chains: 0
    },
    lewis: {
        fireMode: 'auto', shot: 'hitscan', damage: 120, headMult: 2.4, limbMult: 0.85, rpm: 550, pellets: 1,
        magSize: 47, reserve: 282, reloadTime: 3.6, reloadEmptyTime: 4.2, perRoundReload: 0,
        range: 35, maxRange: 80, minDamageMult: 0.65, penetration: 1, hipSpread: 0.07, adsSpread: 0.01,
        adsTime: 0.36, adsZoom: 1.3, moveMult: 0.84, recoil: 0.026, splashRadius: 0, splashDamage: 0, projectileSpeed: 0, chains: 0
    },
    xray: {
        fireMode: 'semi', shot: 'xray-bolt', damage: 400, headMult: 1, limbMult: 1, rpm: 190, pellets: 1,
        magSize: 20, reserve: 160, reloadTime: 2.8, reloadEmptyTime: 3.2, perRoundReload: 0,
        range: 60, maxRange: 60, minDamageMult: 1, penetration: 0, hipSpread: 0.03, adsSpread: 0.012,
        adsTime: 0.2, adsZoom: 1.2, moveMult: 1, recoil: 0.03, splashRadius: 2.2, splashDamage: 700, projectileSpeed: 55, chains: 0
    },
    wunder: {
        fireMode: 'semi', shot: 'arc', damage: 1500, headMult: 1, limbMult: 1, rpm: 100, pellets: 1,
        magSize: 6, reserve: 42, reloadTime: 3, reloadEmptyTime: 3.4, perRoundReload: 0,
        range: 40, maxRange: 40, minDamageMult: 1, penetration: 0, hipSpread: 0.02, adsSpread: 0.01,
        adsTime: 0.25, adsZoom: 1.15, moveMult: 0.95, recoil: 0.05, splashRadius: 0, splashDamage: 0, projectileSpeed: 0, chains: 5
    }
}

/**
 * Generic per-tier scaling (index = tier), applied before the weapon's own
 * overrides. PaP costs climb steeply (5k, 15k, 30k), so every tier is a step
 * a player feels: much harder hits, deeper magazines and reserves, quicker
 * reloads, softer recoil, more reach and (tiers 2 and 3) a faster cycle.
 */
const PAP_SCALE = {
    damage: [1, 2.2, 3.8, 6],
    magSize: [1, 1.5, 1.8, 2.1],
    reserve: [1, 1.6, 2.2, 2.9],
    reload: [1, 0.92, 0.84, 0.75],
    recoil: [1, 0.88, 0.76, 0.65],
    rpm: [1, 1, 1.06, 1.12],
    range: [1, 1.15, 1.3, 1.45]
} as const

/** Absolute per-tier overrides [tier1, tier2, tier3], cumulative. */
const PAP_OVERRIDES: Partial<Record<DfWeaponId, [Partial<DfBaseStats>, Partial<DfBaseStats>, Partial<DfBaseStats>]>> = {
    // Tier 1+: twin grenade-launcher pistols. The magazine counts both pistols' shells.
    m1911: [
        {
            shot: 'grenade', fireMode: 'semi', damage: 180, headMult: 1, limbMult: 1, rpm: 300, magSize: 6, reserve: 48,
            reloadTime: 2, reloadEmptyTime: 2.4, range: 40, maxRange: 60, minDamageMult: 1, hipSpread: 0.02, adsSpread: 0.01,
            adsZoom: 1.1, recoil: 0.04, splashRadius: 3, splashDamage: 600, projectileSpeed: 36
        },
        { damage: 320, magSize: 8, reserve: 80, rpm: 320, splashRadius: 3.4, splashDamage: 1300, projectileSpeed: 39 },
        { damage: 600, magSize: 12, reserve: 120, rpm: 360, splashRadius: 3.9, splashDamage: 2600, projectileSpeed: 42 }
    ],
    // Tier 1+: Schnellfeuer conversion, full auto; later tiers punch through the horde.
    c96: [{ fireMode: 'auto', rpm: 720 }, { rpm: 800, penetration: 2 }, { rpm: 880, penetration: 3 }],
    // More pellets and reach, then a self-loading pump at tier 3.
    m1897: [{ pellets: 10 }, { pellets: 11, rpm: 95, maxRange: 26 }, { fireMode: 'semi', rpm: 150, pellets: 13, maxRange: 30 }],
    kar98k: [{ penetration: 3 }, { penetration: 4, rpm: 60 }, { penetration: 6, rpm: 75 }],
    thompson: [{}, { rpm: 760, penetration: 1 }, { rpm: 840, penetration: 2 }],
    mp18: [{}, { rpm: 600, penetration: 1 }, { rpm: 680, penetration: 2 }],
    ppsh: [{}, { rpm: 1080, penetration: 1 }, { rpm: 1150, penetration: 2 }],
    bar: [{ penetration: 2 }, { penetration: 2, rpm: 490 }, { penetration: 3, rpm: 540 }],
    lewis: [{ penetration: 2 }, { penetration: 2, rpm: 600 }, { penetration: 3, rpm: 660 }],
    // Bigger, hotter, faster bolts every tier (and a new colour: blue, crimson, gold).
    xray: [
        { damage: 900, splashRadius: 2.8, splashDamage: 1500, magSize: 40, reserve: 200, projectileSpeed: 62 },
        { damage: 1600, splashRadius: 3.3, splashDamage: 2800, magSize: 45, reserve: 300, projectileSpeed: 68, rpm: 205 },
        { damage: 2800, splashRadius: 3.9, splashDamage: 4800, magSize: 55, reserve: 400, projectileSpeed: 74, rpm: 230 }
    ],
    // More chain jumps every tier; tier 2+ ends the chain in a shock blast.
    wunder: [
        { damage: 3000, chains: 8, magSize: 8, reserve: 72 },
        { damage: 5500, chains: 11, magSize: 10, reserve: 100, splashRadius: 3, splashDamage: 3000 },
        { damage: 9000, chains: 14, magSize: 12, reserve: 120, splashRadius: 4.5, splashDamage: 6000, rpm: 120 }
    ]
}

const INTEGER_STATS: readonly DfNumericStat[] = ['magSize', 'reserve', 'pellets', 'penetration', 'chains']

function clampTier(pap: number): number {
    return Math.max(0, Math.min(3, Math.floor(Number.isFinite(pap) ? pap : 0)))
}

/** Fully resolved stats for a weapon at a PaP tier (0..3) with the chosen attachments. */
export function dfWeaponStats(id: DfWeaponId, pap: number, attachments: DfAttachmentChoice = {}): DfWeaponStats {
    const def = DF_WEAPONS[id]
    const base = BASE[id]
    if (!def || !base) throw new Error(`Unknown weapon ${String(id)}`)
    const tier = clampTier(pap)
    const s: DfWeaponStats = { name: tier > 0 ? def.papNames[tier - 1] ?? def.name : def.name, ...base }

    if (tier > 0) {
        s.damage *= PAP_SCALE.damage[tier]!
        s.magSize *= PAP_SCALE.magSize[tier]!
        s.reserve *= PAP_SCALE.reserve[tier]!
        s.reloadTime *= PAP_SCALE.reload[tier]!
        s.reloadEmptyTime *= PAP_SCALE.reload[tier]!
        s.perRoundReload *= PAP_SCALE.reload[tier]!
        s.recoil *= PAP_SCALE.recoil[tier]!
        s.splashDamage *= PAP_SCALE.damage[tier]!
        s.rpm *= PAP_SCALE.rpm[tier]!
        s.range *= PAP_SCALE.range[tier]!
        s.maxRange *= PAP_SCALE.range[tier]!
        const over = PAP_OVERRIDES[id]
        if (over) for (let t = 0; t < tier; t++) Object.assign(s, over[t])
    }

    const mul: Partial<Record<DfNumericStat, number>> = {}
    const add: Partial<Record<DfNumericStat, number>> = {}
    for (const [slot, attId] of Object.entries(attachments) as [DfAttachmentSlot, string | undefined][]) {
        const a = def.attachments.find(x => x.id === attId && x.slot === slot)
        if (!a) continue
        for (const [k, v] of Object.entries(a.mods) as [DfNumericStat, number][]) {
            if (!Number.isFinite(v)) continue
            if (DF_ADDITIVE_MODS.includes(k)) add[k] = (add[k] ?? 0) + v
            else mul[k] = (mul[k] ?? 1) * v
        }
    }
    for (const [k, v] of Object.entries(mul) as [DfNumericStat, number][]) s[k] *= v
    for (const [k, v] of Object.entries(add) as [DfNumericStat, number][]) s[k] += v

    for (const k of INTEGER_STATS) s[k] = Math.round(s[k])
    s.magSize = Math.max(1, s.magSize)
    s.reserve = Math.max(0, s.reserve)
    s.pellets = Math.max(1, s.pellets)
    s.penetration = Math.max(0, s.penetration)
    s.chains = Math.max(0, s.chains)
    return s
}

/**
 * Weapon XP needed to reach each level; index 0 is level 1 (0 xp). Max level 5.
 * At 10 xp per kill: level 2 after 40 kills, level 5 after 350, which a
 * favourite weapon (~70-120 kills a match) reaches in 3-5 matches.
 */
export const DF_WEAPON_LEVEL_XP = [0, 400, 1100, 2100, 3500]

export const DF_WEAPON_MAX_LEVEL = DF_WEAPON_LEVEL_XP.length

export function dfWeaponLevel(xp: number): number {
    let level = 1
    for (let i = 1; i < DF_WEAPON_LEVEL_XP.length; i++) if (xp >= DF_WEAPON_LEVEL_XP[i]!) level = i + 1
    return level
}

/** XP a weapon gains from one kill with it. */
export const DF_WEAPON_XP_PER_KILL = 10

/** Attachments of a weapon unlocked at a given weapon level. */
export function dfUnlockedAttachments(id: DfWeaponId, level: number): DfAttachmentDef[] {
    return DF_WEAPONS[id].attachments.filter(a => a.level <= level)
}

/** Drops attachments that are unknown, locked at this level, or doubled up on a slot. */
export function dfSanitizeAttachments(id: DfWeaponId, level: number, choice: DfAttachmentChoice): DfAttachmentChoice {
    const out: DfAttachmentChoice = {}
    if (!DF_WEAPONS[id] || !choice || typeof choice !== 'object') return out
    const unlocked = dfUnlockedAttachments(id, level)
    for (const [slot, attId] of Object.entries(choice) as [DfAttachmentSlot, unknown][]) {
        if (typeof attId !== 'string') continue
        const def = unlocked.find(a => a.id === attId && a.slot === slot)
        if (def) out[slot] = def.id
    }
    return out
}

/** Weapons the mystery box can roll. */
export function dfBoxPool(): DfWeaponId[] {
    return DF_WEAPON_IDS.filter(id => DF_WEAPONS[id].inBox)
}

/**
 * Relative odds of each box weapon. The heavy hitters come up a little more
 * often than the cheap wall guns; the X-Ray is rare (about one roll in
 * fifteen) but real.
 */
const BOX_WEIGHTS: Partial<Record<DfWeaponId, number>> = {
    c96: 1,
    m1897: 0.9,
    kar98k: 0.6,
    thompson: 1,
    mp18: 0.85,
    ppsh: 0.9,
    bar: 1.1,
    lewis: 1,
    xray: 0.45
}

/** Box odds weight for a weapon (0 when the box never rolls it). */
export function dfBoxWeight(id: DfWeaponId): number {
    return DF_WEAPONS[id]?.inBox ? BOX_WEIGHTS[id] ?? 1 : 0
}
