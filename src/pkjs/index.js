// Phone-side entry point. Milestone 3: authenticate, then fetch real GitHub
// Actions status for the configured targets and push it to the watch.
var codec = require('./brain/codec');
var config = require('./config');
var http = require('./brain/http');
var createAuth = require('./brain/auth').createAuth;
var createGithubClient = require('./brain/github-client').createGithubClient;
var createConfigStore = require('./brain/config-store').createConfigStore;

function nowMs() { return Date.now(); }

var configStore = createConfigStore({ storage: localStorage });

var auth = createAuth({
  httpPostForm: http.httpPostForm,
  storage: localStorage,
  now: nowMs,
  sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
  clientId: config.GITHUB_CLIENT_ID,
  getPat: function () { return configStore.getPat(); },
});

var github = createGithubClient({ httpGetJson: http.httpGetJson, now: nowMs });

Pebble.addEventListener('ready', function () {
  console.log('pkjs ready');
  loadBoard();
});

// Kept for a future manual refresh from the watch.
Pebble.addEventListener('appmessage', function (e) {
  var msg = codec.decode(e.payload);
  console.log('rx: ' + msg.type);
  if (msg.type === 'REQUEST_BOARD') loadBoard();
});

function loadBoard() {
  auth.getAccessToken().then(function (token) {
    return github.fetchBoard(token, configStore.getTargets());
  }).then(function (items) {
    console.log('board: ' + items.length + ' targets');
    sendBoard(items);
  }).catch(function (err) {
    if (err && err.code === 'auth_required') {
      auth.signOut();
      beginSignIn();
    } else {
      console.log('board error: ' + (err && (err.message || err)));
    }
  });
}

function beginSignIn() {
  auth.requestDeviceCode().then(function (info) {
    console.log('device code: ' + info.userCode + ' -> ' + info.verificationUri);
    send(codec.encodeShowDeviceCode(info));
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
  var count = items.length;
  function next(i) {
    if (i >= count) {
      console.log('board sent: ' + count + ' items');
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
