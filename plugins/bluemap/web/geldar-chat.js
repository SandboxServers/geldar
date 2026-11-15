// The Geldar live chat panel on the public map (decision 0310, packets BM-2 and BM-3). A plain script: no library, no
// build step, no inline script. It polls the chat feed and the live player lists and shows the lines as text only:
// every line is written with textContent, never innerHTML, and no link is made. The speaker's name comes from the
// alias-proxy's players.json (uuid to alias); an unknown speaker shows the neutral label until the name arrives.
(() => {
  const FEED_URL = '/geldar-chat.json';
  const MAPS = ['overworld', 'nether', 'end'];
  const MAX_ROWS = 100;
  const NEUTRAL = 'Ranger';
  const POLL_MS = 3000;
  const BACKOFF_MS = 10000;
  const FETCH_TIMEOUT_MS = 8000;
  const COLLAPSED_KEY = 'geldar-chat-collapsed';
  const PIN_PX = 8;
  const FOLLOW_WAIT_MS = 3000;
  const FOLLOW_STEP_MS = 200;
  const NOT_ON_MAP = 'Not on the map';
  const LIVE_MS = 15000;
  const DELAYED_MS = 60000;
  const STILL_MS = 120000;
  const MINUTE_MS = 60000;
  const HOUR_MS = 3600000;
  const LIVE_TEXT = { live: 'Live', delayed: 'Delayed', offline: 'Offline' };
  const DAY_TICKS = 24000;
  const TICK_MS = 50;
  const CLOCK_MAX_MS = 60000;
  const SUN_FULL_END = 11800;
  const SUN_DARK_START = 13200;
  const SUN_DARK_END = 22800;
  const SUN_NIGHT = 0.25;
  const SUN_EPS = 0.01;

  // The clock {time, at} of a feed, or null when absent or invalid: time an integer 0..23999, at a finite number.
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

  // The feed as {lines, clock}: lines are {t, id, text} oldest first, clock is parseClock's. Null when the body is not
  // {"v":1,"lines":[...]}. Bad entries are skipped, and at most the last MAX_ROWS lines are kept.
  function parseFeed(text) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      return null;
    }
    if (!doc || doc.v !== 1 || !Array.isArray(doc.lines)) return null;
    const out = [];
    for (const l of doc.lines) {
      if (
        l &&
        typeof l.t === 'number' &&
        isFinite(l.t) &&
        typeof l.id === 'string' &&
        typeof l.text === 'string'
      ) {
        out.push({ t: l.t, id: l.id, text: l.text });
      }
    }
    return { lines: out.slice(-MAX_ROWS), clock: parseClock(doc.clock) };
  }

  // The {uuid, name} pairs of a live players.json. Null when the body is not {"players":[...]}.
  // home, when given, gets the uuid of each entry with foreign false (the agent is on this map). at, when given, gets
  // {uuid, x, y, z} of those entries too, from their position.
  function parsePlayers(text, home, at) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      return null;
    }
    if (!doc || !Array.isArray(doc.players)) return null;
    const out = [];
    for (const p of doc.players) {
      if (p && typeof p.uuid === 'string' && typeof p.name === 'string')
        out.push({ uuid: p.uuid, name: p.name });
      if (!(p && p.foreign === false && typeof p.uuid === 'string')) continue;
      if (home) home.push(p.uuid);
      const pos = p.position;
      if (
        at &&
        pos &&
        typeof pos.x === 'number' &&
        typeof pos.y === 'number' &&
        typeof pos.z === 'number'
      )
        at.push({ uuid: p.uuid, x: pos.x, y: pos.y, z: pos.z });
    }
    return out;
  }

  // Remembers the name of each player seen, so a speaker who has left keeps the name.
  function remember(names, players) {
    for (const p of players) names.set(p.uuid, p.name);
  }

  // The name for a speaker id: the last name seen, or the neutral label for an id never seen.
  function nameFor(names, id) {
    return names.has(id) ? names.get(id) : NEUTRAL;
  }

  // A stable colour per speaker: FNV-1a of the id, mapped to a hue.
  function colourFor(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return 'hsl(' + (h % 360) + ' 70% 72%)';
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  // HH:MM:SS in the viewer's time zone.
  function clock(t) {
    const d = new Date(t);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  // A line's identity: its time and speaker together, since one speaker says many lines and two speakers can share a
  // time. The clock may step back, so a key says nothing about order.
  function keyOf(l) {
    return l.t + ' ' + l.id;
  }

  // The lines of a feed that are not shown yet, in feed order. A line is shown once, whatever its time: a clock that
  // steps back or a late older line still shows. Shown is the Set of keys of the rows on screen.
  function takeNew(feed, shown) {
    const out = [];
    const batch = new Set();
    for (const l of feed) {
      const key = keyOf(l);
      if (shown.has(key) || batch.has(key)) continue;
      batch.add(key);
      out.push(l);
    }
    return out;
  }

  // Appends one row: time, name in its colour, the still suffix, then the text as a text node. Nothing from the feed is
  // parsed as markup. Returns the name element, so a name that arrives later can be written into it.
  function appendRow(doc, list, line, name, onFollow = () => {}) {
    const row = doc.createElement('div');
    row.className = 'gc-row';
    const time = doc.createElement('span');
    time.className = 'gc-time';
    time.textContent = clock(line.t);
    const who = doc.createElement('span');
    who.className = 'gc-name';
    who.textContent = name;
    who.style.color = colourFor(line.id);
    who.setAttribute('role', 'button');
    who.setAttribute('tabindex', '0');
    who.setAttribute('title', 'Follow');
    who.addEventListener('click', () => onFollow(line.id));
    who.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onFollow(line.id);
      }
    });
    const still = doc.createElement('span');
    still.className = 'gc-still';
    still.setAttribute('aria-hidden', 'true');
    row.speakerId = line.id;
    row.speakerEl = who;
    row.stillEl = still;
    row.appendChild(time);
    row.appendChild(doc.createTextNode(' '));
    row.appendChild(who);
    row.appendChild(still);
    row.appendChild(doc.createTextNode(': ' + line.text));
    list.appendChild(row);
    while (list.childNodes.length > MAX_ROWS) list.removeChild(list.childNodes[0]);
    return who;
  }

  // Appends the rows. Returns the name element of each row. The caller then runs followBottom, since a row that grows
  // later (a name arriving) must pin again too.
  function renderLines(doc, list, lines, nameOf, onFollow) {
    const names = [];
    for (const l of lines)
      names.push({ id: l.id, el: appendRow(doc, list, l, nameOf(l.id), onFollow) });
    return names;
  }

  // True when the list is within PIN_PX of its bottom: the viewer is following the newest line.
  function isPinned(list) {
    return list.scrollHeight - list.scrollTop - list.clientHeight <= PIN_PX;
  }

  // Scrolls to the newest line while the viewer is pinned. Run after every step that changes the rows or their heights
  // (new lines, a name filled in, the panel opened): a row that grows after the scroll pushes the newest out of view.
  function followBottom(state) {
    if (state.pinned) state.list.scrollTop = state.list.scrollHeight;
  }

  function nextDelay(ok) {
    return ok ? POLL_MS : BACKOFF_MS;
  }

  // The header dot from the age of the last good fetch: live under 15 s, delayed under 60 s, else offline.
  function freshState(ageMs) {
    if (ageMs < LIVE_MS) return 'live';
    return ageMs < DELAYED_MS ? 'delayed' : 'offline';
  }

  // A speaker's "still" suffix: '' under 2 min, whole minutes, then 'still 1h+' from an hour.
  function stillLabel(ms) {
    if (ms < STILL_MS) return '';
    if (ms >= HOUR_MS) return 'still 1h+';
    return 'still ' + Math.floor(ms / MINUTE_MS) + 'm';
  }

  // The age of the newest feed line. An age below 0 (a clock behind the server) counts as 0. The feed's t is the
  // server's clock and now is the viewer's, so a skew between them shifts the age by that much; it is not corrected.
  function ageLabel(ms) {
    const s = Math.max(0, ms);
    if (s < MINUTE_MS) return 'last line ' + Math.floor(s / 1000) + 's ago';
    if (s < HOUR_MS) return Math.floor(s / MINUTE_MS) + 'm ago';
    return '1h+ ago';
  }

  // The sunlight strength for a tick of day (0 is 06:00 sunrise): full sun to tick 11800, a linear fade to the night
  // level at 13200, the night level to 22800, then a linear rise back to 1 at 24000. Continuous at the wrap.
  function sunFor(time) {
    const t = ((time % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
    if (t <= SUN_FULL_END) return 1;
    if (t < SUN_DARK_START)
      return 1 - ((1 - SUN_NIGHT) * (t - SUN_FULL_END)) / (SUN_DARK_START - SUN_FULL_END);
    if (t <= SUN_DARK_END) return SUN_NIGHT;
    return SUN_NIGHT + ((1 - SUN_NIGHT) * (t - SUN_DARK_END)) / (DAY_TICKS - SUN_DARK_END);
  }

  // The world's tick of day now: the feed's time plus the ticks since the feed arrived (20 a second), wrapped at a day.
  // A clock behind the arrival time counts as no elapsed time.
  function clockNow(clock, receivedAtMs, nowMs) {
    const elapsed = Math.max(0, nowMs - receivedAtMs);
    return (clock.time + Math.floor(elapsed / TICK_MS)) % DAY_TICKS;
  }

  // Sets BlueMap's sunlight from the clock, on each tick. Auto mode off (the viewer took the day-night button) writes
  // nothing. On the overworld with a clock no older than 60 s, the sun is written when it moves by more than 0.01. Any
  // other map gets 1 once, since its lighting has no day cycle. Every access is guarded: a missing field does nothing.
  function applySun(state, bm, now) {
    if (!state.autoSun) return;
    const u = bm?.mapViewer?.data?.uniforms?.sunlightStrength;
    if (!u) return;
    if (bm.mapViewer.map?.data?.id !== 'overworld') {
      if (u.value !== 1) u.value = 1;
      return;
    }
    if (!state.clock || now - state.clockAt > CLOCK_MAX_MS) return;
    const want = sunFor(clockNow(state.clock, state.clockAt, now));
    if (Math.abs(u.value - want) > SUN_EPS) u.value = want;
  }

  // Records an agent's home position, rounded to 0.1 on each axis. The timer restarts when any axis changes.
  function trackPosition(state, a, now) {
    const x = Math.round(a.x * 10) / 10;
    const y = Math.round(a.y * 10) / 10;
    const z = Math.round(a.z * 10) / 10;
    const e = state.still.get(a.uuid);
    if (!e || e.x !== x || e.y !== y || e.z !== z) state.still.set(a.uuid, { x, y, z, since: now });
  }

  // Drops the tracking of each agent that no players.json lists. A map whose fetch failed keeps its last list.
  function pruneStill(state) {
    for (const uuid of [...state.still.keys()]) {
      if (![...state.here.values()].some((s) => s.has(uuid))) state.still.delete(uuid);
    }
  }

  // The still suffix of a speaker: '' when no players.json has them.
  function stillFor(state, uuid, now) {
    const e = state.still.get(uuid);
    return e ? stillLabel(now - e.since) : '';
  }

  // Writes a property only when it differs from the node's, so an unchanged repaint writes nothing.
  function put(node, prop, value) {
    if (node[prop] !== value) node[prop] = value;
  }

  // Paints the header dot, the last-line age and each row's still suffix. Run every second with the clock. A
  // speaker's still label shows on their newest row only; their older rows are cleared.
  function paintStatus(state, ui, now) {
    const fresh = freshState(state.lastOk === null ? Infinity : now - state.lastOk);
    const text = LIVE_TEXT[fresh];
    put(ui.live, 'textContent', text);
    ui.live.setAttribute('aria-label', text);
    put(ui.live, 'className', 'gc-live gc-live-' + fresh);
    const ago = state.newestT === null ? '' : ageLabel(now - state.newestT);
    put(ui.foot, 'textContent', ago);
    put(ui.foot, 'hidden', ago === '');
    const newest = new Set();
    for (const row of [...state.list.childNodes].reverse()) {
      if (!row.stillEl) continue;
      const label = newest.has(row.speakerId) ? '' : stillFor(state, row.speakerId, now);
      newest.add(row.speakerId);
      put(row.stillEl, 'textContent', label === '' ? '' : ` ${label}`);
    }
  }

  async function getText(fetchFn, url) {
    try {
      const r = await fetchFn(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return r.ok ? await r.text() : null;
    } catch {
      return null;
    }
  }

  // The panel's state: the document and the list, the keys of the rows shown (oldest first, at most MAX_ROWS), the
  // names seen, the name elements still showing the neutral label, and whether the viewer is pinned to the bottom.
  // Pinned starts true; only a scroll of the list changes it, since new rows do not scroll.
  // onFollow runs on a name click; mapOf is each agent's map (its players.json entry with foreign false).
  // now is the clock. lastOk is the time of the last good fetch, newestT the newest feed line's t (null when the feed
  // is empty), still each agent's {x, y, z, since}, and here each map's uuids from its last good players.json.
  function createFeedState(doc, list, onFollow = () => {}, now = () => Date.now()) {
    const state = {
      doc,
      list,
      shown: [],
      names: new Map(),
      mapOf: new Map(),
      unnamed: [],
      pinned: true,
      onFollow,
      now,
      lastOk: null,
      newestT: null,
      still: new Map(),
      here: new Map(),
      clock: null,
      clockAt: null,
      autoSun: true,
    };
    list.addEventListener('scroll', () => {
      state.pinned = isPinned(list);
    });
    return state;
  }

  // Writes each name that has arrived into the rows that showed the neutral label, then follows the bottom.
  function refreshNames(state) {
    state.unnamed = state.unnamed.filter((u) => {
      if (!state.names.has(u.id)) return true;
      u.el.textContent = state.names.get(u.id);
      return false;
    });
    followBottom(state);
  }

  // One poll. The feed and the three players.json files are fetched in parallel. The feed is rendered as soon as it
  // arrives, with the names known so far; a player list that fails or is slow does not hold the rows back, and its
  // names are written into the rows when they arrive. Resolves to false when the feed failed, and the rows already
  // shown stay. Returns true when the feed was read.
  async function pollOnce(state, fetchFn) {
    const feedP = getText(fetchFn, FEED_URL);
    const playersP = Promise.all(
      MAPS.map(async (map) => {
        const text = await getText(fetchFn, '/maps/' + map + '/live/players.json');
        const home = [];
        const at = [];
        const players = text === null ? null : parsePlayers(text, home, at);
        if (players) {
          const now = state.now();
          remember(state.names, players);
          state.here.set(map, new Set(players.map((p) => p.uuid)));
          state.lastOk = now;
          for (const a of at) trackPosition(state, a, now);
        }
        for (const uuid of home) state.mapOf.set(uuid, map);
      }),
    );
    const feedText = await feedP;
    const parsed = feedText === null ? null : parseFeed(feedText);
    if (parsed === null) return false;
    const feed = parsed.lines;
    state.lastOk = state.now();
    state.clock = parsed.clock;
    state.clockAt = state.lastOk;
    state.newestT = feed.length > 0 ? Math.max(...feed.map((l) => l.t)) : null;
    const fresh = takeNew(feed, new Set(state.shown));
    if (fresh.length > 0) {
      const rows = renderLines(
        state.doc,
        state.list,
        fresh,
        (id) => nameFor(state.names, id),
        state.onFollow,
      );
      for (const r of rows) {
        if (!state.names.has(r.id)) state.unnamed.push(r);
      }
      state.shown.push(...fresh.map(keyOf));
      state.shown.splice(0, Math.max(0, state.shown.length - MAX_ROWS));
      state.unnamed.splice(0, Math.max(0, state.unnamed.length - MAX_ROWS));
      followBottom(state);
    }
    playersP.then(() => {
      try {
        refreshNames(state);
      } finally {
        pruneStill(state);
      }
    });
    return true;
  }

  // The poll loop. A poll that throws counts as a failed poll: the loop backs off and keeps going. afterFirst, when
  // given, runs once after the first poll settles, whatever its outcome.
  function runLoop(state, fetchFn, schedule, afterFirst = null) {
    let first = true;
    const loop = () => {
      pollOnce(state, fetchFn)
        .catch(() => false)
        .then((ok) => {
          const once = first;
          first = false;
          schedule(loop, nextDelay(ok));
          if (once && afterFirst) afterFirst();
        });
    };
    loop();
  }

  // BlueMap's own follow: the agent's marker is bm-player-<uuid>, and controls.data.followingPlayer is the marker
  // followed (null when none). BlueMap's classes are minified, so every name is read with optional chaining.
  const markerId = (uuid) => 'bm-player-' + uuid;
  const controlsOf = (bm) => bm?.mapViewer?.controlsManager?.controls;

  // True when the map follows this agent's marker.
  function isFollowing(bm, uuid) {
    const f = controlsOf(bm)?.data?.followingPlayer;
    return !!f && f.id === markerId(uuid);
  }

  // Follows an agent with BlueMap's follow, or stops when the map already follows it. An agent on another map (mapOf)
  // is switched to first, then the marker is polled every 200 ms for 3 s. Resolves to 'stopped', 'followed' or
  // 'missing' (the note then says Not on the map). Never throws: a BlueMap that is missing or renamed is 'missing'.
  async function followAgent(uuid, deps) {
    const bm = deps.bluemap;
    try {
      if (isFollowing(bm, uuid)) {
        controlsOf(bm).stopFollowingPlayerMarker();
        return 'stopped';
      }
      const want = deps.mapOf.get(uuid);
      if (want !== undefined && want !== bm?.mapViewer?.map?.data?.id && bm?.switchMap)
        await bm.switchMap(want);
      for (let waited = 0; ; waited += FOLLOW_STEP_MS) {
        const marker = bm?.playerMarkerManager?.getPlayerMarker?.(uuid);
        if (marker) {
          controlsOf(bm).followPlayerMarker(marker);
          return 'followed';
        }
        if (waited >= FOLLOW_WAIT_MS) break;
        await (deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
          FOLLOW_STEP_MS,
        );
      }
    } catch {
      // BlueMap is missing, renamed or failed: the note below says the agent cannot be followed.
    }
    deps.note(NOT_ON_MAP);
    return 'missing';
  }

  // Marks the followed speaker's name. Run every second, since BlueMap cancels a follow when the map is dragged.
  function syncHighlight(list, bm) {
    const f = controlsOf(bm)?.data?.followingPlayer;
    for (const row of list.childNodes) {
      if (row.speakerEl)
        row.speakerEl.classList.toggle('gc-following', !!f && f.id === markerId(row.speakerId));
    }
  }

  function readCollapsed() {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  }

  function writeCollapsed(collapsed) {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // Storage may be refused; the panel still works, it just opens expanded next time.
    }
  }

  // onExpand runs when the viewer opens the panel: a list that was hidden loses its scroll position.
  function buildPanel(doc, onExpand) {
    const root = doc.createElement('section');
    root.id = 'geldar-chat';
    root.className = 'gc-panel';
    root.setAttribute('aria-label', 'Chat');
    const head = doc.createElement('div');
    head.className = 'gc-head';
    const title = doc.createElement('span');
    title.className = 'gc-title';
    title.textContent = 'Chat';
    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'gc-toggle';
    const list = doc.createElement('div');
    list.className = 'gc-list';
    list.setAttribute('role', 'log');
    list.setAttribute('aria-live', 'polite');
    const note = doc.createElement('span');
    note.className = 'gc-note';
    note.setAttribute('role', 'status');
    let noteTimer = null;
    const showNote = (text) => {
      note.textContent = text;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => (note.textContent = ''), 3000);
    };
    const live = doc.createElement('span');
    live.className = 'gc-live gc-live-offline';
    live.setAttribute('role', 'img');
    live.setAttribute('aria-label', 'Offline');
    live.textContent = 'Offline';
    const foot = doc.createElement('div');
    foot.className = 'gc-foot';
    foot.hidden = true;
    head.appendChild(title);
    title.appendChild(live);
    title.appendChild(note);
    head.appendChild(toggle);
    root.appendChild(head);
    // Shown only after the viewer takes the day-night button (auto mode off); it turns the page's sun back on.
    const resume = doc.createElement('button');
    resume.type = 'button';
    resume.className = 'gc-resume';
    resume.textContent = 'Follow world time';
    resume.hidden = true;
    root.appendChild(list);
    root.appendChild(resume);
    root.appendChild(foot);
    const setCollapsed = (collapsed) => {
      root.classList.toggle('gc-collapsed', collapsed);
      toggle.textContent = collapsed ? 'Show' : 'Hide';
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    };
    setCollapsed(readCollapsed());
    toggle.addEventListener('click', () => {
      const collapsed = !root.classList.contains('gc-collapsed');
      setCollapsed(collapsed);
      writeCollapsed(collapsed);
      if (!collapsed && onExpand) onExpand();
    });
    return { root, list, note: showNote, live, foot, resume };
  }

  // Adds the panel's stylesheet unless the page already links one. BlueMap rewrites settings.json on every Paper
  // restart and resets its "styles" list, so the script loads assets/geldar.css itself. Returns true when it added
  // the link.
  function ensureStyles(doc) {
    if (doc.querySelector('link[href*="geldar.css"]')) return false;
    const link = doc.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', 'assets/geldar.css');
    (doc.head || doc.body).appendChild(link);
    return true;
  }

  // Builds the panel and starts the poll loop. The fetch and the timer are injectable for tests.
  function start(
    doc,
    fetchFn = (url, opts) => fetch(url, opts),
    schedule = (fn, ms) => setTimeout(fn, ms),
    tick = null,
    now = () => Date.now(),
  ) {
    ensureStyles(doc);
    let state = null;
    const panel = buildPanel(doc, () => {
      if (state) followBottom(state);
    });
    doc.body.appendChild(panel.root);
    const bluemap = () => globalThis.window?.bluemap;
    state = createFeedState(
      doc,
      panel.list,
      (uuid) => followAgent(uuid, { bluemap: bluemap(), mapOf: state.mapOf, note: panel.note }),
      now,
    );
    // The viewer's own day-night button (BlueMap's class) takes manual control; the resume control gives it back.
    const setAutoSun = (on) => {
      state.autoSun = on;
      panel.resume.hidden = on;
    };
    if (doc.addEventListener)
      doc.addEventListener(
        'click',
        (e) => {
          if (e.target?.closest?.('.day-night-switch')) setAutoSun(false);
        },
        true,
      );
    panel.resume.addEventListener('click', () => setAutoSun(true));
    runLoop(state, fetchFn, schedule, () => paintStatus(state, panel, now()));
    if (tick)
      tick(() => {
        syncHighlight(panel.list, bluemap());
        paintStatus(state, panel, now());
        applySun(state, bluemap(), now());
      }, 1000);
  }

  if (
    typeof document !== 'undefined' &&
    typeof window !== 'undefined' &&
    typeof fetch === 'function'
  ) {
    const boot = () => start(document, undefined, undefined, (fn, ms) => setInterval(fn, ms));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  if (typeof module !== 'undefined') {
    module.exports = {
      parseFeed,
      parseClock,
      sunFor,
      clockNow,
      applySun,
      parsePlayers,
      remember,
      nameFor,
      freshState,
      stillLabel,
      ageLabel,
      trackPosition,
      pruneStill,
      stillFor,
      paintStatus,
      colourFor,
      clock,
      takeNew,
      keyOf,
      appendRow,
      renderLines,
      isPinned,
      followBottom,
      nextDelay,
      createFeedState,
      pollOnce,
      runLoop,
      start,
      buildPanel,
      ensureStyles,
      followAgent,
      syncHighlight,
      NEUTRAL,
      MAX_ROWS,
      POLL_MS,
      BACKOFF_MS,
      FETCH_TIMEOUT_MS,
    };
  }
})();
