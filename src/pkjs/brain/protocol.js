// Wire protocol — the single source of truth for the AppMessage contract.
// MUST stay in sync with src/c/lib/protocol.h (values) and the
// pebble.messageKeys array in package.json (key names).

// Discriminator carried in every message (the MsgType key).
const MSG_TYPE = {
  REQUEST_BOARD: 0, // watch -> phone: "send me the board"
  BOARD_ITEM: 1,    // phone -> watch: one row of the board (sent as a sequence)
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
};

module.exports = { MSG_TYPE, STATUS, KEY };
