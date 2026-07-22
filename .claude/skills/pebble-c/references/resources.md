# Pebble Resources Reference

How to bundle images, fonts, and other assets, and load them in C. Asset files live under `resources/` (create it at the project root); each is declared in `package.json` under `pebble.resources.media[]`. Every entry's `name` becomes a `RESOURCE_ID_<NAME>` constant.

## package.json media entries

```json
"resources": {
  "media": [
    { "type": "bitmap", "name": "IMAGE_LOGO", "file": "images/logo.png" },
    { "type": "font",   "name": "FONT_PERFECT_24", "file": "fonts/perfect.ttf",
      "characterRegex": "[0-9:apm ]" },
    { "type": "raw",    "name": "DATA_TABLE", "file": "data/table.bin" }
  ]
}
```

Fields:
- **`type`** — `"bitmap"` (images, preferred), `"font"` (TTF), `"raw"` (untouched bytes), `"pbi"`/`"png"` (legacy image types, discouraged — use `bitmap`), plus `"pdc"` (Pebble Draw Command vector) and sequence types.
- **`name`** — uppercase-with-underscores identifier used in code.
- **`file`** — path relative to `resources/`.

## Images (bitmap)

Source PNGs are converted at build time. Optional optimization attributes on a `bitmap` entry:
- `"memoryFormat"`: `"Smallest"`, `"SmallestPalette"`, `"1Bit"`, `"8Bit"`, `"1BitPalette"`, `"2BitPalette"`, `"4BitPalette"` — controls in-RAM depth.
- `"storageFormat"`: `"pbi"` (raw, faster load, bigger) or `"png"` (compressed, smaller flash).
- `"spaceOptimization"`: `"storage"` or `"memory"`.

Load and free:

```c
GBitmap *b = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_LOGO);
if (!b) { APP_LOG(APP_LOG_LEVEL_ERROR, "logo load failed"); }
bitmap_layer_set_bitmap(bl, b);
// on unload: bitmap_layer_set_bitmap(bl, NULL) not required, but destroy layer then bitmap:
gbitmap_destroy(b);
```

Use transparency with `bitmap_layer_set_compositing_mode(bl, GCompOpSet)`. For memory, keep large images out of aplite/diorite (b/w) builds via platform-specific files (below), and reuse a single `GBitmap` rather than reloading in a redraw loop.

## Fonts

TrueType fonts are rasterized at the size embedded in the `name`. **The trailing number in the resource name sets the point size** — e.g. `FONT_PERFECT_24` renders at 24px. Trim the glyph set with `characterRegex` to shrink the resource (critical on aplite):

```json
{ "type": "font", "name": "FONT_LECO_36", "file": "fonts/leco.ttf",
  "characterRegex": "[0-9]", "trackingAdjust": -2 }
```

Load and free:

```c
GFont f = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_PERFECT_24));
text_layer_set_font(text_layer, f);
// on unload, after the layer no longer uses it:
fonts_unload_custom_font(f);
```

System fonts (no resource needed) come from `fonts_get_system_font(FONT_KEY_...)` — see `ui.md`.

## Platform-specific resources

To ship different assets per platform, append a platform tag to the **filename** and/or add a `targetPlatforms` attribute to the media entry. Filename tags the build system recognizes:
- `~color` / `~bw` — color vs black-and-white displays.
- `~round` / `~rect` — round (chalk) vs rectangular.
- `~<platform>` — `~aplite`, `~basalt`, `~chalk`, `~diorite`, `~emery`.

Example: place `logo~color.png` and `logo~bw.png`, declare `"file": "images/logo.png"`, and the correct variant is picked per platform automatically. Or restrict an entry to some platforms:

```json
{ "type": "bitmap", "name": "IMAGE_BG", "file": "images/bg.png",
  "targetPlatforms": ["basalt", "chalk", "emery"] }
```

This keeps heavy color art out of the aplite/diorite bundle. `RESOURCE_ID_IMAGE_BG` still resolves on excluded platforms only if the entry exists there — gate the C usage with `PBL_IF_COLOR_ELSE` to avoid referencing a missing id.

## Pebble Draw Command (PDC) — vector art

`type: "pdc"` (single) or a PDC sequence for animated vector graphics. Load with `gdraw_command_image_create_with_resource` / `gdraw_command_sequence_create_with_resource`, draw with `gdraw_command_image_draw` inside an update proc, and destroy accordingly. Prefer PDC for crisp scalable icons that adapt to round/rect. Consult the Graphics guide for the full sequence-playback loop.

## App resources vs published media (App Glances / Timeline)

- **App Glance** — the line of text/icon shown in the launcher for your app. Set at runtime with `app_glance_reload`, using icons declared as `publishedMedia` in `package.json` (which reference a `media` entry by name and assign a numeric `id`). See `apis.md` for the reload call.
- **Timeline pins** use `publishedMedia`/system icons too; covered in the Timeline guide.

`publishedMedia` example:

```json
"resources": {
  "media": [ { "type": "bitmap", "name": "GLANCE_ICON", "file": "images/glance.png" } ],
  "publishedMedia": [
    { "name": "GLANCE_ICON", "id": 1, "glance": "GLANCE_ICON" }
  ]
}
```

## Verifying resources

- Resource name mismatch is the top cause of `NULL` from `*_create_with_resource` → blank/crash. The `RESOURCE_ID_` constant must exactly match the `name` field.
- After editing `package.json` media, rebuild (`pebble build`) so the generated resource header updates.
- Keep total resources within flash limits (aplite is tightest); trim fonts with `characterRegex` and prefer `png` storage format for large images.
