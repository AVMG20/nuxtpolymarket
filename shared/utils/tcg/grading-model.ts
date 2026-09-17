// @ts-nocheck — vendored reference implementation (LOCKED 2026-08-03); typed via grading-model.d.ts shapes re-declared in tcg-db.ts. Renamed .js→.ts only so Vite AND Nitro bundle it; code below is byte-identical to grading-model.js in the repo root.
/* =============================================================
   Collector Sim — condition generation and grading
   Reference implementation. LOCKED 2026-08-03.

   Implements §6.1 (sub-scores) and §6.4 (grade computation) of
   collector-sim-design.md. Parameters were solved against target
   population statistics; do not adjust one in isolation. Read the
   "Invariants" block below before changing anything.
   ============================================================= */

/* ---------- Invariants ------------------------------------------
   1. σ ≤ 0.45 for any human service. Above that, a strong card and
      a marginal one become similarly likely to grade 10, and
      grading stops rewarding judgment (§6.4).
   2. Scarcity comes from scale shape — missing half-grades, the bar
      for a 10, the designation bar — never from raising σ or from
      compressing scores near the ceiling.
   3. Drift (the grader's mood) applies to the composite only.
      Sub-grade criteria carry measurement noise but not drift.
   4. The min term must be de-biased by +1.4236·σ_ind. Without it
      every card loses ~0.7 points and raising σ makes it worse.
   5. The sub-score floor is 6.3. Raising it turns the floor into a
      mass point; lowering it reintroduces sub-6.5 pack pulls.
   ---------------------------------------------------------------- */

export const CONDITION = {
  floor: 6.30,
  centering: { shape: 2.0, scale: 0.13 },   // continuous; never exactly perfect
  // Damage lives at 16 discrete sites: 4 corners + 4 edges, front and back.
  // Per-site untouched = 0.66^(1/4), which reproduces the locked category
  // distribution exactly. Surface is a defect list rather than fixed sites.
  site: { untouched: 0.9013, shape: 2.0, scale: 0.84 },
  surface: { defectRate: 0.42, shape: 2.0, scale: 0.84 }, // Poisson-ish per face
};

export const SITES = [
  "corner_tl_f", "corner_tr_f", "corner_bl_f", "corner_br_f",
  "corner_tl_b", "corner_tr_b", "corner_bl_b", "corner_br_b",
  "edge_top_f", "edge_right_f", "edge_bottom_f", "edge_left_f",
  "edge_top_b", "edge_right_b", "edge_bottom_b", "edge_left_b",
];
const SITE_CATEGORY = (i) => (i < 8 ? (i < 4 ? 2 : 3) : (i < 12 ? 4 : 5));

export const SERVICES = {
  PSI: {
    name: "Pristine Slab Institute",
    sigma: 0.375, wMin: 0.75, offset: 0,
    halfGradeAtTop: false,        // no 9.5 — grade 9 is a full point wide
    tenBar: 9.92,
    report: "grade",              // one number, nothing else
    designation: null,
  },
  CCC: {
    name: "Cardboard Certification Consortium",
    sigma: 0.330, wMin: 0.68, offset: 0.220,
    halfGradeAtTop: true,
    tenBar: 9.88,
    report: "subgrades4",         // four category numbers, no reasons
    designation: { kind: "sweep", bar: 9.77, label: "Pristine", base: "Gem Mint" },
  },
  GAG: {
    name: "Grading & Authentication Guild",
    sigma: 0.110, wMin: 0.75, offset: -0.080,
    halfGradeAtTop: false,
    tenBar: null,                 // uses the 1000-point score instead
    report: "full",               // eight subgrades, 1000-pt score, defect map
    fineScore: true,
    designation: { kind: "score", bar: 990, label: "Pristine", base: "Gem Mint" },
  },
  BRK: {
    name: "Brackett & Co.",
    sigma: 0.250, wMin: 0.80, offset: 0.060,
    halfGradeAtTop: true,
    tenBar: 9.92,
    report: "subgrades4",         // four category numbers, no reasons
    designation: { kind: "sweep", bar: 9.88, label: "Black Label", base: "Pristine" },
  },
};

export const SHARED_DRIFT_FRACTION = 0.7;
export const MIN8_BIAS = 1.4236;   // -E[min of 8 standard normals]

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const half = (x) => clamp(Math.round(x * 2) / 2, 1, 10);

/**
 * Roll a copy's immutable condition. Call once, at mint, seeded by serial.
 *
 * Returns { sites, surface, subs } where `subs` is the eight category
 * sub-scores [cf, cb, cornF, cornB, edgeF, edgeB, surfF, surfB] derived by
 * taking the worst site in each category. Every card carries site detail —
 * it drives the render (§6.2) regardless of who grades it. What differs is
 * which service will *tell* you about it.
 */
export function rollCondition(rng, gamma, q = CONDITION) {
  const subs = new Array(8).fill(10);

  subs[0] = Math.max(q.floor, 10 - gamma(q.centering.shape, q.centering.scale));
  subs[1] = Math.max(q.floor, 10 - gamma(q.centering.shape, q.centering.scale));

  const sites = SITES.map((id, i) => {
    let value = 10;
    if (rng() >= q.site.untouched) {
      value = Math.max(q.floor, 10 - gamma(q.site.shape, q.site.scale));
    }
    const cat = SITE_CATEGORY(i);
    if (value < subs[cat]) subs[cat] = value;
    return { id, category: cat, value };
  });

  // surface: a variable-length defect list per face, not fixed slots
  const surface = [];
  for (const face of [0, 1]) {
    let n = 0;
    while (rng() < q.surface.defectRate && n < 6) n++;
    for (let d = 0; d < n; d++) {
      const value = Math.max(q.floor, 10 - gamma(q.surface.shape, q.surface.scale));
      const cat = 6 + face;
      if (value < subs[cat]) subs[cat] = value;
      surface.push({
        id: `surface_${face ? "b" : "f"}_${d}`,
        category: cat,
        value,
        x: rng(), y: rng(), angle: rng() * Math.PI,
        type: ["scratch", "print_line", "dimple", "gloss_loss"][Math.floor(rng() * 4)],
      });
    }
  }

  return { sites, surface, subs };
}

/** Re-derive the eight category sub-scores, optionally healing one site. */
function deriveSubs(cond, healId) {
  const subs = [cond.subs[0], cond.subs[1], 10, 10, 10, 10, 10, 10];
  for (const f of [...cond.sites, ...cond.surface]) {
    if (f.id === healId) continue;
    if (f.value < subs[f.category]) subs[f.category] = f.value;
  }
  return subs;
}

/**
 * Submit one copy to one service. Non-deterministic by design — this is
 * what makes crack-and-resubmit (§6.4) a real gamble.
 */
export function submit(serviceKey, cond, gauss) {
  const S = SERVICES[serviceKey];
  const subs = cond.subs;
  const sInd = S.sigma * Math.sqrt(1 - SHARED_DRIFT_FRACTION);
  const sSh = S.sigma * Math.sqrt(SHARED_DRIFT_FRACTION);
  const clip = (z) => clamp(z, -1.5, 1.5);   // §6.3: render must not contradict grade

  const drift = clip(gauss()) * sSh + S.offset;

  // Draw the noise once and keep it: the counterfactual below has to re-run
  // against the same reading, or the report contradicts the grade it explains.
  const noise = new Array(8);
  for (let k = 0; k < 8; k++) noise[k] = clip(gauss()) * sInd;
  const o = subs.map((v, k) => v + noise[k]);

  let mn = Infinity, sum = 0;
  for (let k = 0; k < 8; k++) { if (o[k] < mn) mn = o[k]; sum += o[k]; }
  mn += MIN8_BIAS * sInd;                    // invariant 4

  const composite = S.wMin * mn + (1 - S.wMin) * (sum / 8) + drift;

  // criteria: measurement noise only, no drift (invariant 3)
  const criteria = {
    centering: Math.min(o[0], o[1]),
    corners: Math.min(o[2], o[3]),
    edges: Math.min(o[4], o[5]),
    surface: Math.min(o[6], o[7]),
  };

  let grade, score = null, designation = null;

  if (S.fineScore) {
    score = clamp(Math.round(composite * 100), 100, 1000);
    grade = score >= 950 ? 10 : Math.max(1, Math.floor(score / 50) * 0.5);
  } else {
    grade = half(composite);
    if (!S.halfGradeAtTop && grade === 9.5) grade = 9;
    if (grade === 10 && S.tenBar && composite < S.tenBar) {
      grade = S.halfGradeAtTop ? 9.5 : 9;
    }
  }

  if (grade === 10 && S.designation) {
    const d = S.designation;
    const earned = d.kind === "score"
      ? score >= d.bar
      : Object.values(criteria).every((x) => x >= d.bar);
    designation = earned ? d.label : d.base;
  }

  /* ---- what this service is willing to tell you (§6.4) ----
     PSI  a grade, and nothing else
     CCC  four category sub-grades
     BRK  four category sub-grades
     GAG  eight sub-grades, the 1000-point score, and the defect map        */

  let subGrades = null;
  if (S.report === "subgrades4") {
    subGrades = Object.fromEntries(
      Object.entries(criteria).map(([k, v]) => [k, half(v)])
    );
  } else if (S.report === "full") {
    subGrades = {
      centering_f: half(o[0]), centering_b: half(o[1]),
      corners_f: half(o[2]), corners_b: half(o[3]),
      edges_f: half(o[4]), edges_b: half(o[5]),
      surface_f: half(o[6]), surface_b: half(o[7]),
    };
  }

  return {
    service: serviceKey,
    grade,
    designation,
    score,
    subGrades,
    flaws: S.report === "full" ? significantFlaws(S, cond, noise, drift, grade) : null,
  };
}

/**
 * Flaws of notable grade significance — GAG only.
 *
 * A flaw is significant iff healing it, and nothing else, would raise the
 * rounded grade. Counterfactual by construction, which is why it needs no
 * authored thresholds and why min-dominance keeps the list short: usually
 * only the worst site qualifies. A higher-graded card can legitimately list
 * more flaws than a lower-graded one, because several small issues can be
 * outranked by a single severe one that hides them.
 */
function significantFlaws(S, cond, noise, drift, actualGrade) {
  const out = [];
  for (const f of [...cond.sites, ...cond.surface]) {
    if (f.value >= 10) continue;
    const healed = deriveSubs(cond, f.id);
    if (gradeFrom(S, healed, noise, drift) > actualGrade) {
      out.push({ id: f.id, category: f.category, severity: 10 - f.value });
    }
  }
  return out.sort((a, b) => b.severity - a.severity);
}

/** Deterministic re-grade against a fixed noise reading. */
function gradeFrom(S, subs, noise, drift) {
  const sInd = S.sigma * Math.sqrt(1 - SHARED_DRIFT_FRACTION);
  const o = subs.map((v, k) => v + noise[k]);
  let mn = Infinity, sum = 0;
  for (let k = 0; k < 8; k++) { if (o[k] < mn) mn = o[k]; sum += o[k]; }
  mn += MIN8_BIAS * sInd;
  const composite = S.wMin * mn + (1 - S.wMin) * (sum / 8) + drift;
  if (S.fineScore) {
    const sc = clamp(Math.round(composite * 100), 100, 1000);
    return sc >= 950 ? 10 : Math.max(1, Math.floor(sc / 50) * 0.5);
  }
  let g = half(composite);
  if (!S.halfGradeAtTop && g === 9.5) g = 9;
  if (g === 10 && S.tenBar && composite < S.tenBar) g = S.halfGradeAtTop ? 9.5 : 9;
  return g;
}

/** Population-report key. Never collapse across services (§6.5). */
export const popKey = (printingId, r) =>
  `${printingId}|${r.service}|${r.grade}|${r.designation ?? ""}`;
