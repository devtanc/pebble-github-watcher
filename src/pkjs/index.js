// Phone-side entry point. Milestone 5: Clay config page drives everything —
// watched repos, auth, options — with no hardcoded config.
var Clay = require('@rebble/clay');
var clayConfig = require('./config-page');
var codec = require('./brain/codec');
var config = require('./config');
var http = require('./brain/http');
var createAuth = require('./brain/auth').createAuth;
var createGithubClient = require('./brain/github-client').createGithubClient;
var createConfigStore = require('./brain/config-store').createConfigStore;
var createRateGovernor = require('./brain/rate-governor').createRateGovernor;
var qrEncoder = require('./brain/qr-encoder');
var glance = require('./brain/glance');

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
  now: nowMs,
});

// Manual event handling so config stays phone-side (not pushed to the watch).
var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

Pebble.addEventListener('showConfiguration', function () {
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) return;
  clay.getSettings(e.response); // persists to localStorage['clay-settings']
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
  else if (msg.type === 'REQUEST_QR') sendQr(msg.idx);
  else if (msg.type === 'ACTION_RERUN') doRerun(msg.idx);
});

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

function sendQr(idx) {
  var item = lastItems[idx];
  if (!item || !item.url) { console.log('no url for idx ' + idx); return; }
  var qr = qrEncoder.encode(item.url);
  console.log('qr idx ' + idx + ' size=' + qr.size + ' bytes=' + qr.bytes.length + ' url=' + item.url);
  send(codec.encodeQrData(qr));
}

function loadBoard() {
  var targets = configStore.getTargets();
  if (targets.length === 0) {
    send(codec.encodeStatus('No repos yet.\nAdd them in the\nPebble phone app.'),
      function () { send(codec.encodeGlance(glance.summarize([]))); });
    return;
  }
  auth.getAccessToken().then(function (token) {
    return github.fetchBoard(token, targets);
  }).then(function (items) {
    console.log('board: ' + items.length + ' targets, rate remaining: ' + governor.getRemaining());
    sendBoard(items);
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

function sendBoard(items) {
  lastItems = items;
  var count = items.length;
  function next(i) {
    if (i >= count) {
      console.log('board sent: ' + count + ' items');
      send(codec.encodeGlance(glance.summarize(items)));
      return;
    }
    var it = items[i];
    send(codec.encodeBoardItem({
      idx: i, count: count, label: it.label, status: it.status, ageS: it.ageS,
    }), function () { next(i + 1); });
  }
  next(0);
}

function send(dict, onOk) {
  Pebble.sendAppMessage(dict, onOk || function () {}, function (e) {
    console.log('send failed: ' + JSON.stringify(e));
  });
}
