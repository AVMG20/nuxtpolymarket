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
    etch: true, overlay: "/demo/patterns/pokeball.png",
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
    etch: true, overlay: "/demo/patterns/masterball.png",
    etchwarp: 1.2, etchboost: 0.9, etchgate: 0, etchmix: 0.15,
    shatter: 0.55, shatterscale: 15,
    verified: "not yet — drawn from a scan of PRE 002/131",
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

export const FRAGMENT = /* glsl */`
  #define ASPECT_R 0.718
  precision highp float;
  varying vec2 vUv;
  varying vec3 vView;
  varying float vFacing;

  uniform sampler2D uCard, uMask, uPattern, uSpectrum, uSpectrum2, uEtch;
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

  void main() {
    // Map the plane's UV onto the card's region of the square texture.
    // No y-flip here: three.js already uploads textures with flipY, so
    // inverting again would stand the card on its head.
    vec2 uv = vec2(mix(uCrop, 1.0 - uCrop, vUv.x), vUv.y);

    vec4 card = texture2D(uCard, uv);

    // White plate: bright where foil belongs. Its own luminance is the weight,
    // so the pattern inside it survives instead of being flattened to a region.
    float plate = luma(texture2D(uMask, uv).rgb);

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
    float etchShape = luma(texture2D(uEtch, uv).rgb) * uHasEtch;
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
    uSpread: { value: 6.0 },
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
  };
}

// Everything a card needs, resolved from its identifiers plus the effect table.
// The pattern, its texture role and whether the card is engraved are all fixed
// here rather than re-derived later.
export function resolve({ card, num, mask, effect, alt, face, pattern, etch }) {
  const preset = EFFECTS[(effect || "").toLowerCase()] || {};
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
    // Some effects carry their own relief rather than a per-card one. The SV
    // pattern parallels are the case in point: the game draws their ball in its
    // shader, so there is no texture to scrape, and every card in the set
    // shares the identical mark. One image, named by the preset.
    overlay: preset.overlay || null,
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

  const facePath = r.legacy
    ? `${base}/images/legacy/${r.face}.png` : `${base}/images/cards/${r.face}.png`;
  const platePromise = r.legacy
    ? Promise.resolve(r.legacy.holo ? artWindowPlate(r.legacy.win) : dark)
    // An empty plate is the right answer for a card without one: every foil
    // term is weighted by it, so the shader returns the artwork untouched.
    : optional(`${base}/images/masks/${r.maskName}.png`, dark);

  const [card, mask, pattern, spectrum, blotches, etch] = await Promise.all([
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
  ]);
  const u = r.uniforms;
  u.uCard.value = card;
  u.uMask.value = mask;
  u.uPattern.value = pattern;
  u.uSpectrum.value = spectrum;
  u.uSpectrum2.value = blotches;
  u.uEtch.value = etch;
  // `flat` coming back means the engraving was not there, whatever the card
  // data claimed — gating on it would stencil the foil against solid white.
  u.uHasEtch.value = (r.useEtch || r.overlay) && etch !== flat ? 1.0 : 0.0;
  return r;
}
