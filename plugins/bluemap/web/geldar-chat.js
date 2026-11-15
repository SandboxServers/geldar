// The Geldar live chat panel on the public map (decision 0310, packet BM-2). A plain script: no library, no build
// step, no inline script. It polls the chat feed and the live player lists and shows the lines as text only:
// every line is written with textContent, never innerHTML, and no link is made. The speaker's name comes from the
// alias-proxy's players.json (uuid to alias); an unknown speaker shows the neutral label.
(() => {
  const FEED_URL = '/geldar-chat.json';
  const MAPS = ['overworld', 'nether', 'end'];
  const MAX_ROWS = 100;
  const NEUTRAL = 'Ranger';
  const POLL_MS = 3000;
  const BACKOFF_MS = 10000;
  const COLLAPSED_KEY = 'geldar-chat-collapsed';

  // The feed as {t, id, text} lines, oldest first. Null when the body is not {"v":1,"lines":[...]}. Bad entries are
  // skipped, and at most the last MAX_ROWS lines are kept.
  function parseFeed(text) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (e) {
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
    } catch (e) {
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

  // A line's identity: its time and speaker together, since one speaker says many lines.
  function keyOf(l) {
    return l.t + ' ' + l.id;
  }

  // The lines of a feed that are new: not in the previous feed, and not older than the last line shown.
  function takeNew(feed, prevKeys, last) {
    const out = [];
    const batch = new Set();
    for (const l of feed) {
      const key = keyOf(l);
      if (prevKeys.has(key) || batch.has(key)) continue;
      if (last && l.t < last.t) continue;
      batch.add(key);
      out.push(l);
    }
    return out;
  }

  // Appends one row: time, name in its colour, then the text as a text node. Nothing from the feed is parsed as markup.
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
  }

  // Appends the rows, then scrolls to the newest only if the viewer was already at the bottom.
  function renderLines(doc, list, lines, nameOf) {
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
    for (const l of lines) appendRow(doc, list, l, nameOf(l.id));
    if (atBottom) list.scrollTop = list.scrollHeight;
  }

  function nextDelay(ok) {
    return ok ? POLL_MS : BACKOFF_MS;
  }

  async function getText(fetchFn, url) {
    try {
      const r = await fetchFn(url, { cache: 'no-store' });
      return r.ok ? await r.text() : null;
    } catch (e) {
      return null;
    }
  }

  function createFeedState(doc, list) {
    return { doc, list, seen: new Set(), last: null, names: new Map() };
  }

  // One poll: the names from every map's players.json, then the feed. Resolves to false when the feed failed, and the
  // rows already shown stay. Returns true when the feed was read.
  async function pollOnce(state, fetchFn) {
    const feedText = await getText(fetchFn, FEED_URL);
    for (const map of MAPS) {
      const text = await getText(fetchFn, '/maps/' + map + '/live/players.json');
      const players = text === null ? null : parsePlayers(text);
      if (players) remember(state.names, players);
    }
    const feed = feedText === null ? null : parseFeed(feedText);
    if (feed === null) return false;
    const fresh = takeNew(feed, state.seen, state.last);
    if (fresh.length > 0) {
      renderLines(state.doc, state.list, fresh, (id) => nameFor(state.names, id));
      state.last = fresh[fresh.length - 1];
    }
    state.seen = new Set(feed.map(keyOf));
    return true;
  }

  function readCollapsed() {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function writeCollapsed(collapsed) {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (e) {
      // Storage may be refused; the panel still works, it just opens expanded next time.
    }
  }

  function buildPanel(doc) {
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
    });
    return { root, list };
  }

  function start(doc) {
    const panel = buildPanel(doc);
    doc.body.appendChild(panel.root);
    const state = createFeedState(doc, panel.list);
    const fetchFn = (url, opts) => fetch(url, opts);
    const loop = () => {
      pollOnce(state, fetchFn).then((ok) => setTimeout(loop, nextDelay(ok)));
    };
    loop();
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
      nextDelay,
      createFeedState,
      pollOnce,
      buildPanel,
      NEUTRAL,
      MAX_ROWS,
      POLL_MS,
      BACKOFF_MS,
    };
  }
})();
