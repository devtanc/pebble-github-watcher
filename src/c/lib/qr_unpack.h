#pragma once
// Pure QR grid reader — no pebble.h dependency, unit-tested on the host.
// Mirrors the packing in src/pkjs/brain/qr-encoder.js:
// 1 bit per module, row-major, MSB-first (bit index = row*size + col).
#include <stdint.h>
#include <stdbool.h>

// Returns true if the module at (row, col) is dark.
bool qr_module_at(const uint8_t *bytes, int size, int row, int col);
