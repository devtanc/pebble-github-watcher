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
    default:
      return { type: 'UNKNOWN', raw: payload };
  }
}

module.exports = { encodeRequestBoard, encodeBoardItem, decode };
