import * as THREE from 'three'

/* The foil model, shared by the single-card page and the grid.
 *
 * Reconstructing the game's composition rather than CSS-approximating it. The
 * inputs and their roles come from the game's own shader property names in
 * TPCICardShaders.dll — _CardWhitePlateMask, _CardEtch, _CardColdFoilMask —
 * plus the shared tileable patterns (t_holofoil_*, t_direction_*) and
 * FX_T_Spectrum, a 128x16 rainbow ramp. The compiled shader itself is Metal
 * bytecode and was not recoverable, so the maths below is our own.
 *
 * The white plate says where foil is; the spectrum is sampled at a coordinate
 * that shifts with viewing angle, which is why the hue travels as the card
 * tilts rather than merely brightening.
 */

// The game renders each card onto a square canvas; trim to card proportions.
export const ASPECT = 0.718;
export const CROP = (1 - ASPECT) / 2;

// One card per effect, each the one its preset was verified against. Anything
// here can be reached from the picker rather than by editing the URL.
export const SHOWCASE = [
  ["Oddish", "sunbeam", "sm12", "002", "wp_ph", false],
  ["Gloom", "sunbeam", "sm12", "003", "wp_ph", false],
  ["Tropius", "flatsilver", "me5", "001", "wp_ph", false],
  ["Zarude", "swholo", "swsh12-5", "016", "wp", false],
  ["Exeggcute", "rainbow", "sv8-5", "001", "wp_mph", false],
  ["Mega Zeraora ex", "svultra", "me5", "027", "wp", false],
  ["Primarina", "svholo", "me5", "020", "wp", false],
  ["Emboar", "tinsel", "rsv10-5", "013", "wp", false],
  ["Origin Forme Palkia VSTAR", "swsecret", "swsh12-5a", "067", "wp", false],
  ["Wailord ex", "sunpillar", "me5", "016", "wp", false],
  ["Vileplume-GX", "sunlava", "sm12", "004", "wp", false],
  ["Tapu Lele", "cosmos", "sv8", "092", "wp_alt", true],
  ["Charizard", "crackedice", "swsh4", "025", "wp_pcd", false],
  ["Blastoise-EX", "angledpillars", "xy1", "029", "wp_alt", true],
  ["Girafarig", "thatch", "xy4", "082", "wp_op", false],
  ["Ninetales BREAK", "squares", "xy12", "016", "wp", false],
  ["Radiant Charjabug", "radiantholo", "swsh12-5", "051", "wp", false],
  ["Mega Greninja ex", "svultragoldrainbow", "me4", "122", "wp", false],
  ["Maximum Belt", "acefoil", "sv8-5", "117", "wp", false],
  ["Teal Mask Ogerpon ex", "svultrascodix", "sv8-5", "177", "wp", false],
  ["Charizard", "25thconfetti", "swsh7-5r", "002", "wp", false],
  ["Ninetales", "galaxy", "xy12", "015", "wp", false],
  ["Paradise Resort", "stamped", "svbsp", "224", "wp", false],
  ["Reshiram", "solidcolor", "bw11", "114", "std_wp", false],
  ["Pikachu", "pikachufoil", "me5-5", "023", "wp", false],
  ["Mew (Red)", "rgbfoil", "me5-5m", "001", "wp", false],
  ["Charizard (Classic)", "classicfoil", "me5-5c", "002", "wp", false],
  ["Mew ex (30th)", "sunpillar", "me5-5", "066", "wp", false],
  ["Exeggcute (30th)", "rainbow", "me5-5", "001", "wp", false],
];

/* What a foil effect looks like.
 *
 * The card data has 24 distinct `foilEffect` values and they do not agree on
 * much: SunBeam is a broad diagonal sweep, SwHolo is a fine vertical comb in a
 * narrow green slice, FlatSilver is metallic rather than coloured. Most map to
 * no texture at all — the game ships only six — so "has a pattern" says nothing
 * useful about how an effect should be drawn.
 *
 * Each entry below sets defaults for the uniforms; anything absent keeps the
 * uniform's own default, and any URL parameter still wins over both. `verified`
 * records whether the look was checked against TCG Live or is a guess.
 */

export const EFFECTS = {
  sunbeam: {                                  // SM-era reverse holos
    pattern: "T_Holofoil_Rain", dir: -1, bands: 3, chroma: 0.9, dropout: 0,
    verified: "sm10_108 Murkrow, sm1_039 Popplio",
  },
  flatsilver: {                               // every SWSH/SV/ME reverse holo
    pattern: "none", dir: -1, bands: 3, chroma: 0.25, dropout: 0,
    verified: "swsh12_127 Togedemaru",
  },
  swholo: {                                   // SWSH-era holo
    pattern: "none", dir: 0, bands: 140, chroma: 0.9, dropout: 0.6,
    rampstart: 0.22, rampspan: 0.25,
    verified: "swsh12_147 Archeops",
  },
  rainbow: {                                  // mostly XY/BW-era reverse holos
    // Sun_Pillar arrived here by accident — rainbow had no entry, so it fell
    // through to the page default — but a side-by-side against `pattern=none`
    // settled it: the warp looks better and stays. So an effect can borrow a
    // texture it is not named after, which means the other texture-less effects
    // (SvHolo, SvUltra, SwSecret, Tinsel) are worth trying with a warp too
    // rather than assuming they want a bare plate.
    pattern: "T_Holofoil_Distortion_Sun_Pillar",
    dir: -1, bands: 3, chroma: 0.9, intensity: 0.6, dropout: 0,
    verified: "swsh12a_001 Braixen",
  },
  svultra: {                                  // SV/ME special illustration and
    // hyper rares. The game shows these covered in fine sparkles, and
    // Confetti_Dots is exactly that — fine white points on black. It is not
    // named for this effect, but Rainbow already showed the name-based mapping
    // is not the whole story.
    pattern: "T_Holofoil_Confetti_Dots", etch: true,
    dir: 0, bands: 3, chroma: 0.35, warp: 0.7, intensity: 0.7,
    patternscale: 2.2, motifcut: 0.55, twinkle: 1.0,
    verified: "me5_008 Mega Delphox ex — sprinkles",
  },
  svholo: {                                   // SV/ME-era holo rares
    // Two band sets about 20 degrees either side of horizontal: bands at +20
    // have their gradient perpendicular, at (-sin20, cos20), and the second
    // mirrors it. Where they cross, the lattice appears. All 396 are foilMask
    // Holo, so no engraving is involved.
    // No distortion map: the bands are straight. Rainbow wanted the Sun_Pillar
    // warp, this one does not.
    pattern: "none",
    dirx: -0.34, dir: 0.94, bands: 3,
    dirx2: 0.34, dir2: 0.94, bands2: 3, layer2: 1.0,
    // Thin bands far apart: duty 0.2 lights a fifth of each period and leaves
    // the rest bare. The second layer runs against the light, so the two sets
    // slide past each other and their crossings travel — meeting at an edge at
    // some angles rather than sitting in the middle.
    duty: 0.2, light2: -1.0,
    // Less travel per degree of tilt. uSpread scales both the pointer and the
    // viewing-angle terms, so 6 (the SM value) sweeps several periods across a
    // small movement; 1.8 keeps the bands roughly where they are.
    spread: 1.8,
    chroma: 0.9, contrast: 1.2,
    saturate: 1.15, intensity: 0.8,
    verified: "me5_012 Armarouge",
  },
  tinsel: {                                   // SV-era holo, e.g. Black Bolt
    // Fine horizontal strands packed close enough to fill the plate: no x term
    // at all, and duty 0.85 so each nearly meets its neighbour.
    //
    // Band count measured against the game on rsv10-5_010 Virizion, which shows
    // 18 stripe periods across the artwork window. uBands is twice the period
    // count across the card, because `spatial` carries a 0.5 factor — 100 gives
    // 50 across the card, of which the artwork's third is 18.
    //
    // Colour comes out closer to white than to rainbow (the game measures
    // saturation 0.31), with each strand taking a random offset into the ramp
    // so neighbours differ arbitrarily rather than drifting top to bottom.
    //
    // Intensity is by eye rather than by measurement. Two screenshots of this
    // card differ threefold in amplitude depending on the light angle, so
    // matching the brighter one leaves it too hot the rest of the time.
    pattern: "none",
    dirx: 0, dir: 1, bands: 100, duty: 0.85,
    rampmix: 0.7, huejitter: 0.6, chroma: 0.4, contrast: 1.3, saturate: 1.1,
    intensity: 0.65, spread: 3.0,
    verified: "rsv10-5_010 Virizion",
  },
  swsecret: {                                 // SWSH secret and rainbow rares
    // Broad regular diagonal bands, not the tight horizontal comb the guess
    // started from. All 308 are foilMask Etched, so the engraving carries the
    // fine texture and the bands stay large behind it.
    // A diffraction grating, not a set of stripes. A real foil returns a
    // different colour depending on the angle light meets it, so the card
    // carries roughly one spectrum across its whole face and the tilt moves
    // where in that spectrum each point sits. Bands 2 is one period (uBands is
    // twice the period count), duty 1 removes the gaps between repeats, and a
    // small hue spread makes the shift gradual rather than racing.
    pattern: "none", etch: true,
    dirx: 1, dir: -1, bands: 2, duty: 1.0,
    spread: 0.8, contrast: 1.0, huejitter: 0.0, huetravel: 0.25,
    chroma: 0.9, intensity: 0.8, foilover: 0.9,
    etchgate: 1.0, etchwarp: 0.3, etchboost: 0.0,
    verified: "swsh12_196 Serperior VSTAR",
  },
  angledpillars: {                            // XY-era EX cards
    // The page default turned out to be right: a diagonal sweep with the
    // Sun_Pillar warp, recorded here so it stops depending on the fallback.
    pattern: "T_Holofoil_Distortion_Sun_Pillar", dir: -1, bands: 3,
    verified: "xy2_012 Charizard-EX",
  },
  thatch: {                                   // 63 cards
    // Uses T_Direction_RG_Thatch_*, two 1024 direction maps that the original
    // scraper's name filter missed — it only looked for t_holofoil and friends.
    // Unverified.
    pattern: "T_Direction_RG_Thatch_G_N",
    dir: -1, bands: 3, warp: 0.6, patternscale: 1.0, intensity: 0.8,
    verified: "xy4_031 Zubat",
  },
  // The small effects, most of them variants of something already verified.
  // `foilMask` decided which carry engraving, so that part was never a guess.
  //
  // These were approved by eye in one batch rather than through the card-by-card
  // side-by-sides the larger effects got, so they are the weakest entries here.
  acefoil: {                                  // 33 ACE SPEC rares, etched
    pattern: "T_Holofoil_Confetti_Dots", etch: true,
    dir: 0, bands: 3, chroma: 0.35, warp: 0.7, intensity: 0.7,
    patternscale: 2.2, motifcut: 0.55,
    verified: "sv8-5_116 Max Rod",
  },
  svultrascodix: {                            // 11 hyper rares, etched
    // Scodix is a raised spot-varnish process, so this leans on the engraving
    // more than SvUltra does.
    pattern: "T_Holofoil_Confetti_Dots", etch: true,
    dir: 0, bands: 3, chroma: 0.35, warp: 0.7, intensity: 0.7,
    patternscale: 2.2, motifcut: 0.55, etchboost: 1.2,
    verified: "sv8-5_176 Iron Leaves ex",
  },
  svultragoldrainbow: {                       // 8 cards, foilMask ColdFoilEtched
    // The only effect with its own foilMask value. Gold: a narrow warm window
    // of the ramp rather than the full rainbow.
    pattern: "T_Holofoil_Confetti_Dots", etch: true,
    dir: 0, bands: 3, chroma: 0.6, warp: 0.9, intensity: 0.8,
    patternscale: 2.2, motifcut: 0.5,
    rampstart: 0.08, rampspan: 0.16,
    verified: "me5_120 Mega Darkrai ex",
  },
  radiantholo: {                              // 16 Radiant Pokemon, etched
    // Wider bands and quieter overall; the colour was right at the first try.
    pattern: "none", etch: true,
    dirx: 0, dir: 1, bands: 18, duty: 0.65,
    chroma: 0.9, contrast: 1.4, intensity: 0.55, huejitter: 0.4,
    verified: "swsh12-5_020 Radiant Charizard",
  },
  "25thconfetti": {                           // 25 Celebrations cards, etched
    pattern: "T_Holofoil_Confetti_Dots", etch: true,
    dir: -1, bands: 3, warp: 1.5, patternscale: 1.0, motifcut: 0.3,
    verified: "swsh7-5r_001 Blastoise",
  },
  squares: {                                  // 35 BREAK cards, foilMask Holo
    // Actual squares: two perpendicular combs multiplied rather than summed, so
    // the foil lights only where both are lit and the crossings become filled
    // cells instead of a lattice of lines.
    pattern: "none",
    dirx: 1, dir: 0, bands: 24, duty: 0.6,
    dirx2: 0, dir2: 1, bands2: 24, layer2: 1.0, layermul: 1.0,
    chroma: 0.6, intensity: 0.9,
    verified: "xybsp_180 Arcanine BREAK",
  },
  stamped: {                                  // 14 cards, foilMask Stamped
    // The only effect with foilMask Stamped, which nothing else uses.
    pattern: "none", dir: -1, bands: 3, chroma: 0.6, intensity: 0.7,
    verified: "mebsp_028 Celebratory Fanfare",
  },
  solidcolor: {                               // 3 XY secret rares, etched
    // No sweep at all: a flat tint over the plate, with the engraving on top.
    pattern: "none", etch: true,
    dir: -1, bands: 1, duty: 1.0, chroma: 0.2, contrast: 1.0, intensity: 0.6,
    verified: "xy4_122 Dialga-EX",
  },

  sunpillar: {                                // the largest single effect
    // The default shape turned out to be right here — a diagonal sweep with
    // the Sun_Pillar warp — needing only the intensity brought down.
    pattern: "T_Holofoil_Distortion_Sun_Pillar",
    dir: -1, bands: 3, intensity: 0.75,
    verified: "me5_004 Lurantis ex",
  },
  sunlava: {                                  // SM-era GX and holo rares
    // Verified unchanged: the diagonal sweep with the Sun_Lava warp was right
    // as it stood. This is the only verified effect using the second
    // distortion map — a flowing marbled field rather than Sun_Pillar's bars.
    pattern: "T_Holofoil_Distortion_Sun_Lava", dir: -1, bands: 3,
    verified: "sm12_001 Venusaur & Snivy-GX, smbsp_239 Carracosta-GX",
  },
  cosmos: {                                   // the starry SWSH-era holos
    // The stars carry the effect and the plate behind them stays quiet: a big
    // additive boost on the motif, against a low base intensity.
    //
    // Magnified rather than tiled (patternscale below 1). Galaxy_Stars is 512
    // with points averaging 1.6px, and minifying it averages them into the
    // black around them — measured earlier, nothing survives above half
    // brightness at 128px. Magnifying keeps them near mip 0 and intact.
    pattern: "T_Holofoil_Galaxy_Stars",
    dir: -1, bands: 3, intensity: 0.45,
    warp: 1.0, patternscale: 0.6, motifcut: 0.25, twinkle: 1.0,
    sparklegain: 2.5, sparklewhite: 0.85,
    verified: "swsh12_049 Pikachu",
  },
  galaxy: {                                   // 13 XY-era cards, same texture
    // Unverified, but starting from cosmos rather than from the old default,
    // since they share Galaxy_Stars and the star handling is what matters.
    pattern: "T_Holofoil_Galaxy_Stars",
    dir: -1, bands: 3, intensity: 0.45,
    warp: 1.0, patternscale: 0.6, motifcut: 0.25,
    sparklegain: 2.5, sparklewhite: 0.85,
    verified: "xy12_011 Charizard",
  },
  pokeball: {                                 // SV pattern parallels, 259 cards
    // The same treatment as masterball, with its own ball. Both are a single
    // mark on the card rather than a repeating field — a tiled pattern was my
    // assumption, and it was wrong.
    // Stronger than an ordinary reverse holo, because these are: the whole
    // card body is shattered foil rather than a light wash. Measured on
    // rsv10-5 001, the default intensity puts the entire foil at 2.7 levels of
    // 255 on a pale card — the shatter was working and moving two thirds of
    // that, which is still nothing anyone can see. The facets need foil to
    // modulate before they can read.
    pattern: "none", dir: -1, bands: 3, chroma: 0.3, dropout: 0, intensity: 3.0,
    etch: true, overlay: "/images/shared/pokeball.png",
    // etchmix is the one to reach for: it scales how much of the mark shows,
    // while the shatter still keeps clear of the whole shape. Both balls sit at
    // the same value — the solid dome no longer needs holding back separately
    // once the mark is this quiet.
    etchwarp: 1.2, etchboost: 0.9, etchgate: 0, etchmix: 0.15,
    shatter: 0.55, shatterscale: 15,
    verified: "not yet — awaiting the drawn mark",
  },
  masterball: {                               // SV pattern parallels, 211 cards
    // A reverse holo underneath — these are reverse slots, and the game gives
    // them FlatSilver — with two things on top: the shattered-glass facets that
    // cover the whole card, and the single Master Ball pressed into the middle.
    //
    // The ball is an overlay rather than a scraped mask because the game draws
    // it in its own shader: the wp_sph and wp_mph plates for a card are
    // byte-identical, so nothing in the scraped data says which of the two a
    // card is. Only foilMask does.
    // Stronger than an ordinary reverse holo, because these are: the whole
    // card body is shattered foil rather than a light wash. Measured on
    // rsv10-5 001, the default intensity puts the entire foil at 2.7 levels of
    // 255 on a pale card — the shatter was working and moving two thirds of
    // that, which is still nothing anyone can see. The facets need foil to
    // modulate before they can read.
    pattern: "none", dir: -1, bands: 3, chroma: 0.3, dropout: 0, intensity: 3.0,
    etch: true, overlay: "/images/shared/masterball.png",
    etchwarp: 1.2, etchboost: 0.9, etchgate: 0, etchmix: 0.15,
    shatter: 0.55, shatterscale: 15,
    verified: "not yet — drawn from a scan of PRE 002/131",
  },
  pikachufoil: {                              // 30 Pikachu Rares, 30th Celebration
    // Two layers in the game. This is the first: a scatter of small dots over
    // the frame, the art window and the Pikachu-30 face. The base foil is held
    // at zero until the second layer is built, so the dots can be judged alone.
    //
    // Measured on a straight-on image of JP M6a 017 Pikachu, 800px wide — one
    // sample, at one angle:
    //   - about 70 dots per 100x100px, so ~67 across the card; median 5.5-6.5px
    //     across, larger where neighbours merge; a quarter of the area covered
    //   - unscreened dot colour: face 0.75/0.71/0.50, black ear tips
    //     0.77/0.74/0.56, art window ~0.41, silver frame ~0.47. Face and ear
    //     agree, so no ink absorption; face to art is 1.0 to ~0.5, which is the
    //     plate (255 on the face, ~130 in the art), so the plate is followed
    //     fully; the frame's plate is only ~35 like the card body, so its dots
    //     come from the border lift
    //   - frame 0.04 card widths on every side
    //   - colours pastel: near-white tinted pink, cyan, yellow, green, on a
    //     warm average
    //   - angular chips, many drawn out or merged in pairs, not round dots
    // Matched to those numbers at dots 1.2, then tuned by eye in the demo:
    // strength 0.6, full chroma, more twinkle, and a little takeover.
    // The card body shows elongated streaks rather than dots: the second layer.
    pattern: "none", intensity: 0,
    dots: 0.6, dotscale: 80, dotsize: 0.32, dothex: 0, dotrandom: 1.0,
    dotsizevar: 0.35, dotplate: 1.0, dotedge: 0.4, dotedgewidth: 0.04,
    dotchroma: 1.0, dottwinkle: 0.8, dotjitter: 1.0, dotover: 0.3,
    dotshape: 0.3, dotstretch: 0.4, dotwarm: 0.8,
    // The second layer, the firework in the card body. Centre read off the
    // same still, at (0.81, 0.71) of the card; ~80 dashes round a ring there.
    burst: 1.0, burstx: 0.82, bursty: 0.72, burstrays: 80,
    // Two kinds of oval overlapping, each catching the light its own way.
    // Strictly regular: the second set is the first swung about the centre by
    // exactly half the angle between rays, at the same distance out, and
    // nothing about either varies dash to dash.
    burstb: 1.0, burstsparkle: 0,
    // Capped short of the whole card: 45 rings out from the core ends it about
    // a third of a card width from its centre, at 80 rays.
    burstmaxrings: 45,
    // Red through to sky blue, leaving out violet, magenta and pink, which
    // made the whole burst read purple.
    burstrampstart: 0.0, burstrampspan: 0.58,
    // Mostly pale: the colour is kept low and the light carries the effect —
    // the bow tie of rays that swings round as the card tilts.
    burstchroma: 0.2, burstspoke: 0.8,
    // Scattered, not in a grid. Found in the still by scoring every point on
    // how radially the streaks around it point at it, then checking each
    // hit by eye. Seven confirmed, in a loosely jittered layout; three weaker
    // hits that fill that layout's gaps sit in slots 8-10.
    burstcount: 10,
    // More than the still shows: the ten found, plus a dozen scattered. They
    // overlap freely, but each lights only near its own light direction, so
    // at any one angle only some of them show.
    burstscatter: 12, burstcatch: 1.0, burstcatchwidth: 3.0,
    burst2x: 0.83, burst2y: 0.44,      // art, below the tail
    burst3x: 0.05, burst3y: 0.10,      // top-left corner
    burst4x: 0.055, burst4y: 0.67,     // left edge, by the attack text
    burst5x: 0.06, burst5y: 0.89,      // left edge, lower
    burst6x: 0.44, burst6y: 0.155,     // art, top centre
    burst7x: 0.50, burst7y: 0.89,      // below the retreat bar
    burst8x: 0.87, burst8y: 0.17,      // tentative
    burst9x: 0.05, burst9y: 0.48,      // tentative
    burst10x: 0.52, burst10y: 0.49,    // tentative
    verified: "not yet — measured off a still of JP M6a 017, not TCG Live",
  },
  rgbfoil: {                                  // 3 RGB Mews, 30th Celebration secret rares
    // Designed, not verified: TCG Live does not show these cards, and no
    // reference of the foil was found. Built from the masks' channels.
    //
    // All three masks pack a different region into each channel:
    //   wp    R Mew and frame lines, G nearly the whole card, B the background
    //         swirl without Mew
    //   etch  R the name bar and attack box, G fine relief over the whole card,
    //         B the frame outlines
    //   foil  R background rays and frame, G Mew's shading and ground swirl,
    //         B Mew's outline and the energy circles — identical on all three
    // Starting point: the base foil off, and one rainbow layer per foil-mask
    // channel, catching the light a third of a cycle apart.
    pattern: "none", intensity: 0, etch: true, foilmask: true,
    chan: 1.0,
    // A shine on the rays: a bow tie through their centre, behind Mew,
    // swinging round with the light. Centre placed by eye.
    rayshine: 0.8, rayx: 0.57, rayy: 0.39, raywidth: 3.0, rayboost: 1.0,
    verified: "not yet — designed by eye, the card is not shown in TCG Live",
  },
  classicfoil: {                              // 30 Classic Collection cards, etched
    // Read off a TCG Live recording of me5-5c_2 Charizard, which is dimmed in
    // the game as unowned. Solid five-pointed stars in pink, yellow, lavender
    // and green, about 0.03-0.04 card widths across, over the border and the
    // art; lying flat only the right border shows them, tilted they move to
    // the left border and the art window — a lit band sweeping with the light.
    // The holo beneath is left at the fallback until the stars are right.
    etch: true,
    stars: 1.0, starscale: 24, stardensity: 0.35, starsize: 0.4,
    // startravel 3: tuned when the hue spread was 6; at the new default of 2
    // the stars would sweep a third as fast, so their travel is tripled.
    starpoints: 5, starinner: 0.45, starbands: 1.0, startravel: 3.0,
    starwidth: 3.0, starchroma: 0.6, starover: 0.6,
    // Only over the border and the art: the plate is white exactly there and
    // ~22 on the text boxes, which is where the recording shows none.
    starplate: 1.0,
    verified: "not yet — first pass from a recording of me5-5c_2 Charizard",
  },
  // Set-specific: 30th Celebration's commons. Plain foil with a glow rather
  // than the wavy Sun_Pillar rainbow: no distortion map, one smooth low-
  // colour band so the plate reads as metal, and a soft highlight that slides
  // with the tilt. Their plate is foil at the frame (255), half at the name
  // bar (150) and ~33 elsewhere, so it is mostly the frame that glows.
  "rainbow@me5-5": {
    // The frame is pale silver, and screen blending alone barely tints it
    // (border saturation 0.04), so the foil takes over part of its colour.
    // Colour values tuned by eye in the demo: low chroma and contrast for a
    // soft, even sheen, with takeover at 0.65.
    pattern: "none", bands: 1, chroma: 0.35, intensity: 0.4, contrast: 0.4,
    foilover: 0.65,
    glow: 0.8, glowsize: 0.45, glowsoft: 2.0, glowmirror: 1.0,
    glowchroma: 0.7, glowhue: 1.5, glowplate: 1.0,
    verified: "not yet — designed by eye, a plain foil asked for in place of the waves",
  },
  // Set-specific: in 30th Celebration the SunPillar cards — its double rares,
  // Mew ex and Espeon ex among them — carry sparkles the same effect elsewhere
  // does not, and the card data has nothing to say so. Keyed effect@family,
  // and laid over the plain sunpillar entry.
  "sunpillar@me5-5": {
    // From a TCG Live recording of me5-5_66 Mew ex: mostly thin four-pointed
    // sparkles, some with more points, near-upright, pastel to white, across
    // the whole card including Mew's body where the plate is black, and
    // twinkling one by one rather than sweeping as a band. The commons
    // (Rainbow) have none.
    // The holo itself redesigned like the commons': no Sun_Pillar waves, the
    // same soft even sheen, but with more bands across the card.
    pattern: "none", bands: 5, chroma: 0.35, intensity: 0.4, contrast: 0.4,
    foilover: 0.65,
    stars: 1.0, starscale: 22, stardensity: 0.35, starsize: 0.5,
    starsizevar: 0.7, starpoints: 4, starinner: 0.12,
    starmix: 0.4, starpoints2: 8, starinner2: 0.35, starspin: 0.15,
    // startravel 3 keeps the twinkle at the speed it had before the hue
    // spread came down from 6 to 2.
    starbands: 2.0, starwidth: 2.0, starjitter: 1.0, starsel: 0.6, startravel: 3.0,
    starchroma: 0.35, starover: 0.2, starplate: 0,
    verified: "not yet — first pass from a recording of me5-5_66 Mew ex",
  },
  crackedice: {                               // SWSH-era rares and energies
    // Angular shards averaging 7.8px, so this reads as facets rather than as
    // sparkle — the decal handling is the same as cosmos, just much coarser.
    pattern: "T_Holofoil_Mask_Cracked_Ice_RGB", dir: -1, bands: 3, warp: 1.5,
    verified: "sve_009 Basic Grass Energy",
  },

};

// The six shared textures play two different roles, and reading one as the
// other is meaningless. Sun_Pillar and Sun_Lava store a 2D offset in R and G
// (B is 0, alpha solid) and displace the spectrum lookup. The rest carry a
// visible motif that multiplies the foil — and for Rain that motif lives in
// the alpha channel, its RGB being nothing but blocky noise.
export const ROLE = {
  T_Holofoil_Distortion_Sun_Pillar: 0,   // warp, from RG
  T_Holofoil_Distortion_Sun_Lava: 0,
  T_Holofoil_Rain: 2,                    // decal, from alpha
  T_Holofoil_Galaxy_Stars: 1,            // decal, from RGB
  T_Holofoil_Confetti_Dots: 1,
  T_Holofoil_Mask_Cracked_Ice_RGB: 1,
  // Role 3: also a distortion field, but packed the way Unity stores normal
  // maps in DXT5 — X in alpha, Y in green, with red pinned at 255 and blue
  // unused. Reading .rg here would give a constant x and no horizontal
  // displacement at all.
  T_Direction_RG_Thatch_G_N: 3,
  T_Direction_RG_Thatch_R_N: 3,
};

export const VERTEX = /* glsl */`
  varying vec2 vUv;
  varying vec3 vView;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Direction from the fragment to the eye, in view space. This is what
    // makes the hue depend on how the card is tilted.
    vView = normalize(-mv.xyz);
    // How square-on the card is, from its normal rather than the per-fragment
    // view vector. On a flat plane the normal is constant, so this is the same
    // everywhere on the card and the bands stay exactly parallel — using vView
    // instead let perspective bend them.
    vFacing = normalize(normalMatrix * normal).z;
    gl_Position = projectionMatrix * mv;
  }
`;

// Bursts after the first, each with its own centre uniforms.
const BURST_EXTRA = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const FRAGMENT = /* glsl */`
  #define ASPECT_R 0.718
  precision highp float;
  varying vec2 vUv;
  varying vec3 vView;
  varying float vFacing;

  uniform sampler2D uCard, uMask, uPattern, uSpectrum, uSpectrum2, uEtch;
  uniform sampler2D uFoilMask;
  uniform float uPlateR, uPlateG, uPlateB, uEtchR, uEtchG, uEtchB;
  uniform float uChan, uChanR, uChanG, uChanB, uChanPhaseR, uChanPhaseG, uChanPhaseB;
  uniform float uChanTint, uChanSel, uChanWidth, uChanBands, uChanOver, uChanChroma;
  uniform float uRayShine, uRayX, uRayY, uRayWidth, uRayBoost;
  uniform float uStars, uStarScale, uStarSize, uStarSizeVar, uStarDensity;
  uniform float uStarPoints, uStarInner, uStarPoints2, uStarInner2, uStarMix;
  uniform float uStarBands, uStarTravel, uStarWidth, uStarJitter, uStarSel;
  uniform float uStarChroma, uStarOver, uStarPlate, uStarSpin;
  uniform float uGlow, uGlowSize, uGlowMirror, uGlowChroma, uGlowPlate, uGlowSoft;
  uniform float uGlowHue;
  uniform vec2 uPointer;
  uniform float uIntensity, uSpread, uPatternScale, uWarp, uCrop, uChroma, uBlur, uMode;
  uniform float uMotifCut, uTwinkle, uSparkleGain, uSparkleWhite;
  uniform float uBands, uDir, uSaturate, uInk, uContrast, uDuty, uDropout, uDirX;
  uniform float uDirX2, uDir2, uBands2, uLayer2, uLight2, uLayerMul;
  uniform float uRampMix, uTime, uSpeed, uRampStart, uRampSpan, uHueJitter;
  uniform float uShatter, uShatterScale, uShatterEdge, uShatterLine;
  uniform float uShatterClear, uShatterGain;
  uniform float uHueTravel;
  uniform float uHasEtch, uEtchWarp, uEtchBoost, uEtchGate, uEtchMix;
  // Pointer position on this card, 0..1 in its own uv — not the page. Each
  // card in a grid gets its own, so the one under the pointer responds and the
  // rest do not.
  uniform vec2 uLocal;
  uniform float uEdgeGain, uFoilOver;
  uniform float uCorner, uCardAspect;
  uniform float uDots, uDotScale, uDotSize, uDotHex, uDotPlate, uDotEdge;
  uniform float uDotEdgeWidth, uDotChroma, uDotTwinkle, uDotJitter, uDotOver;
  uniform float uDotRandom, uDotSizeVar, uDotShape, uDotStretch, uDotWarm;
  uniform float uBurst, uBurstX, uBurstY, uBurstRays, uBurstRingScale;
  uniform float uBurstDash, uBurstWidth, uBurstStagger, uBurstLog, uBurstPitch;
  uniform float uBurstReach, uBurstSpoke, uBurstSpokeWidth, uBurstHue;
  uniform float uBurstChroma, uBurstSparkle, uBurstOver, uBurstPlate, uBurstBorder;
  uniform float uBurstMaxRings, uBurstCore, uBurstRampStart, uBurstRampSpan;
  uniform float uBurstPoint, uBurstB, uBurstBTurnFrac, uBurstBShiftT, uBurstBSize;
  uniform float uBurstBTurn, uBurstBTravel, uBurstJitter;
  uniform float uBurstCount, uBurstScatter, uBurstCatch, uBurstCatchWidth;
  ${BURST_EXTRA.map((n) => `uniform float uBurst${n}X, uBurst${n}Y;`).join("\n  ")}

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

  // One set of bands, coloured. Called once per layer, because some effects lay
  // two sets at opposing angles and the lattice is where the two cross.
  vec3 bandLayer(float spatial, float lightPos, float etchTerm, float v,
                 out vec3 rawColour) {
    float sweep = spatial + lightPos + etchTerm;

    // Each stripe is a fixed feature of the print and catches the light at its
    // own angle, so none is permanently missing — tilt far enough and every one
    // shows. At zero selectivity they are all lit outright.
    float catchAngle = hash(floor(spatial));
    float d = abs(fract(catchAngle - lightPos + 0.5) - 0.5) * 2.0;
    float keep = mix(1.0,
                     smoothstep(uDropout, min(uDropout + 0.25, 1.0), 1.0 - d),
                     step(0.001, uDropout));

    // A band need not fill its period: the rainbow runs for uDuty of it and the
    // rest is gap, fading in and out so its ends are soft rather than cut.
    float t = fract(sweep);
    float duty = clamp(uDuty, 0.05, 1.0);
    float u = clamp(t / duty, 0.0, 1.0);
    float env = step(t, duty) * sin(3.14159265 * u) * keep;

    // Each strand takes a random offset into the ramp, so neighbours differ
    // arbitrarily instead of drifting smoothly from top to bottom. Keyed on the
    // stripe index, so a strand keeps its colour rather than flickering.
    float jitter = hash(floor(spatial) + 7.3) * uHueJitter;

    // Rotate the palette with the light. Without this every band spans the
    // whole ramp — u runs 0..1 across a band — so the card always shows every
    // colour and tilting only slides them about. Adding the light position
    // here turns the palette itself, so a given spot travels green to blue to
    // red as the card moves, which is what the pre-baked foils do.
    float travel = lightPos * uHueTravel;

    // Window into the ramp, so an effect can be green rather than every colour.
    float su = fract(uRampStart + u * uRampSpan + jitter + travel);
    vec3 even = texture2D(uSpectrum, vec2(su, 0.5)).rgb;
    vec3 blotchy = texture2D(uSpectrum2, vec2(su, fract(v + jitter))).rgb;
    vec3 spectrum = mix(even, blotchy, uRampMix);

    // Toward luminance for metal, then contrast to separate the bands.
    spectrum = mix(vec3(luma(spectrum)), spectrum, uChroma);
    spectrum = clamp((spectrum - 0.5) * uContrast + 0.5, 0.0, 1.0);
    // The colour without the envelope: a gap between bands is dark, but it is
    // dark *of a colour*, and that is what a metallic surface shows there.
    rawColour = spectrum;
    return spectrum * env;
  }

  /* Shattered glass: a voronoi tessellation, every pixel in a facet.
   *
   * The SV-era pattern parallels break the whole card into irregular shards
   * that each catch the light their own way. That last part is why this is
   * generated rather than sampled: a crackle texture is a picture of shards,
   * fixed for good, while a tessellation gives every cell an identity, and an
   * identity can offset the spectrum. Tilt the card and every facet shifts hue
   * on its own — which is the whole effect.
   *
   * It also costs no asset, has no seam, and its scale is a uniform.
   */
  vec2 cellHash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  /* Nearest cell, its identity, and how much closer it is than the runner-up.
   *
   * That last number draws the edges: where two cells are equally near you are
   * on the seam between two shards, and real shattered foil is brightest along
   * exactly those cuts.
   */
  vec4 shatter(vec2 p) {
    vec2 n = floor(p), f = fract(p);
    vec2 id = vec2(0.0);
    float first = 8.0, second = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        // Cells pulled off their lattice points, or the shards come out as a
        // grid of near-identical lozenges rather than as broken glass.
        vec2 o = cellHash(n + g);
        float d = length(g + o - f);
        if (d < first) { second = first; first = d; id = n + g + o; }
        else if (d < second) { second = d; }
      }
    }
    return vec4(id, first, second - first);
  }

  /* A field of small foil dots, generated rather than sampled.
   *
   * No shipped texture is a dot screen, and a generated one has no tile size:
   * the dots can be made as small as the card needs without magnifying anyone's
   * pixels. Each dot gets an identity, so it can catch the light at its own
   * angle — the field glints dot by dot as the card turns instead of the whole
   * sheet brightening at once.
   *
   * One dot per cell, pushed off its lattice point by uDotRandom: at 0 a
   * regular grid, at 1 anywhere in its cell, which reads as randomly scattered
   * yet still evenly packed — no clumps and no bare patches, as pure random
   * placement would give. A pushed dot can cross into a neighbouring cell, so
   * all nine around the fragment are checked.
   *
   * Returns the coverage of the dot under this fragment and its identity.
   */
  vec3 dotGrid(vec2 p) {
    vec2 n = floor(p);
    // Antialiased against the pixel footprint. Once a cell shrinks below a
    // couple of pixels no edge can be drawn, and the honest answer is the
    // dots' average coverage — otherwise the field beats against the pixel
    // grid as moire.
    float footprint = length(fwidth(p));
    float w = max(footprint * 0.5, 1e-4);
    float best = 0.0;
    vec2 bestId = n;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 cell = n + vec2(float(i), float(j));
        vec2 centre = cell + 0.5 + (cellHash(cell + 3.0) - 0.5) * uDotRandom;
        // Alternate rows offset by half a cell, the halftone arrangement.
        centre.x += mod(cell.y, 2.0) * 0.5 * uDotHex;
        float size = uDotSize
          * (1.0 + (cellHash(cell + 29.0).x - 0.5) * 2.0 * uDotSizeVar);
        // Flakes rather than discs: each turned to its own angle, drawn out
        // along one axis by up to 1 + uDotStretch, and blended from round
        // toward a square by uDotShape. Real foil specks are chips of film with
        // corners, and a field of perfect circles reads as bokeh, not glitter.
        // The square is scaled by 1.13 so a flake covers what a disc did.
        vec2 hs = cellHash(cell + 53.0);
        float ang = hs.x * 6.2831853;
        vec2 q = p - centre;
        q = vec2(cos(ang) * q.x - sin(ang) * q.y, sin(ang) * q.x + cos(ang) * q.y);
        q.x /= 1.0 + hs.y * uDotStretch;
        float d = mix(length(q), max(abs(q.x), abs(q.y)) * 1.13, uDotShape);
        float disc = 1.0 - smoothstep(size - w, size + w, d);
        if (disc > best) { best = disc; bestId = cell; }
      }
    }
    float average = min(3.14159265 * uDotSize * uDotSize, 1.0);
    return vec3(mix(best, average, smoothstep(0.35, 0.9, footprint)), bestId);
  }

  /* A firework: rings of short radial dashes around one centre.
   *
   * The 30th Celebration Pikachu Rares carry one in the card body — dashes
   * pointing out from a centre low on the right, each ring offset half a dash
   * from the one inside it, which is what gives the brick look, and growing
   * with distance: tiny near the centre, long slanted streaks at the far
   * corners.
   *
   * That growth is a log-polar grid. Around the circle, uBurstRays cells; out
   * from the centre, the log of the radius scaled so cells stay square
   * (uBurstRingScale stretches them). uBurstLog at 0 swaps in plain rings of
   * fixed pitch uBurstPitch instead, for comparison.
   *
   * p and c are in card units: x across, y in card widths. shift moves the
   * grid by a fraction of a cell around (x) and out (y), and size scales the
   * dash, so a second set can be laid over the first.
   * Returns the dash coverage, a per-dash random value, the dash's angle and
   * its distance from the centre.
   */
  vec4 burstDash(vec2 p, vec2 c, vec2 shift, float size, float rays) {
    vec2 d = p - c;
    float r = max(length(d), 1e-5);
    float a = atan(d.y, d.x);
    const float TAU = 6.2831853;
    float s = a / TAU * rays;
    float tLog = log(r) * rays / TAU / max(uBurstRingScale, 0.05);
    float tLin = r / max(uBurstPitch, 1e-4);
    float t = mix(tLin, tLog, uBurstLog) + shift.y;
    s += shift.x;
    // Every other ring turned half a cell, so the dashes sit like bricks.
    s += mod(floor(t), 2.0) * 0.5 * uBurstStagger;
    vec2 id = vec2(floor(s), floor(t));
    // Only so many rings: counted outward from uBurstCore card widths, where
    // the dashes are about to shrink into the dense centre. Cut on whole rings
    // so the burst ends on complete ovals rather than fading out mid-shape.
    float t0 = mix(uBurstCore / max(uBurstPitch, 1e-4),
                   log(max(uBurstCore, 1e-4)) * rays / TAU
                     / max(uBurstRingScale, 0.05), uBurstLog) + shift.y;
    float keepRing = step(id.y, floor(t0) + uBurstMaxRings - 0.5);
    vec2 f = vec2(fract(s), fract(t)) - 0.5;
    // Footprint in cell units, for antialiasing. atan jumps by a full turn
    // behind the centre, so the angle's derivative is taken from whichever of
    // two seams is not there.
    float da = min(fwidth(a), fwidth(mod(a + TAU, TAU)));
    vec2 fw = vec2(da / TAU * rays, fwidth(t));
    // A pointed oval along the ray: full width at its middle, tapering to a
    // point at either end. In units of the dash's own half-size, its edge is
    // |u| = 1 - |v|^n — n = 2 is a lens, 1 a diamond, higher blunts the tips
    // toward a rounded spindle. Antialiased on that edge function's own
    // screen-space slope.
    float halfW = max(uBurstWidth * 0.5 * size, 1e-3);
    float halfL = max(uBurstDash * 0.5 * size, 1e-3);
    vec2 uv2 = vec2(f.x / halfW, f.y / halfL);
    float edgeFn = abs(uv2.x) - (1.0 - pow(min(abs(uv2.y), 1.0), uBurstPoint));
    edgeFn = max(edgeFn, abs(uv2.y) - 1.0);
    // The edge's softness from the continuous coordinates, not fwidth() of
    // the edge function itself: that jumps where fract() wraps at a cell
    // boundary, which drew a faint hairline down the middle of every gap.
    float ew = max(max(fw.x / halfW, fw.y / halfL) * 1.5, 1e-4);
    float dash = 1.0 - smoothstep(-ew, ew, edgeFn);
    // Near the centre the cells shrink to nothing; below a pixel or two, draw
    // their average instead of beating against the pixel grid.
    float footprint = max(fw.x, fw.y);
    float fill = uBurstPoint / (uBurstPoint + 1.0);
    dash = mix(dash, min(uBurstWidth * uBurstDash * size * size, 1.0) * fill,
               smoothstep(0.4, 1.0, footprint));
    return vec4(dash * keepRing, cellHash(id + 71.0 + shift * 13.0).x, a, r);
  }

  /* Stars, generated: one per cell at most, in a jittered grid like the dots.
   *
   * Two shapes can be mixed: uStarPoints with tips at full radius and valleys
   * at uStarInner of it (5 and 0.45 is a cartoon star, 4 and 0.15 a thin
   * sparkle), and a second shape for uStarMix of the stars. uStarDensity is
   * the share of cells that hold a star at all, so the field can be sparse.
   *
   * Returns coverage, the star's identity hash, and its centre in card units.
   */
  vec4 starField(vec2 p) {
    vec2 n = floor(p);
    float footprint = length(fwidth(p));
    float best = 0.0;
    vec2 bestCell = n, bestCentre = n + 0.5;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 cell = n + vec2(float(i), float(j));
        vec2 h = cellHash(cell + 211.0);
        if (h.x > uStarDensity) continue;
        vec2 centre = cell + 0.5 + (cellHash(cell + 223.0) - 0.5) * 0.7;
        float size = uStarSize
          * (1.0 + (cellHash(cell + 227.0).x - 0.5) * 2.0 * uStarSizeVar);
        bool alt = cellHash(cell + 229.0).y < uStarMix;
        float k = alt ? uStarPoints2 : uStarPoints;
        float inner = alt ? uStarInner2 : uStarInner;
        vec2 q = p - centre;
        float ang = atan(q.y, q.x) + h.y * 6.2831853 * uStarSpin;
        // 0 along a tip, 1 halfway between two.
        float t = abs(fract(ang * k / 6.2831853 + 0.5) - 0.5) * 2.0;
        float edge = length(q) - size * mix(1.0, inner, t);
        float w = max(footprint * 0.6, 1e-4);
        float cover = 1.0 - smoothstep(-w, w, edge);
        if (cover > best) { best = cover; bestCell = cell; bestCentre = centre; }
      }
    }
    return vec4(best, cellHash(bestCell + 233.0).x, bestCentre);
  }

  void main() {
    // Map the plane's UV onto the card's region of the square texture.
    // No y-flip here: three.js already uploads textures with flipY, so
    // inverting again would stand the card on its head.
    vec2 uv = vec2(mix(uCrop, 1.0 - uCrop, vUv.x), vUv.y);

    vec4 card = texture2D(uCard, uv);

    // White plate: bright where foil belongs. Its own luminance is the weight,
    // so the pattern inside it survives instead of being flattened to a region.
    // Weighted per channel. Most plates are greyscale and the defaults are the
    // luma weights, so nothing changes for them; the RGB Mews pack a different
    // region into each channel, and there the weights pick which is the plate.
    float plate = dot(texture2D(uMask, uv).rgb, vec3(uPlateR, uPlateG, uPlateB));

    vec4 pat = texture2D(uPattern, uv * uPatternScale, uBlur);

    // Role 0 displaces the spectrum lookup; the offset is needed before the
    // sweep is built, so it is read here and the motif work waits until the
    // light position is known.
    vec2 warp = vec2(0.0);
    if (uMode < 0.5) warp = pat.rg * 2.0 - 1.0;          // R,G offset
    else if (uMode > 2.5) warp = vec2(pat.a, pat.g) * 2.0 - 1.0;  // DXT5nm

    // Every shard displaces the spectrum by its own fixed amount, so the card
    // reads as a field of small facets rather than one sheet. Aspect-corrected,
    // or the cells come out as tall rectangles on a card that is not square.
    //
    // Kept out of the warp vector, which is scaled by uWarp — and an effect
    // with no pattern texture sets uWarp to zero, which cancelled the shatter
    // completely. Only the seams showed, which is not the effect.
    // Sampled here rather than further down, because the shatter below has to
    // know where the relief is in order to keep off it.
    /* One knob for how present the relief is, rather than three.
     *
     * Turning the light down alone does not make a mark go away: it still
     * shifts the spectrum, still gates the foil, and — for a card with the
     * shatter on — still keeps the facets off itself, which leaves the shape
     * plainly visible as a smooth patch in a broken field even at zero
     * brightness. Blending the sampled relief itself is the honest control,
     * because every term downstream is derived from it: at 0 the card is
     * exactly as if there were no overlay at all.
     */
    // The mark's shape and how strongly it shows are separate questions.
    //
    // etchShape is where the relief is, at full strength, whatever the blend.
    // etch is how much of it is seen. Scaling the shape by the blend meant that
    // turning the ball down also let the facets back through it — at a blend of
    // 0.4 the shatter was cutting the ball into pieces at 60% strength, which
    // is not a fainter ball, it is a broken one.
    float etchShape = dot(texture2D(uEtch, uv).rgb, vec3(uEtchR, uEtchG, uEtchB))
                    * uHasEtch;
    float etch = etchShape * uEtchMix;

    float shardEdge = 0.0;
    float shardPhase = 0.0;
    float shardTilt = 0.0;
    float shardGain = 0.0;
    if (uShatter > 0.0) {
      vec4 cell = shatter(vec2(uv.x / ASPECT_R, uv.y) * uShatterScale);
      vec2 h = cellHash(cell.xy + 17.0);
      // Where this facet sits in the band pattern, and how steeply it lies.
      // The first shifts its colour; the second decides *when* it catches —
      // a shard tilted differently to its neighbours reaches its bright point
      // at a different angle, so they light one after another as the card
      // turns rather than all at once.
      shardPhase = (h.x - 0.5) * 2.0 * uShatter;
      shardTilt = (h.y - 0.5) * 2.0 * uShatter;
      // How much foil this facet shows at all.
      //
      // Phase and tilt only move the colour about, and on a pale card the foil
      // is a couple of levels of brightness to begin with — measured on
      // rsv10-5 001, turning the foil off entirely changes the card body by 2.4
      // of 255. Shifting the hue of something that faint is invisible. Real
      // shattered glass differs facet to facet in how much it catches, not just
      // in what colour, so each cell gets its own gain.
      shardGain = (cellHash(cell.xy + 91.0).x - 0.5) * 2.0 * uShatterGain;
      shardEdge = 1.0 - smoothstep(0.0, max(uShatterEdge, 0.001), cell.w);
      // The relief sits on top of the shattering, not inside it. On a real card
      // the ball is pressed into the surface as one piece and catches the light
      // as one piece; letting the facets cut through it broke it into a mosaic
      // of unrelated colours and lost the shape.
      // Keyed to the shape, so a faint ball is still one whole ball. Gated by
      // whether there is an overlay at all: at a blend of zero there is no
      // mark, and the facets should run straight through where it would be.
      float present = step(0.001, uEtchMix);
      float clear = 1.0 - clamp(etchShape * uShatterClear * present, 0.0, 1.0);
      shardPhase *= clear;
      shardTilt *= clear;
      shardEdge *= clear;
      shardGain *= clear;
    }

    // Sample the spectrum at a coordinate driven by viewing angle and position.
    // Tilting the card sweeps this, so the hue travels across the surface the
    // way a real diffraction foil does.
    float angle = vFacing;
    // uBands is how many times the spectrum repeats across the card. One trip
    // reads as a single pastel wash; several narrow bands is what makes the
    // colour look saturated rather than smeared.
    //
    // Both axes carry a weight, so bands can face any way: (1, 0) vertical,
    // (0, 1) horizontal, (1, -1) the bottom-left to top-right diagonal. With x
    // pinned at 1, as it was, horizontal could not be expressed at all. A second
    // layer has its own weights and pitch — SvHolo lays two about 20 degrees
    // either side of horizontal, and their crossings draw its lattice.
    float warpTerm = (warp.x + warp.y) * 0.5 * uWarp + shardPhase;
    float spatial  = (uv.x * uDirX  + uv.y * uDir ) * 0.5 * uBands  + warpTerm;
    float spatial2 = (uv.x * uDirX2 + uv.y * uDir2) * 0.5 * uBands2 + warpTerm;

    // Where you are on the card is fixed to the print; where the light is moves
    // with tilt, pointer and time.
    // shardTilt stands in for the facet's own angle: it rides the tilt term, so
    // as the angle sweeps with the card, each shard passes through its bright
    // point at a different moment instead of the whole field flaring together.
    float lightPos = (uPointer.x - 0.5) * uSpread
                   + (1.0 - angle) * uSpread * 2.0 * (1.0 + shardTilt)
                   + shardTilt * uSpread
                   + uTime * uSpeed;
    // Engraving is relief, not a region: the lines sit at a different angle to
    // the flat plate around them, so they pick up a different part of the
    // spectrum and catch a little more light. That difference is what makes the
    // tracery visible at all.
    // Centred on its own mean, because the engraving is not sparse marks on a
    // blank field: measured on swsh12-5_160 it is 67% mid-tone, 29% bright, 3%
    // dark. Used raw it adds a near-constant offset — a flat brightness lift
    // with the hatching riding on top, which reads as grain sitting over the
    // colour rather than taking part in it. Centred, each line pushes the
    // spectrum lookup either side of its neighbours, so the grain is coloured
    // by the rainbow instead of laid on top of it.
    float etchTerm = (etch - 0.5) * 2.0 * uEtchWarp;

    // Motifs modulate the foil rather than displacing it.
    //
    // Confetti_Dots packs three near-disjoint sets of specks into R, G and B —
    // 94% of its lit pixels appear in exactly one channel — so collapsing it
    // with luma() fuses three sparkle layers into one flat sheet. Instead each
    // channel catches the light a third of a cycle apart, so the specks twinkle
    // in and out independently as the card moves. A greyscale texture, where
    // the channels agree, simply behaves as it did before.
    float structure = 1.0;
    float sparkle = 0.0;
    if (uMode >= 0.5 && uMode < 2.5) {
      vec3 phase = vec3(0.0, 0.3333, 0.6667);
      vec3 twinkle = 0.5 + 0.5 * cos(6.2831853 * (lightPos - phase));
      twinkle = mix(vec3(1.0), twinkle, uTwinkle);
      // Max, not sum: a speck lives in one channel, so summing and dividing by
      // three caps a fully lit dot at a third of its brightness — under the
      // cutoff, which culled every one of them. Taking the strongest channel
      // keeps a lit speck at full strength while still letting its own layer's
      // twinkle dim it.
      vec3 lit = pat.rgb * twinkle;
      float motif = (uMode < 1.5) ? max(lit.r, max(lit.g, lit.b)) : pat.a;
      // Cull the dimmer specks. Scaling the texture down shrinks each dot but
      // packs more of them in, so size and count need separate controls — this
      // drops everything below a brightness, leaving fewer but brighter ones.
      motif = smoothstep(uMotifCut, 1.0, motif);
      // Additive: the plate shines everywhere and the specks sparkle on top.
      structure = 1.0 + motif * uWarp;
      sparkle = motif;
    }
    // FX_T_Spectrum_Bands_Blotches varies down its height as well as across, so
    // a v that shifts along the band direction gives neighbouring bands
    // different colours.
    float v = fract((uv.x * uDirX - uDir * uv.y) * 0.5 + uPointer.y * 0.3);

    // Two layers, summed: where they cross, both contribute and the crossing
    // reads brighter than either band alone.
    // The second layer travels against the first when uLight2 is negative, so
    // the two sets slide past each other as the light moves and their crossings
    // sweep across the card instead of sitting still. At some angles they meet
    // only at an edge; at others they cross the middle.
    vec3 rawA, rawB;
    vec3 layerA = bandLayer(spatial, lightPos, etchTerm, v, rawA);
    vec3 layerB = bandLayer(spatial2, lightPos * uLight2, etchTerm, v, rawB)
                * uLayer2;
    vec3 rawColour = mix(rawA, rawB, uLayerMul * 0.5 + uLayer2 * 0.25);

    // Summed, two crossing combs draw a lattice of lines. Multiplied, they
    // light only where both are lit, which turns the crossings into filled
    // cells — squares, if the two are perpendicular. The 4x compensates for
    // multiplying two values that are each at most 1.
    vec3 spectrum = mix(layerA + layerB, layerA * layerB * 4.0, uLayerMul);

    // Foil adds light; it never darkens the art beneath.
    // The foil layer sits beneath the ink, so dark ink absorbs the light on its
    // way back out — a black area of a card reflects far less than a white one.
    // Without this the screen blend does the opposite: it lifts blacks by the
    // full foil value and leaves highlights alone, so dark cards blow out while
    // bright ones look right at the same intensity.
    float ink = mix(1.0, luma(card.rgb), uInk);

    structure *= 1.0 + (etch - 0.5) * 2.0 * uEtchBoost;
    structure *= 1.0 + shardGain;

    // Specks can have a shine of their own rather than only amplifying the band
    // they sit on. Multiplying, which is what structure does, ties a star to
    // its band's colour and brightness, so a star over a dim band stays dim.
    // Added separately it keeps its own character — white by default, which is
    // what makes it read as a glint rather than as a brighter patch of foil.
    vec3 sparkleColour = mix(spectrum, vec3(1.0), uSparkleWhite);
    // How far off-centre the pointer is, 0 in the middle and 1 at a corner.
    // pokemon-cards-css scales nearly every layer by this, and it is the one
    // structural thing our model lacked: a foil should be quiet viewed square
    // on and intensify as the card is turned away, rather than being equally
    // lively wherever you point. 0.5 spans 0.75x to 1.25x, as theirs does.
    float offCentre = clamp(
      length((uLocal - 0.5) * vec2(1.0, 1.0 / uCardAspect)) / 0.5, 0.0, 1.0);
    float offGain = 1.0 + uEdgeGain * (offCentre - 0.5);

    // The engraving as a stencil. Its dark lines are the cut metal that
    // catches the light; the bright field between them is flat card. Gating
    // here means the rainbow appears only along the lines rather than washing
    // over the whole plate with the lines merely tinting it.
    float lines = mix(1.0, 1.0 - etch, uEtchGate * uHasEtch);

    vec3 foil = (spectrum * structure + sparkleColour * sparkle * uSparkleGain)
              * plate * lines * uIntensity * ink * offGain;

    // Screen blend keeps highlights from clipping the way additive does.
    vec3 outc = 1.0 - (1.0 - card.rgb) * (1.0 - foil);

    // But screen can only lighten: over a saturated area it lifts all three
    // channels and the artwork's hue still wins, so a pink panel stays pink
    // however green the foil is. A foil catching the light does the opposite —
    // it overrides the ink's colour and keeps only its light and dark. So where
    // the foil is strong, mix toward its own hue carrying the card's luminance.
    // Driven by the plate rather than by how bright the foil happens to be: a
    // secret rare is metal across its whole plate, and the bands are the light
    // moving over it, not the extent of it. Gating on foil brightness left the
    // gaps between bands showing the ink underneath, so a pink panel stayed
    // pink however much rainbow ran across it.
    vec3 hue = rawColour / max(max(rawColour.r,
                                   max(rawColour.g, rawColour.b)), 0.001);
    // Weighted to hold the card's own brightness. At 0.62 the metal path was
    // dimmer than the artwork it replaced, so a card with foilover high — a
    // secret rare, where most of the plate takes it — came out darker overall
    // the more foil it had, which is backwards.
    vec3 metal = hue * (0.10 + 0.95 * luma(card.rgb) + 0.55 * luma(foil));
    outc = mix(outc, metal, clamp(plate * lines * uFoilOver, 0.0, 1.0));

    /* Three foil layers from one mask, one per channel.
     *
     * The RGB Mews carry a third mask, _foil_, with a different region in each
     * channel: R the background rays and frame, G Mew's shading and the ground
     * swirl, B Mew's outline and the energy circles. Each channel gets a
     * rainbow layer of its own that catches the light at its own angle
     * (uChanPhase*, in fractions of a cycle), so the three regions light in
     * turn as the card tilts. uChanTint pulls each toward its own primary.
     *
     * Not verified: the card is a secret rare and TCG Live does not show it,
     * so this is designed by eye from the channels, not matched to the game.
     */
    if (uChan > 0.0) {
      vec3 fm = texture2D(uFoilMask, uv).rgb;
      float along = (uv.x * uDirX + uv.y * uDir) * 0.5 * uChanBands;
      vec3 gains = vec3(uChanR, uChanG, uChanB);
      vec3 phases = vec3(uChanPhaseR, uChanPhaseG, uChanPhaseB);
      for (int ch = 0; ch < 3; ch++) {
        float m = fm[ch] * gains[ch];
        if (m <= 0.0) continue;
        float ph = phases[ch];
        vec3 cc = texture2D(uSpectrum,
          vec2(fract(along + lightPos * 0.25 + ph), 0.5)).rgb;
        cc /= max(max(cc.r, max(cc.g, cc.b)), 0.001);
        vec3 primary = vec3(float(ch == 0), float(ch == 1), float(ch == 2));
        cc = mix(cc, primary, uChanTint);
        cc = mix(vec3(1.0), cc, uChanChroma);
        float glint = mix(1.0,
          pow(0.5 + 0.5 * cos(6.2831853 * (lightPos * 0.25 - ph)),
              max(uChanWidth, 0.1)),
          uChanSel);
        // The R channel is a fan of rays, and rays catch the light like a
        // circular grating: brightest in a bow tie through their centre that
        // lies across the light, swinging round as the card tilts.
        // uRayShine is how much of the fan that confines it to; uRayBoost
        // lifts the rays inside the bow tie above the rest.
        if (ch == 0 && uRayShine > 0.0) {
          vec2 rc = vec2(uRayX, (1.0 - uRayY) / uCardAspect);
          vec2 rd = vec2(vUv.x, vUv.y / uCardAspect) - rc;
          vec2 Lr = uPointer - 0.5;
          float bowR = pow(0.5 + 0.5 * cos(2.0 * (atan(rd.y, rd.x)
                                 - atan(Lr.y, Lr.x + 1e-5))),
                           max(uRayWidth, 0.1));
          glint *= mix(1.0, bowR * (1.0 + uRayBoost), uRayShine);
        }
        float lit = m * glint * uChan * offGain;
        outc = 1.0 - (1.0 - outc) * (1.0 - clamp(cc * lit, 0.0, 1.0));
        vec3 chMetal = cc * (0.25 + 0.85 * luma(card.rgb));
        outc = mix(outc, chMetal, clamp(lit * uChanOver, 0.0, 1.0));
      }
    }

    /* Stars over the card, lit by a band that sweeps with the light.
     *
     * In TCG Live the stars do not all show at once: lying flat, a 30th
     * Celebration Classic Collection Charizard shows them only along its right
     * border; tilted, they move to the left border and the art. So each star
     * is lit by where it sits along a band — uStarBands of them across the card
     * in the band direction — and the band travels with the light
     * (uStarTravel). uStarSel is how strictly that holds; 0 lights them all.
     */
    if (uStars > 0.0) {
      vec2 sp = vec2(vUv.x, vUv.y / uCardAspect);
      vec4 st = starField(sp * uStarScale);
      if (st.x > 0.0) {
        vec2 cuv = st.zw / uStarScale;
        float along2 = (cuv.x * uDirX + cuv.y * uCardAspect * uDir) * 0.5;
        float phase = along2 * uStarBands - lightPos * 0.25 * uStarTravel
                    + st.y * uStarJitter;
        float band = pow(0.5 + 0.5 * cos(6.2831853 * phase),
                         max(uStarWidth, 0.1));
        float vis = mix(1.0, band, uStarSel);
        // A star's colour moves with the light at the same rate as its band,
        // so one control sets how lively the stars are.
        vec3 sc = texture2D(uSpectrum, vec2(fract(st.y * 3.7
                    + lightPos * 0.1 * uStarTravel), 0.5)).rgb;
        sc /= max(max(sc.r, max(sc.g, sc.b)), 0.001);
        sc = mix(vec3(1.0), sc, uStarChroma);
        float wherePlate = mix(1.0, plate, uStarPlate);
        float lit = st.x * vis * wherePlate * uStars;
        outc = 1.0 - (1.0 - outc) * (1.0 - clamp(sc * lit, 0.0, 1.0));
        outc = mix(outc, sc * (0.35 + 0.75 * luma(card.rgb)),
                   clamp(lit * uStarOver, 0.0, 1.0));
      }
    }

    // The fireworks, on top of the foil like the dots. Up to four, each two
    // sets of pointed ovals laid over each other that catch the light
    // differently, so as the card turns one set lights while the other fades.
    // Bursts simply screen over one another where they overlap.
    if (uBurst > 0.0) {
      vec2 pc = vec2(vUv.x, vUv.y / uCardAspect);
      vec2 L = uPointer - 0.5;
      float la = atan(L.y, L.x + 1e-5);

      // Where on the card: uBurstPlate keeps it to where the plate is dark —
      // in the game it shows in the card body, not on the face or art — and
      // uBurstBorder keeps it off the frame, which carries the dots instead.
      float edgeDist = min(min(vUv.x, 1.0 - vUv.x),
                           min(vUv.y, 1.0 - vUv.y) / uCardAspect);
      float bw = max(uDotEdgeWidth, 1e-3);
      float frame = 1.0 - smoothstep(bw - 0.006, bw + 0.002, edgeDist);
      float where = mix(1.0, 1.0 - plate, uBurstPlate)
                  * (1.0 - frame * uBurstBorder);

      // Identical bursts, each at its own centre — y from the top, as on the
      // printed card. On the real card they are scattered, not in a grid,
      // and overlap freely; where they do, they screen over one another.
      //
      // Up to twelve are placed by hand (uBurstCount of them), then up to
      // twenty-four more are scattered by the R2 low-discrepancy sequence
      // (uBurstScatter of them): evenly over the card with no clumps or bare
      // patches, and the same every time.
      vec2 at8[12];
      at8[0] = vec2(uBurstX, uBurstY);
      ${BURST_EXTRA.map((n) => `at8[${n - 1}] = vec2(uBurst${n}X, uBurst${n}Y);`).join("\n      ")}

      // How far a burst reaches, so a fragment can skip the ones that cannot
      // touch it rather than evaluating every burst everywhere.
      float outerR = (uBurstLog > 0.5)
        ? uBurstCore * exp((uBurstMaxRings + 1.0) * 6.2831853 / uBurstRays
                           * max(uBurstRingScale, 0.05))
        : uBurstCore + (uBurstMaxRings + 1.0) * uBurstPitch;
      outerR *= 1.0 + uBurstBShiftT * 0.1;

      for (int n = 0; n < 36; n++) {
        vec2 at;
        if (n < 12) {
          if (float(n) >= uBurstCount) continue;
          at = at8[n];
        } else {
          float m = float(n - 12);
          if (m >= uBurstScatter) break;
          at = fract(vec2(0.5) + (m + 1.0) * vec2(0.7548777, 0.5698403));
        }
        vec2 c = vec2(at.x, (1.0 - at.y) / uCardAspect);
        if (length(pc - c) > outerR) continue;

        // Each burst catches the light from its own direction, spread round
        // the circle by the golden angle so no two neighbours in the list
        // share one. Tilt toward a burst's direction and it lights; others
        // stay dark — so bursts that overlap take turns rather than showing
        // at once. uBurstCatch 0 lights them all together.
        float catchAt = float(n) * 2.3999632;
        float facing = 0.5 + 0.5 * cos(la - catchAt);
        float catchLit = mix(1.0, pow(facing, max(uBurstCatchWidth, 0.1)),
                             uBurstCatch);
        if (catchLit < 0.003) continue;
        for (int k = 0; k < 2; k++) {
          bool second = k == 1;
          float amount = second ? uBurstB : 1.0;
          if (amount <= 0.0) continue;
          vec4 b = second
            // An exact rotation about the centre, as a fraction of the angle
            // between neighbouring rays (360 / rays degrees) — which is also
            // the grid's own unit round the ring. 0.5 puts every B oval
            // exactly halfway between two A ovals, whatever the ray count.
            ? burstDash(pc, c, vec2(uBurstBTurnFrac, uBurstBShiftT),
                        uBurstBSize, uBurstRays)
            : burstDash(pc, c, vec2(0.0), 1.0, uBurstRays);
          // A circular grating lights where its grooves run across the light,
          // so a bright bow tie of rays swings round with the tilt. The second
          // set's grooves lie uBurstBTurn away from the first, so its bow tie
          // is elsewhere; uBurstSpoke is how much of the burst that confines
          // each set to — 0 lights every ray.
          float turn = second ? uBurstBTurn : 0.0;
          float bow = pow(0.5 + 0.5 * cos(2.0 * (b.z - la - turn)),
                          max(uBurstSpokeWidth, 0.1));
          float glint = mix(1.0, bow, uBurstSpoke)
                      * mix(1.0, b.y * 2.0, uBurstSparkle);
          // Brightest at the centre, fading with distance.
          float env = exp(-b.w / max(uBurstReach, 0.01));
          // Rainbow rings that slide with the light — the second set at its
          // own rate, by default the opposite way.
          float travel = second ? uBurstBTravel : 1.0;
          // Back and forth across a window of the ramp rather than round all
          // of it, so part of the rainbow — the violet to pink end, which read
          // as too purple — can be left out without a hard jump where the
          // window would otherwise wrap.
          float hx = fract(b.w * uBurstHue + lightPos * 0.25 * travel
                           + b.y * uBurstJitter + (second ? 0.5 : 0.0));
          float hu = uBurstRampStart + uBurstRampSpan * (1.0 - abs(2.0 * hx - 1.0));
          vec3 bc = texture2D(uSpectrum, vec2(fract(hu), 0.5)).rgb;
          bc /= max(max(bc.r, max(bc.g, bc.b)), 0.001);
          bc = mix(vec3(1.0), bc, uBurstChroma);
          float lit = b.x * glint * env * where * uBurst * amount * catchLit;
          outc = 1.0 - (1.0 - outc) * (1.0 - clamp(bc * lit, 0.0, 1.0));
          vec3 burstMetal = bc * (0.25 + 0.85 * luma(card.rgb));
          outc = mix(outc, burstMetal, clamp(lit * uBurstOver, 0.0, 1.0));
        }
      }
    }

    // The cuts themselves. Shattered foil is brightest along the seams, where
    // the facets meet and the edge catches — without them the tessellation
    // reads as blotches of colour rather than as broken glass. Gated by the
    // plate, so the cuts stop where the foil does.
    outc += vec3(shardEdge * uShatterLine * plate * lines);

    // A screen blend pushes every channel toward white, so wherever the foil is
    // strong it drains colour — the brighter the highlight, the greyer it gets.
    // Pushing saturation back out around the composite's own luminance restores
    // what the blend flattened, without touching brightness.
    outc = mix(vec3(luma(outc)), outc, uSaturate);

    /* A plain glow: one soft, broad highlight that slides across the foil as
     * the card tilts — what a smooth sheet of foil does under a single light,
     * with no bands or pattern in it. uGlowMirror 1 puts it opposite the tilt,
     * like a reflection; 0 follows it. Weighted by the plate (uGlowPlate), so
     * on a card with foil only at the frame, only the frame glows.
     */
    if (uGlow > 0.0) {
      vec2 gp = mix(uPointer, 1.0 - uPointer, uGlowMirror);
      vec2 gd = (vUv - gp) * vec2(1.0, 1.0 / uCardAspect);
      float g = exp(-pow(length(gd) / max(uGlowSize, 0.01), max(uGlowSoft, 0.5)));
      // Rainbow rings outward from the highlight's centre (uGlowHue per card
      // width), and the whole palette turns with the light.
      vec3 gc = texture2D(uSpectrum, vec2(fract(lightPos * 0.25
                    + length(gd) * uGlowHue), 0.5)).rgb;
      gc /= max(max(gc.r, max(gc.g, gc.b)), 0.001);
      gc = mix(vec3(1.0), gc, uGlowChroma);
      float gw = mix(1.0, plate, uGlowPlate);
      outc = 1.0 - (1.0 - outc) * (1.0 - clamp(gc * g * gw * uGlow, 0.0, 1.0));
    }

    // The dot screen, a layer of its own on top of the foil — and after the
    // saturation push, which exists to undo the foil's screen blend. Applied
    // to the dots it turned pastel specks into dark purple and olive ones. Square cells in
    // card units, so a dot is round whatever the card's proportions.
    if (uDots > 0.0) {
      vec3 g = dotGrid(vec2(vUv.x, vUv.y / uCardAspect) * uDotScale);
      vec2 id = g.yz;
      vec2 h = cellHash(id + 41.0);
      // Each dot sits at its own place in the spectrum and reaches its bright
      // point at its own angle.
      float phase = lightPos + (h.x - 0.5) * 2.0 * uDotJitter;
      // The whole ramp across the field, so neighbouring dots can be any hue —
      // scaling the jitter down to a quarter of it left them all one family.
      vec3 dc = texture2D(uSpectrum,
        vec2(fract(lightPos * 0.25 + h.x * uDotJitter), 0.5)).rgb;
      // Pastel: from white toward the spectrum, not from grey. Measured on a
      // Pikachu Rare, a dot is near-white light tinted pink, cyan or yellow —
      // desaturating toward luminance instead made them dull grey.
      // uDotWarm turns the white toward pale gold: unscreened, the dots on
      // both the yellow face and the black ear tips have blue about 30% under
      // red, so the flakes themselves are warm, not the ink beneath them.
      // The hue at full brightness first: the ramp has dark stretches, and
      // mixing toward one of those gave muddy olive and mauve chips where the
      // game shows clean pastels.
      dc /= max(max(dc.r, max(dc.g, dc.b)), 0.001);
      dc = mix(mix(vec3(1.0), vec3(1.0, 0.94, 0.70), uDotWarm), dc, uDotChroma);
      float glint = mix(1.0,
        pow(0.5 + 0.5 * cos(6.2831853 * (lightPos * 0.5 - h.y)), 3.0),
        uDotTwinkle);
      // How strongly a region shows dots: the plate says where foil is, and
      // uDotPlate decides how much that matters — 0 spreads them evenly over
      // the whole card. The border gets its own lift, measured in card widths
      // in from the nearest edge.
      float edgeDist = min(min(vUv.x, 1.0 - vUv.x),
                           min(vUv.y, 1.0 - vUv.y) / uCardAspect);
      // A plateau over the frame, falling off at its inner edge, rather than a
      // ramp from the outer edge: the whole silver border is equally dotted.
      float bw = max(uDotEdgeWidth, 1e-3);
      float border = 1.0 - smoothstep(bw - 0.006, bw + 0.002, edgeDist);
      float where = mix(1.0, plate, uDotPlate) + uDotEdge * border;
      // No ink absorption, unlike the foil beneath. The dots sit over the
      // print: on the Pikachu Rare the dots on the black ear tips and on the
      // yellow face work out, unscreened, to the same colour (about 0.75 grey
      // with a warm tint), so dark ink takes nothing from them.
      vec3 dots = dc * g.x * glint * where * uDots * offGain;
      outc = 1.0 - (1.0 - outc) * (1.0 - clamp(dots, 0.0, 1.0));
      // Screen alone cannot show a dot on a pale area — the Pikachu face is a
      // yellow near white already, and lightening it changes nothing. A lit dot
      // of foil replaces the ink's colour with its own, keeping the brightness,
      // which is what makes it visible there.
      vec3 dotMetal = dc / max(max(dc.r, max(dc.g, dc.b)), 0.001)
                    * (0.25 + 0.85 * luma(card.rgb));
      outc = mix(outc, dotMetal,
                 clamp(g.x * glint * where * uDots * uDotOver, 0.0, 1.0));
    }

    // In card units, so the corner rounding below stays round rather than
    // stretching with the card's proportions.
    vec2 pos = (vUv - 0.5) * vec2(1.0, 1.0 / uCardAspect);

    // Card corners, as a rounded rectangle rather than the square the plane
    // gives us. Distance to a rounded rect, in the same card units: outside it
    // the fragment is dropped, and the last fraction of a unit is feathered so
    // the edge is not a staircase. Fixed feather width rather than fwidth(),
    // which needs a derivatives extension that is not guaranteed here.
    vec2 extent = vec2(0.5, 0.5 / uCardAspect) - vec2(uCorner);
    vec2 d2 = abs(pos) - extent;
    float sdf = length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0) - uCorner;
    float edge = 1.0 - smoothstep(-0.0025, 0.0025, sdf);

    gl_FragColor = vec4(clamp(outc, 0.0, 1.0), card.a * edge);
  }
`;

export function makeLoader(renderer) {
  const loader = new THREE.TextureLoader();
  // `crisp` keeps a texture off the mip chain, for fine line work that
  // filtering would erase.
// Everything is sampled raw, with no transfer function applied.
//
// A ShaderMaterial writes gl_FragColor straight out — three only appends the
// encode-back-to-sRGB step to its own materials — so if the textures were
// decoded to linear on sample, the result would be written to an sRGB canvas
// without ever being re-encoded, and the whole card would come out dark.
// Sampling raw keeps the composite in the same space as the source PNGs, so
// with the foil at zero the output equals the artwork exactly.
//
// It suits the distortion maps too: their R and G are offsets, not colour, and
// a transfer function would bend those numbers non-linearly.
  return (url, crisp = false) =>
  new Promise((res, rej) => loader.load(url, (t) => {
      t.colorSpace = THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = crisp ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = !crisp;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      res(t);
  }, undefined, rej));
}

// Decals add sparkle on top of the plate rather than gating it, so this is a
// boost above 1.0, not a 0..1 blend. Rain is drawn by neither: the game shows
// only a diagonal rainbow on those cards.
const STRENGTH = { T_Holofoil_Rain: 0.0 };
function defaultStrength(pattern) {
  return STRENGTH[pattern] ?? 1.5;
}

// A fresh uniform set per card. Cards in a grid differ in everything from band
// direction to whether they have an engraving at all, so none of this can be
// shared between them.
export function makeUniforms(mode, patternName) {
  return {
    uCard: { value: null },
    uMask: { value: null },
    uPattern: { value: null },
    uSpectrum: { value: null },
    uSpectrum2: { value: null },
    uEtch: { value: null },
    uFoilMask: { value: null },
    // Which channels of the plate and the engraving count, and how much. The
    // luma weights by default, which is what reading them as greyscale did.
    uPlateR: { value: 0.299 }, uPlateG: { value: 0.587 }, uPlateB: { value: 0.114 },
    uEtchR: { value: 0.299 }, uEtchG: { value: 0.587 }, uEtchB: { value: 0.114 },

    /* Three layers from the _foil_ mask, one per channel; off unless asked for.
     *
     * uChan              overall strength; 0 turns them off
     * uChanR, G, B       each channel's strength
     * uChanPhaseR, G, B  where in the light's cycle each catches, 0..1
     * uChanSel           how far each keeps to its own angle; 0 all together
     * uChanWidth         higher narrows each one's window of light
     * uChanBands         rainbow repeats across the card
     * uChanTint          0 rainbow, 1 each its own primary — red, green, blue
     * uChanChroma        0 white, 1 full colour
     * uChanOver          how far a lit layer replaces the ink's colour
     */
    uChan: { value: 0.0 },
    uChanR: { value: 1.0 }, uChanG: { value: 1.0 }, uChanB: { value: 1.0 },
    uChanPhaseR: { value: 0.0 }, uChanPhaseG: { value: 0.3333 },
    uChanPhaseB: { value: 0.6667 },
    uChanSel: { value: 0.7 },
    uChanWidth: { value: 2.0 },
    uChanBands: { value: 2.0 },
    uChanTint: { value: 0.5 },
    uChanChroma: { value: 0.8 },
    uChanOver: { value: 0.0 },
    // A bow tie of light across the R channel's rays, swinging with the tilt.
    // uRayX, uRayY the rays' centre (y from the top); uRayShine how far the
    // rays keep to the bow tie, 0 off; uRayWidth narrows it; uRayBoost
    // brightens it.
    uRayShine: { value: 0.0 },
    uRayX: { value: 0.57 },
    uRayY: { value: 0.39 },
    uRayWidth: { value: 3.0 },
    uRayBoost: { value: 1.0 },

    /* Stars, off unless an effect asks for them.
     *
     * uStars            strength; 0 turns them off
     * uStarScale        grid cells across the card's width
     * uStarDensity      share of cells holding a star
     * uStarSize         star radius, as a fraction of its cell
     * uStarSizeVar      spread of sizes
     * uStarPoints/Inner the shape: tip count, and valley depth (0 spiky, 1 round)
     * uStarPoints2/Inner2, uStarMix  a second shape, for that share of stars
     * uStarSpin         random rotation per star; 0 all upright
     * uStarBands        lit bands across the card
     * uStarTravel       how fast the bands, and the stars' colours, move with
     *                   the light
     * uStarWidth        higher narrows each lit band
     * uStarJitter       per-star offset, so a band's edge is ragged
     * uStarSel          how strictly the bands gate them; 0 all lit
     * uStarChroma       0 white, 1 full colour
     * uStarOver         how far a lit star replaces the ink's colour
     * uStarPlate        how far the plate decides where they show; 0 anywhere
     */
    uStars: { value: 0.0 },
    uStarScale: { value: 24.0 },
    uStarDensity: { value: 0.35 },
    uStarSize: { value: 0.35 },
    uStarSizeVar: { value: 0.3 },
    uStarPoints: { value: 5.0 },
    uStarInner: { value: 0.45 },
    uStarPoints2: { value: 4.0 },
    uStarInner2: { value: 0.15 },
    uStarMix: { value: 0.0 },
    uStarSpin: { value: 1.0 },
    uStarBands: { value: 1.0 },
    uStarTravel: { value: 1.0 },
    uStarWidth: { value: 3.0 },
    uStarJitter: { value: 0.15 },
    uStarSel: { value: 1.0 },
    uStarChroma: { value: 0.6 },
    uStarOver: { value: 0.5 },
    uStarPlate: { value: 0.0 },

    /* A plain glow, on every card by default: a light shone on the card.
     * Full on the foil, about a third on the rest (uGlowPlate 0.7), mostly
     * white with a faint rainbow. Effects can still set their own.
     *
     * uGlow        strength; 0 turns it off
     * uGlowSize    radius, in card widths
     * uGlowSoft    falloff: 2 a soft gaussian, lower a long tail, higher a
     *              flatter spot with a sharper edge
     * uGlowMirror  1 opposite the tilt, like a reflection; 0 with it
     * uGlowChroma  0 white, 1 full rainbow
     * uGlowHue     rainbow rings per card width, outward from its centre
     * uGlowPlate   how far the plate decides where it shows; 0 everywhere
     */
    uGlow: { value: 0.4 },
    uGlowSize: { value: 0.45 },
    uGlowSoft: { value: 2.0 },
    uGlowMirror: { value: 1.0 },
    uGlowChroma: { value: 0.35 },
    uGlowPlate: { value: 0.7 },
    uGlowHue: { value: 1.0 },
    uHasEtch: { value: 0.0 },
    // How far the engraving shifts the hue along its lines, and how much it
    // varies the brightness. Both are applied around the etch's mid-point, so
    // they modulate rather than offset.
    uEtchWarp: { value: 0.5 },
    uEtchBoost: { value: 0.3 },
    // Confine the foil to the engraving's dark lines. 0 lets it cover the
    // whole plate, as it did before.
    uEtchGate: { value: 0.0 },
    // How much of the relief is there at all. 1 leaves the scraped engravings
    // exactly as they were.
    uEtchMix: { value: 1.0 },
    // 0 is the even rainbow ramp, 1 is the blotchy one with per-band colour.
    // Tuned to 0: the even ramp won once contrast and chroma were raised.
    uRampMix: { value: 0.0 },
    // Where in the spectrum the sweep starts, and how much of it it covers.
    uRampStart: { value: 0.0 },
    uRampSpan: { value: 1.0 },
    // Random per-strand offset into the ramp. 0 keeps neighbouring bands in step.
    uHueJitter: { value: 0.0 },
    // How far the palette itself rotates with the light. 0 keeps the verified
    // effects exactly as they were tuned.
    uHueTravel: { value: 0.0 },
    // The game drifts the light across the card on its own, independent of the
    // pointer. uSpeed is periods per second; 0 holds it still.
    uTime: { value: 0.0 },
    uSpeed: { value: 0.05 },
    uPointer: { value: new THREE.Vector2(0.5, 0.5) },
    // Where the pointer is on this card, 0..1 in its own uv. Drives how far
    // off-centre the view is, which is what gains the foil.
    uLocal: { value: new THREE.Vector2(0.5, 0.5) },
    // Foil gain by how far off-centre the pointer is: 0.5 spans 0.75x at the
    // middle to 1.25x at a corner, which is the range pokemon-cards-css uses.
    uEdgeGain: { value: 0.5 },
    // How far the foil overrides the artwork's colour where it is strong,
    // rather than only lightening it. 0 is screen blending alone.
    uFoilOver: { value: 0.0 },
    // Corner radius in card widths. A real card is about 3.5mm on a 63mm
    // width, so a touch over a twentieth.
    uCorner: { value: 0.055 },
    uCardAspect: { value: ASPECT },
    uIntensity: { value: 1.0 },
    // How far the light moves through the spectrum per unit of pointer and
    // tilt. At 6 a sweep across the card ran the bands through six rainbows
    // and the dot, burst and glow layers through one and a half, which read
    // as colour cycling under every small mouse movement. At 2 it is two for
    // the bands and half a rainbow for the rest. The three presets that set
    // their own were already lower.
    uSpread: { value: 2.0 },
    // One repeat across the card. These maps are low resolution, so any higher
    // count magnifies their cells into visible blocks.
    uPatternScale: { value: 1.0 },
    uWarp: { value: defaultStrength(patternName) },
    // Brightness below which a decal's specks are dropped entirely.
    uMotifCut: { value: 0.0 },
    // How independently the three packed speck layers twinkle. 0 lights all
    // three together, as collapsing the channels used to.
    uTwinkle: { value: 1.0 },
    // A shine of the specks' own, added rather than multiplied. Gain 0 leaves
    // them amplifying the band beneath, as before; uSparkleWhite mixes their
    // colour from the band's toward plain white.
    uSparkleGain: { value: 0.0 },
    uSparkleWhite: { value: 1.0 },
    // Mip level to read the distortion map from. 0 is the raw cells; higher
    // values are progressively box-filtered copies, which is what turns the
    // noise field into a smooth gradient.
    // Only distortion fields want softening. A decal's stars and streaks *are*
    // the artwork, so blurring them just throws detail away.
    uBlur: { value: mode === 0 ? 2.0 : 0.0 },
    uMode: { value: mode },
    // Measured off side-by-sides with the game (sm1_039 Popplio, sm10_108
    // Murkrow): a few broad sweeps running bottom-left to top-right, separated
    // by dark gaps — not a dense repeating stripe pattern.
    uBands: { value: 3.0 },
    // Fraction of each period the rainbow occupies; the remainder is gap. At 1.0
    // the bands run continuously, which is what these cards were tuned to — the
    // gap only helped before hue spread was widened.
    uDuty: { value: 1.0 },
    // How selective the stripes are about the light angle. 0 lights them all
    // at once; higher values mean only those near their catch angle show.
    uDropout: { value: 0.0 },
    uDir: { value: -1.0 },
    // Weight on x. (1, 0) is vertical, (0, 1) horizontal, (1, -1) diagonal.
    uDirX: { value: 1.0 },
    // A second band layer, off unless uLayer2 is raised.
    uDirX2: { value: 1.0 },
    uDir2: { value: 1.0 },
    uBands2: { value: 8.0 },
    uLayer2: { value: 0.0 },
    // How the second layer's light term relates to the first. -1 makes it travel
    // the opposite way, so the crossings move.
    uLight2: { value: 1.0 },
    // 0 sums the two band layers, 1 multiplies them.
    uLayerMul: { value: 0.0 },
    // How much of the spectrum's colour survives. At 0 the foil is neutral
    // silver — the look of a steel-type reverse holo, which reflects metallically
    // rather than diffracting into a rainbow. At 1 it is the full ramp.
    uChroma: { value: 0.9 },
    // Band contrast; 1.0 would leave the spectrum ramp as authored.
    uContrast: { value: 1.8 },
    // Counteracts the screen blend's pull toward white. 1.0 is untouched.
    uSaturate: { value: 1.4 },
    // How much the card's own darkness absorbs the foil. 0 ignores the artwork
    // entirely (the old behaviour); 1 ties reflection fully to its luminance.
    uInk: { value: 0.6 },
    uCrop: { value: CROP },

    /* Shattered glass, off unless an effect asks for it.
     *
     * uShatter      how far each facet displaces the spectrum — the hue spread
     * uShatterScale cells across the card's width
     * uShatterEdge  how wide the seam between two facets reads
     * uShatterLine  how bright that seam is
     */
    uShatter: { value: 0.0 },
    uShatterScale: { value: 14.0 },
    uShatterEdge: { value: 0.06 },
    // Off: real shattered foil has no drawn lines between facets — the shards
    // are told apart by catching the light differently, not by an outline.
    uShatterLine: { value: 0.0 },
    // How completely the relief keeps the shattering off itself. At 1 the ball
    // is untouched by the facets; at 0 they run straight through it.
    uShatterClear: { value: 1.0 },
    // Brightness spread between facets, which is what makes them visible on a
    // pale card where a hue shift alone is not.
    uShatterGain: { value: 0.7 },

    /* A dot screen over the foil, off unless an effect asks for it.
     *
     * uDots         strength; 0 turns the layer off
     * uDotScale     dots across the card's width
     * uDotSize      dot radius, as a fraction of its cell (0.5 touches)
     * uDotHex       1 staggers alternate rows, 0 is a square grid
     * uDotRandom    how far each dot strays from its lattice point; 1 is
     *               scattered but still evenly packed
     * uDotSizeVar   spread of dot sizes, as a fraction of uDotSize
     * uDotShape     0 round, 1 square-cornered flakes
     * uDotStretch   how far a flake may be drawn out along its own axis
     * uDotWarm      0 white base, 1 pale gold
     * uDotPlate     how far the plate decides where dots show; 0 is even
     * uDotEdge      extra strength at the card's border
     * uDotEdgeWidth how far in from the edge that lift reaches, card widths
     * uDotChroma    0 silver dots, 1 rainbow
     * uDotTwinkle   0 all dots lit together, 1 each at its own angle
     * uDotJitter    how far apart in hue neighbouring dots are
     * uDotOver      how far a lit dot replaces the ink's colour, not only
     *               lightens it; screen alone vanishes on pale areas
     */
    uDots: { value: 0.0 },
    uDotScale: { value: 120.0 },
    uDotSize: { value: 0.25 },
    uDotHex: { value: 1.0 },
    uDotPlate: { value: 0.7 },
    uDotEdge: { value: 0.6 },
    uDotEdgeWidth: { value: 0.04 },
    uDotChroma: { value: 0.6 },
    uDotTwinkle: { value: 0.6 },
    uDotJitter: { value: 0.5 },
    uDotOver: { value: 0.0 },
    uDotRandom: { value: 0.0 },
    uDotSizeVar: { value: 0.0 },
    uDotShape: { value: 0.0 },
    uDotStretch: { value: 0.0 },
    uDotWarm: { value: 0.0 },

    /* A firework of radial dashes, off unless an effect asks for it.
     *
     * uBurst           strength; 0 turns the layer off
     * uBurstX, uBurstY centre, as a fraction of the card, y from the top
     * uBurstRays       dashes around each ring
     * uBurstRingScale  ring pitch against the dash spacing; 1 keeps cells square
     * uBurstLog        1 log-polar (dashes grow outward), 0 fixed-pitch rings
     * uBurstPitch      ring pitch in card widths, when uBurstLog is 0
     * uBurstDash       dash length, as a fraction of its cell
     * uBurstWidth      dash width, as a fraction of its cell
     * uBurstPoint      tip shape: 1 diamond, 2 pointed oval, higher blunter
     * uBurstStagger    1 turns every other ring half a dash, the brick look
     * uBurstReach      how far out it fades, in card widths
     * uBurstMaxRings   how many rings it has, counted out from uBurstCore
     * uBurstCore       radius of the dense centre the count starts from
     * uBurstSpoke      how much the light confines it to a bow tie of rays
     * uBurstSpokeWidth higher narrows that bow tie
     * uBurstHue        rainbow rings per card width
     * uBurstChroma     0 white, 1 full rainbow
     * uBurstRampStart  where in FX_T_Spectrum its colours start (0 red,
     *                  0.17 yellow, 0.33 green, 0.5 cyan, 0.67 blue,
     *                  0.83 magenta)
     * uBurstRampSpan   how much of the ramp it sweeps back and forth over
     * uBurstSparkle    random brightness per dash
     * uBurstJitter     random hue offset per dash; 0 keeps the pattern regular
     * uBurstOver       how far a lit dash replaces the ink's colour
     * uBurstPlate      1 keeps it where the plate is dark, 0 everywhere
     * uBurstBorder     1 keeps it off the card frame
     *
     * A second set of ovals over the first, catching the light another way:
     * uBurstB          its strength; 0 leaves one set
     * uBurstBTurnFrac  how far it is swung round the centre, as a fraction of
     *                  the angle between rays; 0.5 is exactly halfway
     * uBurstBShiftT    its offset outward, in rings
     * uBurstBSize      its dash size against the first set's
     * uBurstBTurn      how far its bow tie is turned from the first, radians
     * uBurstBTravel    how its rainbow moves with the light; -1 the other way
     *
     * Repeated, every burst identical:
     * uBurstCount      how many placed by hand, up to 12; the first is at
     *                  uBurstX, uBurstY
     * uBurstScatter    how many more scattered evenly over the card, up to 24
     * uBurstCatch      how far each burst keeps to its own light direction;
     *                  0 lights them all together, 1 one or two at a time
     * uBurstCatchWidth higher narrows each burst's window of light
     * uBurst2X..12Y    where the others are, as fractions of the card
     */
    uBurst: { value: 0.0 },
    uBurstX: { value: 0.81 },
    uBurstY: { value: 0.71 },
    uBurstRays: { value: 80.0 },
    uBurstRingScale: { value: 1.0 },
    uBurstLog: { value: 1.0 },
    uBurstPitch: { value: 0.012 },
    uBurstDash: { value: 0.8 },
    uBurstWidth: { value: 0.35 },
    uBurstPoint: { value: 2.0 },
    uBurstStagger: { value: 1.0 },
    uBurstReach: { value: 0.35 },
    uBurstMaxRings: { value: 200.0 },
    uBurstCore: { value: 0.01 },
    uBurstSpoke: { value: 0.0 },
    uBurstSpokeWidth: { value: 2.0 },
    uBurstHue: { value: 2.0 },
    uBurstChroma: { value: 0.5 },
    uBurstRampStart: { value: 0.0 },
    uBurstRampSpan: { value: 1.0 },
    uBurstSparkle: { value: 0.3 },
    uBurstJitter: { value: 0.0 },
    uBurstOver: { value: 0.0 },
    uBurstPlate: { value: 1.0 },
    uBurstBorder: { value: 1.0 },
    uBurstB: { value: 0.0 },
    uBurstBTurnFrac: { value: 0.5 },
    uBurstBShiftT: { value: 0.0 },
    uBurstBSize: { value: 1.0 },
    uBurstBTurn: { value: 1.5708 },
    uBurstBTravel: { value: -1.0 },
    uBurstCount: { value: 1.0 },
    uBurstScatter: { value: 0.0 },
    uBurstCatch: { value: 0.0 },
    uBurstCatchWidth: { value: 3.0 },
    ...Object.fromEntries(BURST_EXTRA.flatMap((n) => [
      [`uBurst${n}X`, { value: 0.5 }], [`uBurst${n}Y`, { value: 0.5 }]])),
  };
}

// Everything a card needs, resolved from its identifiers plus the effect table.
// The pattern, its texture role and whether the card is engraved are all fixed
// here rather than re-derived later.
export function resolve({ card, num, mask, effect, alt, face, pattern, etch,
                         isolate }) {
  // A set can refine an effect: `effect@family` is laid over the plain one.
  const eff = (effect || "").toLowerCase();
  const preset = { ...(EFFECTS[eff] || {}), ...(EFFECTS[`${eff}@${card}`] || {}) };
  const patternName =
    pattern || preset.pattern || "T_Holofoil_Distortion_Sun_Pillar";
  const noPattern = patternName.toLowerCase() === "none";
  const mode = ROLE[patternName] ?? 1;
  const uniforms = makeUniforms(mode, patternName);

  // Presets may only set numbers: `pattern` and `verified` are metadata, and
  // `etch` is a flag whose name collides with the uEtch sampler — writing true
  // into that binding destroys the texture with no error.
  const byParam = {};
  for (const key of Object.keys(uniforms)) byParam[key.slice(1).toLowerCase()] = key;
  for (const [name, value] of Object.entries(preset)) {
    if (typeof value !== "number") continue;
    const key = byParam[name];
    if (key) uniforms[key].value = value;
  }
  if (noPattern) uniforms.uWarp.value = 0;

  return {
    preset, patternName, noPattern, mode, uniforms,
    useEtch: etch === undefined ? !!preset.etch : etch,
    face: face || `${card}_en_${num}` + (alt ? "_alt" : ""),
    maskName: `${card}_${mask}_en_${num}`,
    etchName: `${card}_${mask.replace(/^wp/, "etch")}_en_${num}`,
    // The third mask kind, so far only on the RGB Mews.
    useFoilMask: !!preset.foilmask,
    foilMaskName: `${card}_${mask.replace(/^wp/, "foil")}_en_${num}`,
    // Some effects carry their own relief rather than a per-card one. The SV
    // pattern parallels are the case in point: the game draws their ball in its
    // shader, so there is no texture to scrape, and every card in the set
    // shares the identical mark. One image, named by the preset.
    overlay: preset.overlay || null,
    // A flat colour in place of the card, for designing a layer on its own:
    // the face is that colour and the plate is empty, so only the generated
    // layers that do not need a plate show. An "rrggbb" string, or null.
    isolate: isolate || null,
  };
}

/* Sets the game never shipped.
 *
 * TCG Live's catalogue starts at Black & White, so Base Set and the rest of the
 * WOTC era come from TCGdex scans instead — see tools/fetch_tcgdex_images.py.
 * Two differences drive everything here:
 *
 *   uCrop is 0. A scraped face is a 1024 square with the card inset, and uCrop
 *   trims the sides; a scan is already the card edge to edge, so trimming it
 *   again would cut into the border.
 *
 *   The plate is empty. A scan has its holo photographed into it and carries no
 *   white plate to separate foil from art, so there is nothing for the shader to
 *   gate on. With plate at zero every foil term drops out and the fragment
 *   returns the artwork exactly, which is what we want until a plate can be
 *   synthesised — the WOTC frame puts the holo in a fixed art window, so that is
 *   a rectangle rather than a per-card mask, but it is its own piece of work.
 */
/* The plate a scan does not carry.
 *
 * Every card of the WOTC era shares one frame, and the foil sits in its art
 * window and nowhere else — so the plate is not per-card art to be scraped, it
 * is a rectangle. Measured off the scans as fractions of the card, from the top
 * left: the window's yellow border ends at 0.115 down and resumes at 0.519, and
 * the sides sit at 0.110 and 0.890.
 */
export const ART_WINDOW = { x0: 0.110, y0: 0.115, x1: 0.890, y1: 0.519 };

function artWindowPlate(win) {
  const W = 256, H = Math.round(W / ASPECT);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d");
  c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
  // A couple of pixels of feather. A hard edge alias-crawls along the frame as
  // the card turns, and the real foil stops under the border rather than at a
  // knife edge anyway.
  c.filter = "blur(1.5px)";
  c.fillStyle = "#fff";
  c.fillRect(win.x0 * W, win.y0 * H,
             (win.x1 - win.x0) * W, (win.y1 - win.y0) * H);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function resolveLegacy({ set, num, effect = "cosmos", holo = false,
                               win = ART_WINDOW }) {
  // Built through resolve() so a legacy card gets the same preset handling as
  // any other — only where its textures come from differs.
  const r = resolve({ card: set, num, mask: "wp", effect });
  r.legacy = { set, num, holo, win };
  r.face = `${set}/${num}`;
  r.useEtch = false;
  // A scraped face is a 1024 square with the card inset and uCrop trims the
  // sides; a scan is already the card edge to edge, so trimming again would cut
  // into the border.
  r.uniforms.uCrop.value = 0;
  if (!holo) r.uniforms.uIntensity.value = 0;
  return r;
}

export function makeMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true,
  });
}

// Load a card's textures. `flat` stands in for an absent pattern or engraving:
// a single white texel, which leaves the maths unchanged.
export async function loadCard(load, r, base = "") {
  const flat = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  flat.needsUpdate = true;

  // A legacy scan lives elsewhere and brings no plate of its own: either the
  // art window drawn as one, or an empty one, which drops every foil term and
  // leaves the fragment returning the artwork exactly.
  const dark = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  dark.needsUpdate = true;

  /* A texture that need not exist.
   *
   * Only the face is required. A card with no foil has no mask on the CDN at
   * all — most of a booster pack is commons, and none of them have one — so a
   * 404 there is the normal case and means "no foil", not "broken". Letting it
   * reject took the whole Promise.all with it and left the card with no
   * textures whatsoever, which draws as nothing: the card appeared to be
   * missing when only its mask was.
   */
  const optional = (url, fallback, crisp = false) =>
    load(url, crisp).catch(() => fallback);

  if (r.isolate) {
    const hex = /^[0-9a-f]{6}$/i.test(r.isolate) ? r.isolate : "1c1c22";
    const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const solid = new THREE.DataTexture(new Uint8Array([...rgb, 255]), 1, 1);
    solid.needsUpdate = true;
    const [spectrum, blotches] = await Promise.all([
      load(`${base}/images/shared/FX_T_Spectrum.png`),
      load(`${base}/images/shared/FX_T_Spectrum_Bands_Blotches.png`),
    ]);
    const u = r.uniforms;
    u.uCard.value = solid;
    u.uMask.value = dark;
    u.uPattern.value = flat;
    u.uSpectrum.value = spectrum;
    u.uSpectrum2.value = blotches;
    u.uEtch.value = flat;
    u.uHasEtch.value = 0.0;
    // The foil mask's layers are what is being designed on an isolated card,
    // so it keeps the real one.
    u.uFoilMask.value = r.useFoilMask
      ? await optional(`${base}/images/masks/${r.foilMaskName}.png`, dark) : dark;
    return r;
  }

  const facePath = r.legacy
    ? `${base}/images/legacy/${r.face}.png` : `${base}/images/cards/${r.face}.png`;
  const platePromise = r.legacy
    ? Promise.resolve(r.legacy.holo ? artWindowPlate(r.legacy.win) : dark)
    // An empty plate is the right answer for a card without one: every foil
    // term is weighted by it, so the shader returns the artwork untouched.
    : optional(`${base}/images/masks/${r.maskName}.png`, dark);

  const [card, mask, pattern, spectrum, blotches, etch, foilMask] = await Promise.all([
    load(facePath),
    platePromise,
    r.noPattern ? Promise.resolve(flat)
                : optional(`${base}/images/shared/${r.patternName}.png`, flat),
    load(`${base}/images/shared/FX_T_Spectrum.png`),
    load(`${base}/images/shared/FX_T_Spectrum_Bands_Blotches.png`),
    // No mipmaps on the engraving: its lines are about two screen pixels wide
    // at normal card size, and a filtered mip averages them into flat grey —
    // the structure disappears exactly where it is wanted.
    r.overlay ? optional(`${base}${r.overlay}`, flat, true)
    : r.useEtch ? optional(`${base}/images/masks/${r.etchName}.png`, flat, true)
                : Promise.resolve(flat),
    r.useFoilMask ? optional(`${base}/images/masks/${r.foilMaskName}.png`, dark)
                  : Promise.resolve(dark),
  ]);
  const u = r.uniforms;
  u.uCard.value = card;
  u.uMask.value = mask;
  u.uPattern.value = pattern;
  u.uSpectrum.value = spectrum;
  u.uSpectrum2.value = blotches;
  u.uEtch.value = etch;
  u.uFoilMask.value = foilMask;
  // `flat` coming back means the engraving was not there, whatever the card
  // data claimed — gating on it would stencil the foil against solid white.
  u.uHasEtch.value = (r.useEtch || r.overlay) && etch !== flat ? 1.0 : 0.0;
  return r;
}
