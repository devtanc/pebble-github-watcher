// Codec: translates logical messages <-> the keyed AppMessage payloads defined
// in protocol.js. All wire-format knowledge lives here so it is defined and
// tested in one place.
const { MSG_TYPE, KEY } = require('./protocol');

function encodeRequestBoard() {
  return { [KEY.MSG_TYPE]: MSG_TYPE.REQUEST_BOARD };
}

function encodeBoardItem(item) {
  return {
    [KEY.MSG_TYPE]: MSG_TYPE.BOARD_ITEM,
    [KEY.IDX]: item.idx,
    [KEY.COUNT]: item.count,
    [KEY.LABEL]: item.label,
    [KEY.STATUS]: item.status,
    [KEY.AGE_S]: item.ageS,
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

function encodeQrData(qr) {
  return { [KEY.MSG_TYPE]: MSG_TYPE.QR_DATA, [KEY.SIZE]: qr.size, [KEY.DATA]: qr.bytes };
}

// Decode an incoming payload (from either side) into a logical message.
// Unknown types are surfaced rather than thrown, so a version skew degrades
// gracefully instead of crashing the handler.
function decode(payload) {
  switch (payload[KEY.MSG_TYPE]) {
    case MSG_TYPE.REQUEST_BOARD:
      return { type: 'REQUEST_BOARD' };
    case MSG_TYPE.BOARD_ITEM:
      return {
        type: 'BOARD_ITEM',
        idx: payload[KEY.IDX],
        count: payload[KEY.COUNT],
        label: payload[KEY.LABEL],
        status: payload[KEY.STATUS],
        ageS: payload[KEY.AGE_S],
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
      return { type: 'QR_DATA', size: payload[KEY.SIZE], data: payload[KEY.DATA] };
    case MSG_TYPE.GLANCE:
      return { type: 'GLANCE', msg: payload[KEY.MSG] };
    case MSG_TYPE.ACTION_RERUN:
      return { type: 'ACTION_RERUN', idx: payload[KEY.IDX] };
    case MSG_TYPE.ACTION_RESULT:
      return { type: 'ACTION_RESULT', ok: payload[KEY.OK] === 1, msg: payload[KEY.MSG] };
    default:
      return { type: 'UNKNOWN', raw: payload };
  }
}

module.exports = {
  encodeRequestBoard,
  encodeBoardItem,
  encodeShowDeviceCode,
  encodeAuthOk,
  encodeAuthError,
  encodeStatus,
  encodeRequestQr,
  encodeQrData,
  encodeGlance,
  encodeActionResult,
  decode,
};
