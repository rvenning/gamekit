// gamekit · gk-path.js — levels authored as WAYPOINTS rather than as tile maps,
// plus the linters that keep them honest.
//
// Whenever a level's shape is a path — a road, a tunnel, a race line, a patrol
// route — authoring it as a handful of corner points beats hand-counting rows
// of ASCII. The available mistakes collapse to a short, geometric, checkable
// list, and both games that adopted this passed their level linter on the first
// run, which had never happened with hand-counted content.
//
// Two shapes, because path-shaped levels come in two kinds:
//
//   GK.Route     a polyline you walk BY DISTANCE. Turret Town's monster roads:
//                [[4,-1],[4,3],[8,3],…] and a monster's state is one number.
//
//   GK.Corridor  a profile you sample ACROSS. Rocket Rescue's caves:
//                [[x, centreY, gapHeight], …], smoothstepped between stations,
//                so any x yields a centre line and two walls.
//
// The rule that makes Corridor worth using: position everything inside a level
// by a FRACTION across the passage (`place(x, t)`), never in absolute pixels.
// A pickup then cannot be authored inside solid geometry, and widening a
// passage moves its contents with it instead of invalidating them.
//
// Both `lint()` helpers return an ARRAY OF STRINGS rather than throwing, so a
// suite can `assert.deepEqual(GK.Route.lint(...), [])` and name every offender
// in one run instead of dying on the first.
window.GK = window.GK || {};

/* ============================================================== Route ==== */
// A polyline through a list of points. `at()`/`dirAt()` are generic; `cells()`
// assumes the legs are axis-aligned (or exact diagonals), which is what a grid
// game authors and what `lint()` enforces.
GK.Route = {
  // waypoints: [[x, y], …] or [{x, y}, …]
  //   offset  added to every coordinate — pass 0.5 for grid games so the route
  //           runs through cell CENTRES rather than corners.
  make(waypoints, { offset = 0 } = {}) {
    const pts = waypoints.map((p) =>
      Array.isArray(p) ? { x: p[0] + offset, y: p[1] + offset } : { x: p.x + offset, y: p.y + offset });
    if (pts.length < 2) throw new Error("GK.Route.make needs at least two waypoints");
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    const route = { pts, cum, len: cum[cum.length - 1], waypoints };
    return Object.assign(route, {
      at: (d) => GK.Route.at(route, d),
      dirAt: (d) => GK.Route.dirAt(route, d),
      progress: (d) => (route.len > 0 ? Math.max(0, Math.min(1, d / route.len)) : 1),
      cells: () => GK.Route.cells(waypoints),
    });
  },

  // Which leg contains distance d, and how far along it (0..1).
  _seg(route, d) {
    const { cum } = route;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const span = cum[i] - cum[i - 1];
    return { i, t: span > 0 ? (d - cum[i - 1]) / span : 0 };
  },

  // Where you are after walking `d` along the route. Clamps at both ends, so a
  // caller that overshoots gets the destination rather than NaN.
  at(route, d) {
    const { pts } = route;
    if (!(d > 0)) return { x: pts[0].x, y: pts[0].y };
    if (d >= route.len) return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
    const { i, t } = GK.Route._seg(route, d);
    return {
      x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
      y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
    };
  },

  // Unit heading at distance d — for facing a sprite, or aiming along the path.
  dirAt(route, d) {
    const { pts } = route;
    const { i } = GK.Route._seg(route, Math.max(0, Math.min(route.len, d)));
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    const m = Math.hypot(dx, dy) || 1;
    return { x: dx / m, y: dy / m };
  },

  // Every whole cell the route passes through, as an "x,y" key Set — for
  // "can I build here?" and for painting the road. Grid coordinates, so pass
  // the RAW waypoints (no centre offset).
  cells(waypoints) {
    const set = new Set();
    const pt = (p) => (Array.isArray(p) ? p : [p.x, p.y]);
    for (let i = 0; i < waypoints.length - 1; i++) {
      const [x0, y0] = pt(waypoints[i]), [x1, y1] = pt(waypoints[i + 1]);
      const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      let x = x0, y = y0;
      set.add(x + "," + y);
      for (let s = 0; s < steps; s++) { x += dx; y += dy; set.add(x + "," + y); }
    }
    return set;
  },

  // Problems with an authored route, as human-readable strings.
  //   label         prefixed to every message
  //   axisAligned   every leg must be horizontal or vertical (default true)
  //   bounds        {w, h} — the first and last waypoints must sit OUTSIDE the
  //                 board (things enter and leave the frame) and every interior
  //                 corner INSIDE it
  //   noCrossing    the route may not re-enter a cell it has already used,
  //                 except at the corner two legs share (default true)
  //   minCells      shortest acceptable route, in cells
  lint(waypoints, { label = "route", axisAligned = true, bounds = null,
                    noCrossing = true, minCells = 0 } = {}) {
    const out = [];
    const pt = (p) => (Array.isArray(p) ? p : [p.x, p.y]);
    if (!waypoints || waypoints.length < 2) return [`${label}: needs at least two waypoints`];

    for (let i = 0; i < waypoints.length - 1; i++) {
      const [x0, y0] = pt(waypoints[i]), [x1, y1] = pt(waypoints[i + 1]);
      if (x0 === x1 && y0 === y1) out.push(`${label}: leg ${i} at ${x0},${y0} has no length`);
      else if (axisAligned && x0 !== x1 && y0 !== y1)
        out.push(`${label}: leg ${i} from ${x0},${y0} to ${x1},${y1} is diagonal`);
    }

    if (bounds) {
      const inside = (x, y) => x >= 0 && y >= 0 && x < bounds.w && y < bounds.h;
      const first = pt(waypoints[0]), last = pt(waypoints[waypoints.length - 1]);
      if (inside(first[0], first[1])) out.push(`${label}: the route must start OFF the board`);
      if (inside(last[0], last[1])) out.push(`${label}: the route must end OFF the board`);
      for (let i = 1; i < waypoints.length - 1; i++) {
        const [x, y] = pt(waypoints[i]);
        if (!inside(x, y)) out.push(`${label}: corner ${i} (${x},${y}) is off the board`);
      }
    }

    if (noCrossing) {
      const seen = new Set();
      for (let i = 0; i < waypoints.length - 1; i++) {
        const [x0, y0] = pt(waypoints[i]), [x1, y1] = pt(waypoints[i + 1]);
        const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
        const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        let x = x0, y = y0;
        for (let s = 0; s <= steps; s++) {
          const k = x + "," + y;
          // The corner shared by two legs is allowed to repeat once; anything
          // else means the route doubles back over itself.
          const isCorner = (x === x0 && y === y0) || (x === x1 && y === y1);
          if (seen.has(k) && !isCorner) out.push(`${label}: the route crosses itself at ${k}`);
          seen.add(k);
          if (s < steps) { x += dx; y += dy; }
        }
      }
    }

    if (minCells > 0) {
      const n = GK.Route.cells(waypoints).size;
      if (n < minCells) out.push(`${label}: only ${n} cells long (want ${minCells})`);
    }
    return out;
  },
};

/* =========================================================== Corridor ==== */
// A passage of varying centre line and width, authored as stations along one
// axis and interpolated between them. Smoothstep by default: a level made of
// straight ramps has a visible kink at every station.
GK.Corridor = {
  // stations: [[x, centre, width], …] or [{x, c, w}, …], strictly increasing x.
  //   ease  "smooth" (default) or "linear"
  make(stations, { ease = "smooth" } = {}) {
    const pts = stations.map((s) =>
      Array.isArray(s) ? { x: s[0], c: s[1], w: s[2] } : { x: s.x, c: s.c, w: s.w });
    if (pts.length < 2) throw new Error("GK.Corridor.make needs at least two stations");
    const cor = { pts, ease, from: pts[0].x, to: pts[pts.length - 1].x };
    return Object.assign(cor, {
      length: cor.to - cor.from,
      sample: (x) => GK.Corridor.sample(cor, x),
      centreAt: (x) => GK.Corridor.sample(cor, x).c,
      widthAt: (x) => GK.Corridor.sample(cor, x).w,
      lowAt: (x) => { const s = GK.Corridor.sample(cor, x); return s.c - s.w / 2; },
      highAt: (x) => { const s = GK.Corridor.sample(cor, x); return s.c + s.w / 2; },
      place: (x, t, clear) => GK.Corridor.place(cor, x, t, clear),
      minWidth: (step) => GK.Corridor.minWidth(cor, step),
    });
  },

  // Centre and width at any x. Outside the authored range the end stations
  // simply hold, so sampling past either mouth is safe rather than NaN.
  sample(cor, x) {
    const p = cor.pts, n = p.length;
    if (x <= p[0].x) return { c: p[0].c, w: p[0].w };
    if (x >= p[n - 1].x) return { c: p[n - 1].c, w: p[n - 1].w };
    let i = 0;
    while (i < n - 2 && p[i + 1].x < x) i++;
    const a = p[i], b = p[i + 1];
    const u = (x - a.x) / (b.x - a.x);
    const t = cor.ease === "linear" ? u : u * u * (3 - 2 * u);
    return { c: a.c + (b.c - a.c) * t, w: a.w + (b.w - a.w) * t };
  },

  // Fraction ACROSS the passage -> an absolute coordinate, kept `clear` away
  // from both walls. THE function to author level contents with: t=0 hugs the
  // low wall, 1 the high wall, 0.5 is dead centre, and nothing can land inside
  // solid geometry however the passage is later retuned.
  //
  // `clear` has to cover the player's own radius PLUS however far an eased or
  // springy control sails past its target — a pickup you can only reach by
  // arriving within a few px of a wall is asking for precision the controls
  // may not offer.
  place(cor, x, t, clear = 0) {
    const s = GK.Corridor.sample(cor, x);
    const lo = s.c - s.w / 2 + clear, hi = s.c + s.w / 2 - clear;
    if (hi <= lo) return s.c;                     // pathologically tight: centre it
    return Math.max(lo, Math.min(hi, s.c - s.w / 2 + t * s.w));
  },

  // Narrowest point, sampled — the minimum can fall BETWEEN two stations while
  // the width is interpolating downward, so reading the station list is wrong.
  minWidth(cor, step = 20) {
    let m = Infinity;
    for (let x = cor.from; x <= cor.to; x += step) m = Math.min(m, GK.Corridor.sample(cor, x).w);
    return Math.min(m, GK.Corridor.sample(cor, cor.to).w);
  },

  // Problems with an authored corridor, as human-readable strings.
  //   bounds     [lo, hi] — both walls must stay inside this, with `margin`
  //   minWidth / maxWidth   narrowest and widest the passage may get
  //   maxSlope   |d(centre)/dx| ceiling. A passage that climbs faster than the
  //              player can rise is not a challenge, it is a wall — multiply by
  //              the game's own scroll speed to turn this into px/s.
  //   step       sampling step for the swept checks
  lint(stations, { label = "corridor", bounds = null, margin = 0,
                   minWidth = 0, maxWidth = Infinity, maxSlope = Infinity, step = 10 } = {}) {
    const out = [];
    const st = stations.map((s) => (Array.isArray(s) ? { x: s[0], c: s[1], w: s[2] } : s));
    if (st.length < 2) return [`${label}: needs at least two stations`];
    for (let i = 1; i < st.length; i++) {
      if (st[i].x <= st[i - 1].x) out.push(`${label}: station ${i} at x=${st[i].x} does not advance`);
    }
    if (out.length) return out;                   // sampling a bad list is meaningless

    const cor = GK.Corridor.make(st);
    for (let x = cor.from; x <= cor.to; x += step) {
      const s = GK.Corridor.sample(cor, x);
      const lo = s.c - s.w / 2, hi = s.c + s.w / 2;
      if (bounds) {
        if (lo < bounds[0] + margin) out.push(`${label}@${x}: low wall leaves the stage (${lo.toFixed(1)})`);
        if (hi > bounds[1] - margin) out.push(`${label}@${x}: high wall leaves the stage (${hi.toFixed(1)})`);
      }
      if (s.w < minWidth) out.push(`${label}@${x}: narrows to ${s.w.toFixed(1)} (min ${minWidth})`);
      if (s.w > maxWidth) out.push(`${label}@${x}: widens to ${s.w.toFixed(1)} (max ${maxWidth})`);
      if (maxSlope < Infinity && x + step <= cor.to) {
        const slope = Math.abs(GK.Corridor.sample(cor, x + step).c - s.c) / step;
        if (slope > maxSlope) out.push(`${label}@${x}: centre line climbs at ${slope.toFixed(3)} (max ${maxSlope})`);
      }
    }
    return out;
  },
};
