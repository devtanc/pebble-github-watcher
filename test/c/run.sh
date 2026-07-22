#!/usr/bin/env bash
# Host-compile and run the pure-C unit tests with Unity.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
BUILD="$DIR/.build"
mkdir -p "$BUILD"

cc -std=c11 -Wall -Wextra -Werror \
  -I"$DIR/vendor/unity" -I"$ROOT/src/c/lib" \
  "$DIR/vendor/unity/unity.c" \
  "$ROOT/src/c/lib/view_model.c" \
  "$DIR/test_view_model.c" \
  -o "$BUILD/test_view_model"

"$BUILD/test_view_model"
