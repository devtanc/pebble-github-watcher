// Wire protocol — the single source of truth for the AppMessage contract.
// MUST stay in sync with src/c/lib/protocol.h (values) and the
// pebble.messageKeys array in package.json (key names).

// Discriminator carried in every message (the MsgType key).
const MSG_TYPE = {
  REQUEST_BOARD: 0,     // watch -> phone: "send me the board"
  BOARD_ITEM: 1,        // phone -> watch: one row of the board (sent as a sequence)
  SHOW_DEVICE_CODE: 2,  // phone -> watch: display this device-flow code
  AUTH_OK: 3,           // phone -> watch: signed in, proceed
  AUTH_ERROR: 4,        // phone -> watch: sign-in failed (carries a message)
  STATUS: 5,            // phone -> watch: board status text (empty / error state)
  REQUEST_QR: 6,        // watch -> phone: "send me a QR for row Idx"
  QR_DATA: 7,           // phone -> watch: QR grid (Size + packed Data)
};

// Build status for a board row.
const STATUS = {
  UNKNOWN: 0,
  SUCCESS: 1,
  FAILURE: 2,
  IN_PROGRESS: 3,
  STALE: 4,
};

// Pebble message-key names. These strings are the keys in the JS payload and
// map to MESSAGE_KEY_<name> on the C side. Order/spelling must match package.json.
const KEY = {
  MSG_TYPE: 'MsgType',
  IDX: 'Idx',
  COUNT: 'Count',
  LABEL: 'Label',
  STATUS: 'Status',
  AGE_S: 'AgeS',
  USER_CODE: 'UserCode',
  VERIFY_URL: 'VerifyUrl',
  MSG: 'Msg',
  SIZE: 'Size',
  DATA: 'Data',
};

module.exports = { MSG_TYPE, STATUS, KEY };
