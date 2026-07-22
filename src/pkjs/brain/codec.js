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

function encodeShowDeviceCode(info) {
  return {
    [KEY.MSG_TYPE]: MSG_TYPE.SHOW_DEVICE_CODE,
    [KEY.USER_CODE]: info.userCode,
    [KEY.VERIFY_URL]: info.verificationUri,
  };
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
  decode,
};
