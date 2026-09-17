/* Cutting a rectangle in two along a drawn line.
 *
 * The pack is a rectangle and the player draws a stroke across it. What comes
 * back is two polygons whose areas sum to the rectangle's — no gap, no overlap,
 * every point accounted for. That property is what makes the two halves look
 * like one wrapper that came apart rather than two shapes that happen to sit
 * near each other, and it is worth testing directly.
 *
 * The method: extend the stroke until it is certainly outside the rectangle at
 * both ends, keep the part that is inside, then close each half by walking the
 * rectangle's own perimeter between the exit and entry points — one half
 * clockwise, the other anticlockwise. Walking the real perimeter is what keeps
 * the corners exact.
 */

/** Rectangle corners, anticlockwise from the top left, in pack space. */
function corners(w, h) {
  return [
    [-w / 2, h / 2], [-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2],
  ];
}

/** Where a point on the boundary sits along the perimeter, in [0, 4). */
function perimeter(p, w, h) {
  const [x, y] = p, e = 1e-6;
  if (Math.abs(x + w / 2) < e) return 0 + (h / 2 - y) / h;        // left, down
  if (Math.abs(y + h / 2) < e) return 1 + (x + w / 2) / w;        // bottom, right
  if (Math.abs(x - w / 2) < e) return 2 + (y + h / 2) / h;        // right, up
  return 3 + (w / 2 - x) / w;                                     // top, left
}

/** Corners strictly between two perimeter positions, walking anticlockwise. */
function cornersBetween(t0, t1, w, h) {
  const pts = [], c = corners(w, h);
  let t = Math.ceil(t0 + 1e-9);
  const end = t1 > t0 ? t1 : t1 + 4;
  while (t < end - 1e-9) {
    pts.push(c[t % 4]);
    t += 1;
  }
  return pts;
}

function segmentHit(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denom;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, point: [a[0] + t * r[0], a[1] + t * r[1]] };
}

/** Every crossing of the rectangle's boundary by one segment, in order. */
function edgeHits(a, b, w, h) {
  const c = corners(w, h), out = [];
  for (let i = 0; i < 4; i++) {
    const hit = segmentHit(a, b, c[i], c[(i + 1) % 4]);
    if (hit) out.push(hit);
  }
  return out.sort((p, q) => p.t - q.t).map((p) => p.point);
}

const inside = (p, w, h) =>
  Math.abs(p[0]) <= w / 2 + 1e-9 && Math.abs(p[1]) <= h / 2 + 1e-9;

/**
 * Push the first and last points far enough out that the stroke certainly
 * starts and ends outside. A player who lifts the pointer over the pack still
 * meant to tear all the way through, and this is kinder than refusing the cut.
 */
function extend(path, w, h) {
  const far = Math.max(w, h) * 2;
  const dir = (p, q) => {
    const dx = p[0] - q[0], dy = p[1] - q[1];
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
  };
  const head = dir(path[0], path[1] ?? [path[0][0] - 1, path[0][1]]);
  const tail = dir(path[path.length - 1],
                   path[path.length - 2] ?? [path[0][0] + 1, path[0][1]]);
  return [
    [path[0][0] + head[0] * far, path[0][1] + head[1] * far],
    ...path,
    [path[path.length - 1][0] + tail[0] * far,
     path[path.length - 1][1] + tail[1] * far],
  ];
}

/**
 * Resample to an even spacing and add crosswise noise, so the edge reads as
 * torn paper rather than as a knife cut. The noise is a sawtooth rather than
 * smooth: fibres tear in short straight runs and change direction abruptly.
 */
export function roughen(path, step, amount, rand = Math.random) {
  if (path.length < 2) return path;
  const out = [];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = -dy / len, ny = dx / len;          // unit normal
    for (let d = carry; d < len; d += step) {
      const t = d / len;
      const jitter = (rand() - 0.5) * 2 * amount;
      out.push([a[0] + dx * t + nx * jitter, a[1] + dy * t + ny * jitter]);
    }
    carry = (carry - len) % step + step;
  }
  out.push(path[path.length - 1]);
  return out;
}

/**
 * Split a w x h rectangle centred on the origin along `path`.
 *
 * Returns `null` when the stroke never crosses the rectangle, or clips it so
 * briefly that it enters and leaves through the same point — there is no tear
 * to make, and saying so beats returning a degenerate sliver.
 */
export function splitRect(path, w, h) {
  if (!path || path.length < 2) return null;
  const full = extend(path, w, h);

  // Walk the stroke, keeping the run that lies inside and the boundary points
  // where it entered and left.
  let entry = null, exit = null;
  const middle = [];
  for (let i = 1; i < full.length; i++) {
    const a = full[i - 1], b = full[i];
    const aIn = inside(a, w, h), bIn = inside(b, w, h);
    const hits = edgeHits(a, b, w, h);
    if (!aIn && bIn) {
      entry = entry ?? hits[0] ?? null;
      middle.push(b);
    } else if (aIn && bIn) {
      middle.push(b);
    } else if (aIn && !bIn) {
      exit = hits[hits.length - 1] ?? null;
      break;
    } else if (hits.length >= 2) {
      // Straight through in one segment, touching nothing in between.
      entry = entry ?? hits[0];
      exit = hits[hits.length - 1];
      break;
    }
  }
  if (!entry || !exit) return null;

  const cut = [entry, ...middle.filter((p) => inside(p, w, h)), exit];
  const t0 = perimeter(entry, w, h), t1 = perimeter(exit, w, h);
  if (Math.abs(t0 - t1) < 1e-6) return null;

  // One half closes by walking the perimeter forward from the exit back to the
  // entry; the other closes the opposite way. Together they use every corner
  // exactly once, which is why the areas add up.
  const a = [...cut, ...cornersBetween(t1, t0, w, h)];
  const b = [...cut.slice().reverse(), ...cornersBetween(t0, t1, w, h)];
  return { a, b, cut };
}

/** Shoelace area, for checking a split conserves the rectangle. */
export function area(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
}
