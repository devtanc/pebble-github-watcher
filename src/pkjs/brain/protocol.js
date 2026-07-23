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
  GLANCE: 8,            // phone -> watch: launcher subtitle text (Msg)
  ACTION_RERUN: 9,      // watch -> phone: re-run failed jobs for row Idx
  ACTION_RESULT: 10,    // phone -> watch: action outcome (Ok + Msg)
  WAKEUP: 11,           // phone -> watch: schedule a wakeup at epoch Time (build-done ETA)
  ACTION_MERGE: 12,     // watch -> phone: merge the PR on row Idx
  BOARD_REPO: 13,       // phone -> watch: a repo group (RepoIdx, name, aggregate status)
};

// The long-press action available on a board row.
const ROW_ACTION = {
  NONE: 0,
  RERUN: 1, // re-run failed jobs (CI row)
  MERGE: 2, // merge PR (PR row)
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
  OK: 'Ok',
  TIME: 'Time',
  ACTION: 'Action',
  REPO_IDX: 'RepoIdx',
};

module.exports = { MSG_TYPE, STATUS, ROW_ACTION, KEY };
