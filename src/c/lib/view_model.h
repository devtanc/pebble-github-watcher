#pragma once
// Pure presentation helpers — no pebble.h dependency, so they are unit-tested
// on the host with Unity (test/c/test_view_model.c).
#include <stdint.h>
#include <stddef.h>

// Format an age in seconds as a compact label: "0s", "59s", "1m", "23h", "2d".
void vm_format_age(uint32_t age_s, char *out, size_t out_len);

// Short ASCII glyph for a BuildStatus value (safe on 1-bit displays).
const char *vm_status_glyph(uint8_t status);

// A human-readable word for a BuildStatus value (for the detail screen).
const char *vm_status_word(uint8_t status);
