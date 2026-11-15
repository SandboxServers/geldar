// The time-of-day dial on the public map (BM-15). A plain script: no library, no build step, no inline script. It reads
// the world clock from geldar-chat.json, the same file the chat panel reads, and shows a sun or a moon on a small
// horizon dial. The feed's lines are not read. Text is set with textContent or an attribute only; the icons are SVG
// nodes built with createElementNS. The dial is hidden unless BlueMap shows the overworld and the clock moved in the
// last 60 s.
(() => {
  const FEED_URL = '/geldar-chat.json';
  const ID = 'geldar-sky';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const POLL_MS = 5000;
  const TICK_MS = 1000;
  const FETCH_TIMEOUT_MS = 8000;
  const CLOCK_MAX_MS = 60000;
  const MS_PER_TICK = 50;
  const DAY_TICKS = 24000;
  const HALF_TICKS = 12000;
  const DIAL_R = 28;
  const CX = 36;
  const CY = 32;
  const RAYS = 8;
  // The label's minutes are floored to this step, so the accessible name changes about every 4 s, not every second.
  const LABEL_STEP_MIN = 5;

  const round1 = (v) => Math.round(v * 10) / 10;
  const pad = (n) => (n < 10 ? '0' + n : '' + n);

  // The clock {time, at} of a clock object, or null: time an integer 0..23999, at a finite number.
  function parseClock(c) {
    const ok =
      !!c &&
      Number.isInteger(c.time) &&
      c.time >= 0 &&
      c.time < DAY_TICKS &&
      typeof c.at === 'number' &&
      Number.isFinite(c.at);
    return ok ? { time: c.time, at: c.at } : null;
  }

  // The clock of a feed body. Undefined when the body is not JSON {"v":1,...} (a failed read keeps the last clock),
  // null when it is but carries no valid clock.
  function feedClock(text) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      return undefined;
    }
    if (doc?.v !== 1) return undefined;
    return parseClock(doc.clock);
  }

  // The tick of day now: the clock's time plus the ticks since it arrived (20 a second), wrapped at a day. A clock
  // behind the arrival time counts as no elapsed time.
  function clockNow(clock, receivedAtMs, nowMs) {
    const elapsed = Math.max(0, nowMs - receivedAtMs);
    return (clock.time + Math.floor(elapsed / MS_PER_TICK)) % DAY_TICKS;
  }

  // Which body is up and how far it has travelled. The sun is up from tick 0 (06:00) to 12000, the moon from 12000 to
  // 24000. p is 0 at the east (left) horizon, 0.5 at the top of the arc and 1 at the west (right) horizon.
  function phaseOf(time) {
    const t = ((time % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
    if (t <= HALF_TICKS) return { body: 'sun', p: t / HALF_TICKS };
    return { body: 'moon', p: (t - HALF_TICKS) / HALF_TICKS };
  }

  // A body's centre on the dial in SVG units, to 0.1: the horizon at y 32, the top of the arc at y 4.
  function arcPoint(p) {
    const a = Math.PI * p;
    return { x: round1(CX - DIAL_R * Math.cos(a)), y: round1(CY - DIAL_R * Math.sin(a)) };
  }

  // HH:MM of a tick of day: hour = floor(ticks/1000 + 6) mod 24, minutes = floor(ticks % 1000 * 60 / 1000), floored
  // to a multiple of step minutes (1 by default: the exact minute).
  function hhmm(time, step = 1) {
    const t = ((time % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
    const h = (Math.floor(t / 1000) + 6) % 24;
    const m = Math.floor(Math.floor(((t % 1000) * 60) / 1000) / step) * step;
    return pad(h) + ':' + pad(m);
  }

  // The accessible name for a tick of day, with the minutes floored to LABEL_STEP_MIN.
  function labelOf(time) {
    const body = phaseOf(time).body;
    return 'World time ' + hhmm(time, LABEL_STEP_MIN) + ', ' + (body === 'sun' ? 'Day' : 'Night');
  }

  // True when BlueMap shows the overworld. A missing BlueMap or a missing field is not the overworld.
  const onOverworld = (bm) => bm?.mapViewer?.map?.data?.id === 'overworld';

  function svgNode(doc, tag, attrs) {
    const n = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  }

  // The sun: a disc with a ring of short rays, centred on 0,0.
  function sunIcon(doc) {
    const g = svgNode(doc, 'g', { class: 'gs-icon gs-sun' });
    g.appendChild(svgNode(doc, 'circle', { r: 3.5, fill: '#ffd54a' }));
    for (let i = 0; i < RAYS; i++) {
      const a = (Math.PI * 2 * i) / RAYS;
      g.appendChild(
        svgNode(doc, 'line', {
          x1: round1(Math.cos(a) * 5.5),
          y1: round1(Math.sin(a) * 5.5),
          x2: round1(Math.cos(a) * 7.5),
          y2: round1(Math.sin(a) * 7.5),
          stroke: '#ffd54a',
          'stroke-width': 1.2,
          'stroke-linecap': 'round',
        }),
      );
    }
    return g;
  }

  // The moon: a crescent, the outer circle of radius 6 less an offset circle of radius 5, centred on 0,0.
  function moonIcon(doc) {
    const g = svgNode(doc, 'g', { class: 'gs-icon gs-moon' });
    g.appendChild(
      svgNode(doc, 'path', {
        d: 'M3.33 -4.99 A6 6 0 1 0 3.33 4.99 A5 5 0 1 1 3.33 -4.99 Z',
        fill: '#dfe6f0',
      }),
    );
    return g;
  }

  // The dial: a translucent box holding an SVG with the half-dial arc, the horizon line and both icons.
  function buildDial(doc) {
    const root = doc.createElement('div');
    root.id = ID;
    root.className = 'gs-dial';
    root.setAttribute('role', 'img');
    root.hidden = true;
    const svg = svgNode(doc, 'svg', { viewBox: '0 0 72 40', class: 'gs-svg', focusable: 'false' });
    svg.appendChild(
      svgNode(doc, 'path', { d: 'M8 32 A28 28 0 0 1 64 32', class: 'gs-arc', fill: 'none' }),
    );
    svg.appendChild(svgNode(doc, 'line', { x1: 4, y1: 32, x2: 68, y2: 32, class: 'gs-horizon' }));
    const sun = sunIcon(doc);
    const moon = moonIcon(doc);
    svg.appendChild(sun);
    svg.appendChild(moon);
    root.appendChild(svg);
    return { root, sun, moon };
  }

  // Sets a node's property or attribute only when its value differs from the last one written under its key, so an
  // unchanged repaint writes nothing.
  function put(state, key, node, name, value) {
    if (state.last[key] === value) return;
    state.last[key] = value;
    if (name === 'hidden' || name === 'textContent') node[name] = value;
    else node.setAttribute(name, value);
  }

  // Paints the dial for the time now. Hidden unless BlueMap shows the overworld with a clock that moved within 60 s.
  // The body that is up sits on the arc; the other is faded out, so only one icon is drawn at a time.
  function paint(state, bm, nowMs) {
    const d = state.dial;
    const live = onOverworld(bm) && state.clock !== null && nowMs - state.clockAt <= CLOCK_MAX_MS;
    put(state, 'hidden', d.root, 'hidden', !live);
    if (!live) return;
    const time = clockNow(state.clock, state.clockAt, nowMs);
    const ph = phaseOf(time);
    const pos = arcPoint(ph.p);
    const text = labelOf(time);
    put(state, 'aria', d.root, 'aria-label', text);
    for (const body of ['sun', 'moon']) {
      const up = ph.body === body;
      const icon = d[body];
      put(
        state,
        body + '.class',
        icon,
        'class',
        'gs-icon gs-' + body + (up ? ' gs-on' : ' gs-off'),
      );
      if (up) put(state, body + '.at', icon, 'transform', 'translate(' + pos.x + ' ' + pos.y + ')');
    }
  }

  // Reads the feed's clock and anchors it at this browser's receive time only when its time or its at changed. A
  // failed read keeps the last clock. Resolves to false when the read failed.
  async function pollOnce(state, fetchFn) {
    let text;
    try {
      const r = await fetchFn(FEED_URL, {
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      text = r.ok ? await r.text() : null;
    } catch {
      return false;
    }
    if (text === null) return false;
    const clock = feedClock(text);
    if (clock === undefined) return false;
    const same =
      !!state.clock && !!clock && clock.at === state.clock.at && clock.time === state.clock.time;
    if (!same) state.clockAt = state.now();
    state.clock = clock;
    return true;
  }

  // Adds the panel stylesheet unless the page already links one (the chat script adds the same link).
  function ensureStyles(doc) {
    if (doc.querySelector('link[href*="geldar.css"]')) return;
    const link = doc.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', 'assets/geldar.css');
    (doc.head || doc.body).appendChild(link);
  }

  // Builds the dial and starts the poll (every 5 s) and the repaint (every second). Idempotent: when the dial is
  // already on the page, nothing is added and null comes back. The fetch, the timers, the clock and BlueMap are
  // injectable for tests.
  function start(
    doc,
    fetchFn = (url, opts) => fetch(url, opts),
    schedule = (fn, ms) => setInterval(fn, ms),
    now = () => Date.now(),
    bmOf = () => globalThis.window?.bluemap,
  ) {
    if (!doc?.body || doc.querySelector('#' + ID)) return null;
    ensureStyles(doc);
    const dial = buildDial(doc);
    doc.body.appendChild(dial.root);
    const state = { dial, clock: null, clockAt: null, last: {}, now };
    let polling = false;
    const poll = () => {
      if (polling) return;
      polling = true;
      pollOnce(state, fetchFn)
        .catch(() => false)
        .finally(() => {
          polling = false;
        });
    };
    const repaint = () => paint(state, bmOf(), now());
    poll();
    repaint();
    schedule(poll, POLL_MS);
    schedule(repaint, TICK_MS);
    return state;
  }

  if (
    typeof document !== 'undefined' &&
    typeof window !== 'undefined' &&
    typeof fetch === 'function'
  ) {
    const boot = () => start(document);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  if (typeof module !== 'undefined') {
    module.exports = {
      parseClock,
      feedClock,
      clockNow,
      phaseOf,
      arcPoint,
      hhmm,
      labelOf,
      pollOnce,
      paint,
      start,
      POLL_MS,
      TICK_MS,
      CLOCK_MAX_MS,
    };
  }
})();
