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

  // The feed as {t, id, text} lines, oldest first. Null when the body is not {"v":1,"lines":[...]}. Bad entries are
  // skipped, and at most the last MAX_ROWS lines are kept.
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
    return out.slice(-MAX_ROWS);
  }

  // The {uuid, name} pairs of a live players.json. Null when the body is not {"players":[...]}.
  function parsePlayers(text) {
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

  // Appends one row: time, name in its colour, then the text as a text node. Nothing from the feed is parsed as markup.
  // Returns the name element, so a name that arrives later can be written into it.
  function appendRow(doc, list, line, name) {
    const row = doc.createElement('div');
    row.className = 'gc-row';
    const time = doc.createElement('span');
    time.className = 'gc-time';
    time.textContent = clock(line.t);
    const who = doc.createElement('span');
    who.className = 'gc-name';
    who.textContent = name;
    who.style.color = colourFor(line.id);
    row.appendChild(time);
    row.appendChild(doc.createTextNode(' '));
    row.appendChild(who);
    row.appendChild(doc.createTextNode(': ' + line.text));
    list.appendChild(row);
    while (list.childNodes.length > MAX_ROWS) list.removeChild(list.childNodes[0]);
    return who;
  }

  // Appends the rows. Returns the name element of each row. The caller then runs followBottom, since a row that grows
  // later (a name arriving) must pin again too.
  function renderLines(doc, list, lines, nameOf) {
    const names = [];
    for (const l of lines) names.push({ id: l.id, el: appendRow(doc, list, l, nameOf(l.id)) });
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
  function createFeedState(doc, list) {
    const state = { doc, list, shown: [], names: new Map(), unnamed: [], pinned: true };
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
        const players = text === null ? null : parsePlayers(text);
        if (players) remember(state.names, players);
      }),
    );
    const feedText = await feedP;
    const feed = feedText === null ? null : parseFeed(feedText);
    if (feed === null) return false;
    const fresh = takeNew(feed, new Set(state.shown));
    if (fresh.length > 0) {
      const rows = renderLines(state.doc, state.list, fresh, (id) => nameFor(state.names, id));
      for (const r of rows) {
        if (!state.names.has(r.id)) state.unnamed.push(r);
      }
      state.shown.push(...fresh.map(keyOf));
      state.shown.splice(0, Math.max(0, state.shown.length - MAX_ROWS));
      state.unnamed.splice(0, Math.max(0, state.unnamed.length - MAX_ROWS));
      followBottom(state);
    }
    playersP.then(() => refreshNames(state));
    return true;
  }

  // The poll loop. A poll that throws counts as a failed poll: the loop backs off and keeps going.
  function runLoop(state, fetchFn, schedule) {
    const loop = () => {
      pollOnce(state, fetchFn)
        .catch(() => false)
        .then((ok) => schedule(loop, nextDelay(ok)));
    };
    loop();
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
    head.appendChild(title);
    head.appendChild(toggle);
    root.appendChild(head);
    root.appendChild(list);
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
    return { root, list };
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
  ) {
    ensureStyles(doc);
    let state = null;
    const panel = buildPanel(doc, () => {
      if (state) followBottom(state);
    });
    doc.body.appendChild(panel.root);
    state = createFeedState(doc, panel.list);
    runLoop(state, fetchFn, schedule);
  }

  if (
    typeof document !== 'undefined' &&
    typeof window !== 'undefined' &&
    typeof fetch === 'function'
  ) {
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', () => start(document));
    else start(document);
  }

  if (typeof module !== 'undefined') {
    module.exports = {
      parseFeed,
      parsePlayers,
      remember,
      nameFor,
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
      NEUTRAL,
      MAX_ROWS,
      POLL_MS,
      BACKOFF_MS,
      FETCH_TIMEOUT_MS,
    };
  }
})();
