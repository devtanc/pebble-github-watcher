---
name: Pebble C SDK
description: This skill should be used when building or editing a Pebble smartwatch app or watchface in C — creating Windows/Layers/TextLayer/MenuLayer, drawing graphics, handling button/tick/accel events, using AppMessage or PebbleKit JS to talk to the phone/network, persistent storage, declaring image/font resources in package.json, background workers, wakeups, or working with the pebble tool (build/install/emulator). Triggers include "pebble app", "watchface", "watchapp", "AppMessage", "PebbleKit JS", "gbitmap", "MenuLayer", "persist storage", "RESOURCE_ID", and "package.json pebble object".
version: 0.1.0
---

# Pebble C SDK

Guidance for building Pebble smartwatch apps and watchfaces in C using the modern SDK (`sdkVersion` 3, as served by developer.repebble.com / cloudpebble.repebble.com). The C code runs **on the watch**; optional JavaScript (PebbleKit JS) runs **on the phone** and is the only way to reach the network. This skill covers app anatomy, the memory/lifecycle rules that cause most bugs, and routes deeper work to reference files.

## Project structure (modern format)

A valid project root has a `package.json` with a top-level `pebble` object, plus C sources under `src/c/`:

```
package.json          # "pebble" object: uuid, sdkVersion "3", targetPlatforms, watchapp, messageKeys, resources
wscript               # build rules — globs src/c/**/*.c and src/pkjs/**/*.js (do not hand-edit unless adding libs)
src/c/main.c          # watch-side C app
src/pkjs/index.js     # optional phone-side JS (network, config); needs enableMultiJS:true
resources/            # image/font asset files referenced by package.json media[]
```

`messageKeys` entries in `package.json` become `MESSAGE_KEY_<Name>` constants in C. `resources.media[]` entries become `RESOURCE_ID_<NAME>`. See `references/resources.md`.

## App anatomy

Every C app follows this skeleton. Windows own layers; create children in the window's `load` handler and destroy them in `unload`, in reverse order.

```c
#include <pebble.h>

static Window *s_main_window;
static TextLayer *s_text_layer;

static void main_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  s_text_layer = text_layer_create(bounds);
  text_layer_set_text(s_text_layer, "Hello");
  layer_add_child(root, text_layer_get_layer(s_text_layer));
}

static void main_window_unload(Window *window) {
  text_layer_destroy(s_text_layer);
}

static void init(void) {
  s_main_window = window_create();
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = main_window_load,
    .unload = main_window_unload,
  });
  window_stack_push(s_main_window, true);
}

static void deinit(void) {
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();   // blocks, dispatching events, until the app exits
  deinit();
}
```

**Watchface vs watchapp:** set `pebble.watchapp.watchface` to `true` for a face (no button input, shown in the face carousel) or `false` for an app (launched from the menu, has buttons/back).

## Critical rules (most bugs come from violating these)

1. **Pair every `_create` with a `_destroy`.** Destroy in reverse order of creation. Leaks crash the watch — app RAM is tiny (aplite ~24KB, basalt/chalk/diorite ~64KB, emery larger).
2. **Own resources at the right scope.** Layers/fonts/bitmaps used by one window are created in `load` and destroyed in `unload`. App-lifetime objects live in `init`/`deinit`.
3. **Never store a pointer to a `Tuple` or its `value`** past the AppMessage callback — copy the data out immediately.
4. **`app_message_open()` must be called before sending/receiving**, after registering handlers. Size the buffers for your largest message.
5. **Prefix file-scope statics with `s_`** and mark them `static` — the established Pebble convention.
6. **Guard platform differences at compile time** with `PBL_IF_COLOR_ELSE(a,b)`, `PBL_IF_ROUND_ELSE(a,b)`, `PBL_PLATFORM_*`. Diorite and aplite are black/white; chalk is round (180×180). Never hardcode screen size — read `layer_get_bounds`.
7. **Redraw, don't push pixels.** Change state, then call `layer_mark_dirty()`; drawing happens only inside a layer's update proc with the supplied `GContext`.

## Choosing what to read

Load only the reference file the current task needs — this keeps context small:

| Task | Read |
|------|------|
| Windows, layers, TextLayer/BitmapLayer/MenuLayer/ScrollLayer/ActionBarLayer/StatusBar, custom drawing, fonts, colors, animations, button/click input | `references/ui.md` |
| AppMessage (send/receive dictionaries), PebbleKit JS (phone-side JS, network via XMLHttpRequest, config), persistent storage (`persist_*`) | `references/data-comms.md` |
| Declaring images/fonts/raw/pdc resources in `package.json`, platform-specific assets (`~color`, `~round`), font `characterRegex`, app glances / published media | `references/resources.md` |
| Timers (`AppTimer`), tick service, wakeups, background worker, accel/compass/health sensors, vibes, battery/connection, dictation, unobstructed area | `references/apis.md` |

For a UI-only task, `ui.md` alone is usually enough; for network/data work, `data-comms.md`. They are independent.

## Build and run (pebble tool)

```bash
pebble build                              # compiles all targetPlatforms into build/<app>.pbw
pebble install --emulator basalt          # boot emulator + install (basalt|aplite|chalk|diorite|emery)
pebble install --phone 192.168.1.42       # install to a real watch via the phone app's Developer Connection
pebble logs --emulator basalt             # stream APP_LOG output
pebble emu-app-config                      # open the Clay/config page in the emulator
```

Add `APP_LOG(APP_LOG_LEVEL_DEBUG, "x = %d", (int)x);` for tracing (`%d` needs an `int` cast; there is no `%f` — format floats manually). CloudPebble builds and installs the same project without the local tool.

## Common pitfalls

- **Blank screen / crash on launch:** a layer was added to the window but its backing object was destroyed too early, or a `NULL` bitmap/font from a failed `_create_with_resource`. Check resource names match `package.json`.
- **AppMessage never arrives:** buffers too small (`app_message_open` sizes), key not in `messageKeys`, or JS sent before the `ready` event fired.
- **`%f` prints garbage:** the embedded libc has no float formatting; scale to int or split whole/fraction.
- **Works on basalt, breaks on chalk:** hardcoded rectangular coordinates; use `layer_get_bounds` and `PBL_IF_ROUND_ELSE`.
- **Out of memory:** unfreed bitmaps in a redraw loop, or loading large images on aplite. Reuse one `GBitmap`, or gate large assets to color platforms.

## Additional resources

- **`references/ui.md`** — full UI toolkit: windows, every Layer subclass, the Graphics drawing API, fonts, colors, animations, and input handling.
- **`references/data-comms.md`** — AppMessage protocol, PebbleKit JS lifecycle and networking, and persistent storage.
- **`references/resources.md`** — declaring and loading images, fonts, and other assets; platform-specific variants.
- **`references/apis.md`** — timing, events, sensors, background worker, wakeups, and system services.
