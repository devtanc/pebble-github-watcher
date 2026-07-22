#!/usr/bin/env bash
# Host-compile and run the pure-C unit tests with Unity.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
BUILD="$DIR/.build"
mkdir -p "$BUILD"

# One binary per test file; each links all pure lib sources.
for test_file in test_view_model test_qr_unpack; do
  cc -std=c11 -Wall -Wextra -Werror \
    -I"$DIR/vendor/unity" -I"$ROOT/src/c/lib" \
    "$DIR/vendor/unity/unity.c" \
    "$ROOT/src/c/lib/view_model.c" \
    "$ROOT/src/c/lib/qr_unpack.c" \
    "$DIR/$test_file.c" \
    -o "$BUILD/$test_file"
  "$BUILD/$test_file"
done
