import type { ServerResponse } from 'node:http';
import { OWNER_API_PREFIX } from './api/index.ts';
import { BASE, SECURITY_HEADERS } from './pages.ts';

/**
 * The same-origin script of the account page (C7-06d): the body start, stop and restart buttons and the status refresh.
 * It is served from /register/account-controls.js and the page links it; the page has no inline script. The CSRF token is
 * read from the data-csrf attribute of the page, never from a cookie. No eval and no innerHTML: the script shows only the
 * fixed texts below, set with textContent, never a response body.
 */
export const ACCOUNT_CONTROLS_SCRIPT_PATH = '/account-controls.js';

/**
 * The owner API as the browser reaches it: the register service is served only under /register (Caddy forwards
 * /register* there and server.ts strips the prefix), so the script calls /register/api/v1, never /api/v1.
 */
export const OWNER_API_PUBLIC_PREFIX = `${BASE}${OWNER_API_PREFIX}`;

/**
 * The account page's CSP (C7-06d). The page is default-src 'none'; the one script is same-origin, and fetch may reach only
 * this origin. No unsafe-inline and no unsafe-eval.
 */
export const ACCOUNT_PAGE_CSP =
  "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** The headers of the account page: its own CSP, which replaces the default one in SECURITY_HEADERS. */
export const ACCOUNT_PAGE_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': ACCOUNT_PAGE_CSP,
};

/** The script's headers: a JavaScript type, nosniff, and a short cache that revalidates (it holds no secret). */
const SCRIPT_HEADERS: Readonly<Record<string, string>> = {
  ...SECURITY_HEADERS,
  'content-type': 'text/javascript; charset=utf-8',
  'cache-control': 'no-cache',
};

/** Writes the script. The caller has already checked the method. */
export function serveControlsScript(res: ServerResponse): true {
  res.writeHead(200, SCRIPT_HEADERS);
  res.end(ACCOUNT_CONTROLS_SCRIPT);
  return true;
}

/**
 * The script. It is a classic script (ES5 style, no template literals) so it runs in any browser without a build. The
 * owner API is the same origin, so the session cookie goes with each call, and the x-csrf-token header carries the token.
 */
export const ACCOUNT_CONTROLS_SCRIPT = `(function () {
  'use strict';
  var root = document.getElementById('account-controls');
  if (!root) return;
  var API = '${OWNER_API_PUBLIC_PREFIX}';
  var csrf = root.getAttribute('data-csrf') || '';
  var message = document.getElementById('controls-message');
  var STATES = ['running', 'starting', 'waiting', 'stopped'];
  var TEXT = {
    unavailable: 'Body control is not available yet',
    busy: 'Too many requests. Try again shortly.',
    signin: 'Your session ended: sign in again.',
    failed: 'The request failed. Nothing was changed.',
    done: 'Done.'
  };
  var inFlight = 0;

  function say(text) {
    if (message) message.textContent = text;
  }

  function setButtons(disabled) {
    var buttons = root.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = disabled;
  }

  // One request. Every button is disabled until it settles. A failure shows only a fixed text.
  function send(method, path, onOk) {
    var init = { method: method, credentials: 'same-origin', headers: { 'x-csrf-token': csrf } };
    inFlight += 1;
    setButtons(true);
    function settle() {
      inFlight -= 1;
      if (inFlight === 0) setButtons(false);
    }
    return fetch(API + path, init).then(function (res) {
      settle();
      if (res.status === 503) say(TEXT.unavailable);
      else if (res.status === 429) say(TEXT.busy);
      else if (res.status === 401) say(TEXT.signin);
      else if (!res.ok) say(TEXT.failed);
      else if (onOk) onOk(res);
    }, function () {
      settle();
      say(TEXT.failed);
    });
  }

  function refresh(agent) {
    var line = document.getElementById('status-' + agent);
    return send('GET', '/agents/' + encodeURIComponent(agent) + '/body/status', function (res) {
      res.json().then(function (reply) {
        var known = reply && STATES.indexOf(reply.state) >= 0;
        if (line) line.textContent = 'Body: ' + (known ? reply.state : 'unknown');
      }, function () {
        if (line) line.textContent = 'Body: unknown';
      });
    });
  }

  root.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var agent = target.getAttribute('data-agent');
    var op = target.getAttribute('data-op');
    if (!agent || !op) return;
    var path = '/agents/' + encodeURIComponent(agent) + '/body/' + op;
    if (op === 'start' || op === 'stop' || op === 'restart') {
      send('POST', path, function () {
        say(TEXT.done);
        refresh(agent);
      });
    } else if (op === 'status') {
      refresh(agent);
    }
  });
})();
`;
