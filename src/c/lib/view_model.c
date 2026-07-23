#include "view_model.h"
#include "protocol.h"
#include <stdio.h>

void vm_format_age(uint32_t age_s, char *out, size_t out_len) {
  if (age_s < 60) {
    snprintf(out, out_len, "%us", (unsigned) age_s);
  } else if (age_s < 3600) {
    snprintf(out, out_len, "%um", (unsigned) (age_s / 60));
  } else if (age_s < 86400) {
    snprintf(out, out_len, "%uh", (unsigned) (age_s / 3600));
  } else {
    snprintf(out, out_len, "%ud", (unsigned) (age_s / 86400));
  }
}

const char *vm_status_glyph(uint8_t status) {
  switch (status) {
    case STATUS_SUCCESS:     return "OK";
    case STATUS_FAILURE:     return "X";
    case STATUS_IN_PROGRESS: return "~";
    case STATUS_STALE:       return "-";
    default:                 return "?";
  }
}

const char *vm_status_word(uint8_t status) {
  switch (status) {
    case STATUS_SUCCESS:     return "Passed";
    case STATUS_FAILURE:     return "Failing";
    case STATUS_IN_PROGRESS: return "Running";
    case STATUS_STALE:       return "Stale";
    default:                 return "Unknown";
  }
}
