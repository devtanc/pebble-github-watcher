// Phone-side entry point. Milestone 1: prove the AppMessage transport by
// answering the watch's board request with static fake data. Real GitHub data
// and auth arrive in later milestones.
var codec = require('./brain/codec');
var protocol = require('./brain/protocol');
// var config = require('./config'); // GitHub App client id — used from Milestone 2 (auth).

Pebble.addEventListener('ready', function () {
  console.log('pkjs ready');
  // Push the board proactively rather than waiting for the watch to ask. The
  // watch->phone request path is unreliable on the emulator (QemuInboundPacket
  // footer decode), and this also removes a startup race.
  sendFakeBoard();
});

Pebble.addEventListener('appmessage', function (e) {
  var msg = codec.decode(e.payload);
  console.log('rx: ' + msg.type);
  if (msg.type === 'REQUEST_BOARD') {
    sendFakeBoard();
  }
});

function sendFakeBoard() {
  var items = [
    { idx: 0, count: 3, label: 'api:main',  status: protocol.STATUS.SUCCESS,     ageS: 45 },
    { idx: 1, count: 3, label: 'web:main',  status: protocol.STATUS.FAILURE,     ageS: 600 },
    { idx: 2, count: 3, label: 'infra:dev', status: protocol.STATUS.IN_PROGRESS, ageS: 12 },
  ];
  sendSequential(items, 0);
}

// AppMessage allows only one outbound transfer at a time, so chain the sends:
// fire the next only after the previous is acknowledged.
function sendSequential(items, i) {
  if (i >= items.length) {
    console.log('board sent: ' + items.length + ' items');
    return;
  }
  Pebble.sendAppMessage(
    codec.encodeBoardItem(items[i]),
    function () { sendSequential(items, i + 1); },
    function (err) { console.log('send failed: ' + JSON.stringify(err)); }
  );
}
