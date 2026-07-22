#pragma once
// Wire protocol constants — MUST mirror src/pkjs/brain/protocol.js.
// Message-key *names* (MsgType, Idx, ...) come from package.json and are
// referenced in C as MESSAGE_KEY_<name>; the numeric values below are the ones
// this file owns.

#define MSG_TYPE_REQUEST_BOARD    0
#define MSG_TYPE_BOARD_ITEM       1
#define MSG_TYPE_SHOW_DEVICE_CODE 2
#define MSG_TYPE_AUTH_OK          3
#define MSG_TYPE_AUTH_ERROR       4
#define MSG_TYPE_STATUS           5

typedef enum {
  STATUS_UNKNOWN = 0,
  STATUS_SUCCESS = 1,
  STATUS_FAILURE = 2,
  STATUS_IN_PROGRESS = 3,
  STATUS_STALE = 4,
} BuildStatus;
