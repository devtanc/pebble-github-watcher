#include "qr_unpack.h"

bool qr_module_at(const uint8_t *bytes, int size, int row, int col) {
  int i = row * size + col;
  return ((bytes[i >> 3] >> (7 - (i & 7))) & 1) != 0;
}
