// Phone-side entry point. Milestone 5: Clay config page drives everything —
// watched repos, auth, options — with no hardcoded config.
//
// FIRST: install a Promise polyfill if the runtime lacks one. Real-device
// PebbleKit JS does NOT provide a native `Promise`; the emulator's pypkjs does.
// This whole app is Promise-based (every HTTP call in http.js is `new Promise`,
// auth/getAccessToken/loadBoard/showConfiguration are all promise chains), so on
// a phone without this, the very first `Promise.reject`/`new Promise` throws a
// ReferenceError — the `ready`, `appmessage` (handshake) and `showConfiguration`
// handlers all die, the watch sits on "Loading…", and Settings never opens. Must
// run before any module that uses a Promise is required.
(function () {
  var g;
  try { g = Function('return this')(); } catch (e) { g = null; }
  if (!g) {
    if (typeof self !== 'undefined') g = self;
    else if (typeof global !== 'undefined') g = global;
    else if (typeof window !== 'undefined') g = window;
  }
  if (g && typeof g.Promise !== 'function') {
    var P = require('promise-polyfill');
    g.Promise = (P && P.default) ? P.default : P;
  }
})();

var Clay = require('@rebble/clay');
var configPage = require('./config-page');
var createCatalog = require('./brain/catalog').createCatalog;
var codec = require('./brain/codec');
var config = require('./config');
var http = require('./brain/http');
var createAuth = require('./brain/auth').createAuth;
var createGithubClient = require('./brain/github-client').createGithubClient;
var createConfigStore = require('./brain/config-store').createConfigStore;
var createRateGovernor = require('./brain/rate-governor').createRateGovernor;
var createTimeline = require('./brain/timeline').createTimeline;
var timelinePlanner = require('./brain/timeline-planner');
var qrEncoder = require('./brain/qr-encoder');
var glance = require('./brain/glance');
var group = require('./brain/group');
var STATUS = require('./brain/protocol').STATUS;

function nowMs() { return Date.now(); }

var lastItems = [];

var configStore = createConfigStore({ storage: localStorage });

var auth = createAuth({
  httpPostForm: http.httpPostForm,
  storage: localStorage,
  now: nowMs,
  sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
  clientId: configStore.getClientIdOverride() || config.GITHUB_CLIENT_ID,
  getPat: function () { return configStore.getPat(); },
});

// The rate governor wraps GETs with ETag conditional requests + budget tracking.
var governor = createRateGovernor({ httpGetJson: http.httpGetJson, storage: localStorage, now: nowMs });
var github = createGithubClient({
  httpGetJson: governor.get,
  httpPostJson: http.httpPostJson,
  httpPut: http.httpPut,
  now: nowMs,
});

var timeline = createTimeline({
  getToken: function (ok, fail) { Pebble.getTimelineToken(ok, fail); },
  httpPut: http.httpPut,
});

var catalog = createCatalog({ github: github, storage: localStorage, now: nowMs });

function readClaySettings() {
  try { return JSON.parse(localStorage.getItem('clay-settings')) || {}; } catch (e) { return {}; }
}
function writeClaySettings(s) {
  localStorage.setItem('clay-settings', JSON.stringify(s));
}

// Config page is built per-open from the cached catalog; kept phone-side (not
// pushed to the watch), so autoHandleEvents is off and we drive events manually.
var clay = null;
var lastCatalog = { repos: [] };
var lastPage = 1;

function openConfig(catalogData) {
  lastCatalog = catalogData || { repos: [] };
  var s = readClaySettings();
  lastPage = Number(s.repoPage) || 1;
  clay = new Clay(configPage.build(lastCatalog, s.savedRepos || [], lastPage), null, { autoHandleEvents: false });
  Pebble.openURL(clay.generateUrl());
}

Pebble.addEventListener('showConfiguration', function () {
  auth.getAccessToken().then(function (token) {
    return catalog.get(token, configStore.getCatalogTtlMs(), false);
  }).then(function (cat) {
    openConfig(cat);
  }).catch(function (err) {
    // No token / fetch failed: still open with an empty list so manual entry + PAT work.
    console.log('config catalog error: ' + (err && (err.code || err.message)));
    openConfig({ repos: [] });
  });
});

// Resolve the checkboxgroup's boolean array back to the repo objects it stands for.
function resolveChecked(bools, repos) {
  var out = [];
  if (Array.isArray(bools)) {
    for (var i = 0; i < repos.length; i++) {
      if (bools[i]) out.push(repos[i]);
    }
  }
  return out;
}

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response || !clay) return;
  clay.getSettings(e.response); // persists flattened settings to clay-settings
  var s = readClaySettings();
  // Merge this page's checks with selections made on other pages.
  var pageRepos = configPage.repoList(lastCatalog, lastPage);
  var checkedThisPage = resolveChecked(s.selRepos, pageRepos);
  var prev = Array.isArray(s.savedRepos) ? s.savedRepos : [];
  var keep = prev.filter(function (r) {
    return !pageRepos.some(function (p) { return p.owner === r.owner && p.repo === r.repo; });
  });
  s.savedRepos = keep.concat(checkedThisPage);
  if (s.refreshCatalog) {
    catalog.invalidate(); // force a refetch on next open
    s.refreshCatalog = false;
  }
  writeClaySettings(s);
  loadBoard();
});

Pebble.addEventListener('ready', function () {
  console.log('pkjs ready');
  loadBoard();
  scheduleRefresh();
});

// Refresh the board on the configured interval while the app is open, backing
// off when the rate budget is low. ETag conditional requests keep it cheap.
function scheduleRefresh() {
  var base = configStore.getPollMinutes() * 60 * 1000;
  setTimeout(function () {
    loadBoard();
    scheduleRefresh();
  }, governor.suggestInterval(base));
}

Pebble.addEventListener('appmessage', function (e) {
  var msg = codec.decode(e.payload);
  console.log('rx: ' + msg.type);
  if (msg.type === 'REQUEST_BOARD') loadBoard();
  else if (msg.type === 'ACTION_RERUN') doRerun(msg.idx);
  else if (msg.type === 'ACTION_MERGE') doMerge(msg.idx);
});

// Pre-send a QR for every item after the board renders, so long-press is instant
// (no flaky watch->phone round-trip). Runs in the background.
function sendQrs(items, i) {
  if (i >= items.length) { console.log('qrs sent: ' + items.length); return; }
  var it = items[i];
  if (!it.url) { sendQrs(items, i + 1); return; }
  send(codec.encodeQrData(i, qrEncoder.encode(it.url)), function () { sendQrs(items, i + 1); });
}

function doMerge(idx) {
  var item = lastItems[idx];
  if (!item || !item.pr) {
    send(codec.encodeActionResult(false, 'No PR'));
    return;
  }
  console.log('merge idx ' + idx + ' ' + item.owner + '/' + item.repo + '#' + item.pr);
  auth.getAccessToken().then(function (token) {
    return github.mergePr(token, item.owner, item.repo, item.pr);
  }).then(function (r) {
    console.log('merge result: ' + JSON.stringify(r));
    send(codec.encodeActionResult(r.ok, r.msg));
  }).catch(function (err) {
    send(codec.encodeActionResult(false, (err && (err.code || err.message)) || 'failed'));
  });
}

function doRerun(idx) {
  var item = lastItems[idx];
  if (!item || !item.runId) {
    send(codec.encodeActionResult(false, 'No run'));
    return;
  }
  console.log('rerun idx ' + idx + ' ' + item.owner + '/' + item.repo + ' run ' + item.runId);
  auth.getAccessToken().then(function (token) {
    return github.rerunFailedJobs(token, item.owner, item.repo, item.runId);
  }).then(function (r) {
    console.log('rerun result: ' + JSON.stringify(r));
    send(codec.encodeActionResult(r.ok, r.msg));
  }).catch(function (err) {
    send(codec.encodeActionResult(false, (err && (err.code || err.message)) || 'failed'));
  });
}

var MAX_BOARD = 16; // matches MAX_ITEMS on the watch

// Expand a watched repo into targets: its CI (default branch) + a row per open PR.
function expandRepo(token, r) {
  return github.listOpenPrs(token, r.owner, r.repo).then(function (prs) {
    var targets = [{ owner: r.owner, repo: r.repo }];
    prs.forEach(function (p) { targets.push({ owner: r.owner, repo: r.repo, pr: p.number }); });
    return targets;
  }).catch(function () {
    return [{ owner: r.owner, repo: r.repo }]; // at least CI if the PR fetch fails
  });
}

function loadBoard() {
  var repos = configStore.getWatchedRepos();
  var manual = configStore.getManualTargets();
  var tok;
  var allTargets;
  // Resolve a token FIRST: a fresh user must be able to sign in before any
  // repos exist (the config page's repo picker needs a token to populate).
  // Only after we know we're authenticated do we fall back to the empty state.
  auth.getAccessToken().then(function (token) {
    tok = token;
    if (repos.length === 0 && manual.length === 0) {
      send(codec.encodeStatus('No repos yet.\nAdd them in the\nPebble phone app.'),
        function () { send(codec.encodeGlance(glance.summarize([]))); });
      return null; // signals the empty-state path to the chained thens
    }
    return Promise.all(repos.map(function (r) { return expandRepo(token, r); }));
  }).then(function (lists) {
    if (!lists) return null; // empty state already sent
    allTargets = manual.slice();
    lists.forEach(function (l) { allTargets = allTargets.concat(l); });
    if (allTargets.length > MAX_BOARD) allTargets = allTargets.slice(0, MAX_BOARD);
    return github.fetchBoard(tok, allTargets);
  }).then(function (items) {
    if (!items) return; // empty-state path
    console.log('board: ' + items.length + ' items, rate remaining: ' + governor.getRemaining());
    sendBoard(items);
    planAlerts(tok, allTargets, items);
  }).catch(function (err) {
    if (err && err.code === 'auth_required') {
      auth.signOut();
      beginSignIn();
    } else {
      console.log('board error: ' + (err && (err.message || err)));
      send(codec.encodeStatus('Couldn\'t load.\nCheck settings.'));
    }
  });
}

function beginSignIn() {
  auth.requestDeviceCode().then(function (info) {
    console.log('device code: ' + info.userCode + ' -> ' + info.verificationUri);
    send(codec.encodeShowDeviceCode(info, qrEncoder.encode(info.verificationUri)));
    return auth.pollForToken(info.deviceCode, info.interval);
  }).then(function () {
    console.log('sign-in complete');
    send(codec.encodeAuthOk(), function () { loadBoard(); });
  }).catch(function (err) {
    console.log('sign-in failed: ' + (err && (err.code || err.message)));
    send(codec.encodeAuthError((err && (err.code || err.message)) || 'sign-in failed'));
  });
}

// For each in-progress run, estimate completion and (a) schedule a local wakeup
// on the watch and (b) best-effort push a timeline pin (if enabled).
function planAlerts(token, targets, items) {
  for (var i = 0; i < items.length; i++) {
    if (items[i].status === STATUS.IN_PROGRESS) {
      planOne(token, targets[i], items[i]);
    }
  }
}

function planOne(token, target, item) {
  github.fetchRunTimings(token, target).then(function (t) {
    if (!t.inProgress) return;
    var avg = timelinePlanner.averageDurationS(t.completed);
    var eta = timelinePlanner.estimateEtaMs(t.inProgress.startedAtMs, avg);
    if (!eta) return;
    console.log('eta ' + item.label + ': ' + new Date(eta).toISOString());
    send(codec.encodeWakeup(Math.floor(eta / 1000)));
    if (configStore.getUseTimeline()) {
      var p = timelinePlanner.buildPin('ghw-' + t.inProgress.id, item.label + ' build', eta);
      timeline.pushPin(p).then(function (r) { console.log('pin: ' + JSON.stringify(r)); });
    }
  }).catch(function (e) { console.log('plan error: ' + (e && (e.code || e.message))); });
}

function sendBoard(items) {
  lastItems = items;
  var repos = group.groupByRepo(items);
  // Send every REPO group first, then all CHILD items (with their repo index
  // and flat index), then the glance. Chained: one AppMessage at a time.
  var msgs = [];
  repos.forEach(function (r, repoIdx) {
    msgs.push(codec.encodeBoardRepo({ repoIdx: repoIdx, count: repos.length, name: r.name, status: r.status }));
  });
  repos.forEach(function (r, repoIdx) {
    r.children.forEach(function (c) {
      msgs.push(codec.encodeBoardItem({
        idx: c.flatIdx, repoIdx: repoIdx, label: c.title, status: c.status, ageS: c.ageS, action: c.action,
        num: c.pr, branch: c.branch, sha: c.sha, durationS: c.durationS,
      }));
    });
  });
  function next(i) {
    if (i >= msgs.length) {
      console.log('board sent: ' + repos.length + ' repos, ' + items.length + ' items');
      send(codec.encodeGlance(glance.summarize(items)), function () { sendQrs(items, 0); });
      return;
    }
    send(msgs[i], function () { next(i + 1); });
  }
  next(0);
}

function send(dict, onOk) {
  Pebble.sendAppMessage(dict, onOk || function () {}, function (e) {
    console.log('send failed: ' + JSON.stringify(e));
  });
}
