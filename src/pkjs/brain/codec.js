// Codec: translates logical messages <-> the keyed AppMessage payloads defined
// in protocol.js. All wire-format knowledge lives here so it is defined and
// tested in one place.
const { MSG_TYPE, KEY } = require('./protocol');

function encodeRequestBoard() {
  return { [KEY.MSG_TYPE]: MSG_TYPE.REQUEST_BOARD };
}

function encodeBoardRepo(repo) {
  return {
    [KEY.MSG_TYPE]: MSG_TYPE.BOARD_REPO,
    [KEY.REPO_IDX]: repo.repoIdx,
    [KEY.COUNT]: repo.count,
    [KEY.LABEL]: repo.name,
    [KEY.STATUS]: repo.status,
  };
}

function encodeBoardItem(item) {
  return {
    [KEY.MSG_TYPE]: MSG_TYPE.BOARD_ITEM,
    [KEY.IDX]: item.idx,
    [KEY.REPO_IDX]: item.repoIdx || 0,
    [KEY.LABEL]: item.label,
    [KEY.STATUS]: item.status,
    [KEY.AGE_S]: item.ageS,
    [KEY.ACTION]: item.action || 0,
    [KEY.NUM]: item.num || 0,
    [KEY.BRANCH]: item.branch || '',
    [KEY.SHA]: item.sha || '',
    [KEY.DUR]: item.durationS || 0,
  };
}

function encodeShowDeviceCode(info, qr) {
  var msg = {
    [KEY.MSG_TYPE]: MSG_TYPE.SHOW_DEVICE_CODE,
    [KEY.USER_CODE]: info.userCode,
    [KEY.VERIFY_URL]: info.verificationUri,
  };
  if (qr) {
    msg[KEY.SIZE] = qr.size;
    msg[KEY.DATA] = qr.bytes;
  }
  return msg;
}

function encodeAuthOk() {
  return { [KEY.MSG_TYPE]: MSG_TYPE.AUTH_OK };
}

function encodeAuthError(message) {
  return { [KEY.MSG_TYPE]: MSG_TYPE.AUTH_ERROR, [KEY.MSG]: message };
}

function encodeStatus(message) {
  return { [KEY.MSG_TYPE]: MSG_TYPE.STATUS, [KEY.MSG]: message };
}

function encodeRequestQr(idx) {
  return { [KEY.MSG_TYPE]: MSG_TYPE.REQUEST_QR, [KEY.IDX]: idx };
}

function encodeGlance(text) {
  return { [KEY.MSG_TYPE]: MSG_TYPE.GLANCE, [KEY.MSG]: text };
}

function encodeActionResult(ok, msg) {
  return { [KEY.MSG_TYPE]: MSG_TYPE.ACTION_RESULT, [KEY.OK]: ok ? 1 : 0, [KEY.MSG]: msg };
}

function encodeWakeup(epochSeconds) {
  return { [KEY.MSG_TYPE]: MSG_TYPE.WAKEUP, [KEY.TIME]: epochSeconds };
}

function encodeActionMerge(idx) {
  return { [KEY.MSG_TYPE]: MSG_TYPE.ACTION_MERGE, [KEY.IDX]: idx };
}

function encodeQrData(idx, qr) {
  return { [KEY.MSG_TYPE]: MSG_TYPE.QR_DATA, [KEY.IDX]: idx, [KEY.SIZE]: qr.size, [KEY.DATA]: qr.bytes };
}

// Decode an incoming payload (from either side) into a logical message.
// Unknown types are surfaced rather than thrown, so a version skew degrades
// gracefully instead of crashing the handler.
function decode(payload) {
  switch (payload[KEY.MSG_TYPE]) {
    case MSG_TYPE.REQUEST_BOARD:
      return { type: 'REQUEST_BOARD' };
    case MSG_TYPE.BOARD_REPO:
      return {
        type: 'BOARD_REPO',
        repoIdx: payload[KEY.REPO_IDX],
        count: payload[KEY.COUNT],
        name: payload[KEY.LABEL],
        status: payload[KEY.STATUS],
      };
    case MSG_TYPE.BOARD_ITEM:
      return {
        type: 'BOARD_ITEM',
        idx: payload[KEY.IDX],
        repoIdx: payload[KEY.REPO_IDX],
        label: payload[KEY.LABEL],
        status: payload[KEY.STATUS],
        ageS: payload[KEY.AGE_S],
        action: payload[KEY.ACTION],
        num: payload[KEY.NUM],
        branch: payload[KEY.BRANCH],
        sha: payload[KEY.SHA],
        durationS: payload[KEY.DUR],
      };
    case MSG_TYPE.SHOW_DEVICE_CODE:
      return {
        type: 'SHOW_DEVICE_CODE',
        userCode: payload[KEY.USER_CODE],
        verificationUri: payload[KEY.VERIFY_URL],
      };
    case MSG_TYPE.AUTH_OK:
      return { type: 'AUTH_OK' };
    case MSG_TYPE.AUTH_ERROR:
      return { type: 'AUTH_ERROR', msg: payload[KEY.MSG] };
    case MSG_TYPE.STATUS:
      return { type: 'STATUS', msg: payload[KEY.MSG] };
    case MSG_TYPE.REQUEST_QR:
      return { type: 'REQUEST_QR', idx: payload[KEY.IDX] };
    case MSG_TYPE.QR_DATA:
      return { type: 'QR_DATA', idx: payload[KEY.IDX], size: payload[KEY.SIZE], data: payload[KEY.DATA] };
    case MSG_TYPE.GLANCE:
      return { type: 'GLANCE', msg: payload[KEY.MSG] };
    case MSG_TYPE.ACTION_RERUN:
      return { type: 'ACTION_RERUN', idx: payload[KEY.IDX] };
    case MSG_TYPE.ACTION_RESULT:
      return { type: 'ACTION_RESULT', ok: payload[KEY.OK] === 1, msg: payload[KEY.MSG] };
    case MSG_TYPE.WAKEUP:
      return { type: 'WAKEUP', time: payload[KEY.TIME] };
    case MSG_TYPE.ACTION_MERGE:
      return { type: 'ACTION_MERGE', idx: payload[KEY.IDX] };
    default:
      return { type: 'UNKNOWN', raw: payload };
  }
}

module.exports = {
  encodeRequestBoard,
  encodeBoardRepo,
  encodeBoardItem,
  encodeShowDeviceCode,
  encodeAuthOk,
  encodeAuthError,
  encodeStatus,
  encodeRequestQr,
  encodeQrData,
  encodeGlance,
  encodeActionResult,
  encodeWakeup,
  encodeActionMerge,
  decode,
};
