// Phone-side entry point. Milestone 2: authenticate via GitHub OAuth device
// flow, then push the board (still fake data until Milestone 3).
var codec = require('./brain/codec');
var config = require('./config');
var http = require('./brain/http');
var createAuth = require('./brain/auth').createAuth;

var auth = createAuth({
  httpPostForm: http.httpPostForm,
  storage: localStorage,
  now: function () { return Date.now(); },
  sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
  clientId: config.GITHUB_CLIENT_ID,
  getPat: function () { return localStorage.getItem('gh_pat'); },
});

Pebble.addEventListener('ready', function () {
  console.log('pkjs ready');
  start();
});

// Kept for a future manual refresh from the watch; unused while we push on ready.
Pebble.addEventListener('appmessage', function (e) {
  var msg = codec.decode(e.payload);
  console.log('rx: ' + msg.type);
  if (msg.type === 'REQUEST_BOARD') loadBoard();
});

function start() {
  auth.getAccessToken().then(function () {
    console.log('authed');
    loadBoard();
  }).catch(function (err) {
    if (err && err.code === 'auth_required') {
      beginSignIn();
    } else {
      console.log('auth error: ' + (err && err.message));
      send(codec.encodeAuthError((err && err.message) || 'auth failed'));
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

function loadBoard() {
  // Milestone 2 still serves fake data; real GitHub fetch is Milestone 3.
  sendFakeBoard();
}

function sendFakeBoard() {
  var STATUS = require('./brain/protocol').STATUS;
  var items = [
    { idx: 0, count: 3, label: 'api:main',  status: STATUS.SUCCESS,     ageS: 45 },
    { idx: 1, count: 3, label: 'web:main',  status: STATUS.FAILURE,     ageS: 600 },
    { idx: 2, count: 3, label: 'infra:dev', status: STATUS.IN_PROGRESS, ageS: 12 },
  ];
  sendSequential(items, 0);
}

function sendSequential(items, i) {
  if (i >= items.length) {
    console.log('board sent: ' + items.length + ' items');
    return;
  }
  send(codec.encodeBoardItem(items[i]), function () { sendSequential(items, i + 1); });
}

function send(dict, onOk) {
  Pebble.sendAppMessage(dict, onOk || function () {}, function (e) {
    console.log('send failed: ' + JSON.stringify(e));
  });
}
