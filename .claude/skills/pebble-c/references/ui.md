# Pebble UI Reference

The watch-side C toolkit: windows, layers, drawing, fonts, colors, animations, and input. All UI objects follow the create/destroy ownership rule — create in a window's `load`, destroy in `unload`, reverse order.

## Windows and the window stack

```c
Window *w = window_create();
window_set_background_color(w, GColorBlack);
window_set_window_handlers(w, (WindowHandlers) {
  .load = win_load,       // build child layers here
  .unload = win_unload,   // destroy them here
  .appear = win_appear,   // each time it becomes visible
  .disappear = win_disappear,
});
window_stack_push(w, true /* animated */);
window_stack_pop(true);
window_stack_pop_all(true);
bool on_top = window_stack_contains_window(w);
window_destroy(w);        // in deinit, after popping
```

Push additional windows for detail/menu screens; the back button pops automatically in watchapps. Fullscreen is the default on modern SDK.

## Layers (the base type) and custom drawing

Every visual element is a `Layer` or wraps one. A bare `Layer` with an update proc gives full custom drawing:

```c
static void canvas_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, GColorRed);
  graphics_fill_rect(ctx, GRect(0, 0, b.size.w, 20), 4, GCornersAll);
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_context_set_stroke_width(ctx, 3);
  graphics_draw_line(ctx, GPoint(0, 30), GPoint(b.size.w, 30));
  graphics_context_set_fill_color(ctx, GColorBlue);
  graphics_fill_circle(ctx, GPoint(b.size.w/2, b.size.h/2), 20);
}

Layer *canvas = layer_create(bounds);
layer_set_update_proc(canvas, canvas_update_proc);
layer_add_child(root, canvas);
// to repaint after state changes:
layer_mark_dirty(canvas);
// cleanup: layer_destroy(canvas);
```

Drawing only happens inside an update proc using the passed `GContext`. Never cache the context. To change what's drawn, mutate state then `layer_mark_dirty`.

Key graphics calls: `graphics_draw_pixel`, `graphics_draw_line`, `graphics_draw_rect`, `graphics_fill_rect(ctx, rect, corner_radius, corner_mask)`, `graphics_draw_circle`, `graphics_fill_circle`, `graphics_draw_round_rect`, `graphics_context_set_fill_color/stroke_color/stroke_width/antialiased`, `graphics_draw_bitmap_in_rect`, `graphics_draw_text`. Geometry types: `GPoint`, `GSize`, `GRect(x,y,w,h)`, `grect_center_point`, `grect_inset`.

`GPath` for filled polygons: build a `GPathInfo` with points, `gpath_create`, `gpath_move_to`/`gpath_rotate_to`, `gpath_draw_filled`/`gpath_draw_outline`, `gpath_destroy`.

## Colors and platform guards

`GColor` is 8-bit ARGB on color watches (basalt/chalk/emery), black/white on aplite/diorite.

```c
GColor c = GColorFromRGB(85, 170, 255);   // nearest of 64 displayable colors
GColor named = GColorVividCerulean;        // named constants exist
// Degrade gracefully on b/w screens:
window_set_background_color(w, PBL_IF_COLOR_ELSE(GColorDukeBlue, GColorBlack));
```

Compile-time guards: `PBL_IF_COLOR_ELSE(a,b)`, `PBL_IF_BW_ELSE(a,b)`, `PBL_IF_ROUND_ELSE(a,b)`, `PBL_IF_RECT_ELSE(a,b)`, `PBL_IF_MICROPHONE_ELSE`, `PBL_IF_HEALTH_ELSE`, and `#if defined(PBL_ROUND)` / `PBL_PLATFORM_CHALK`. Chalk is a 180×180 round display — center content and prefer `MenuLayer` (which auto-centers) over hardcoded rows.

## TextLayer

```c
TextLayer *t = text_layer_create(GRect(0, 0, bounds.size.w, 50));
text_layer_set_text(t, "Hello");                  // pointer must stay valid; use a static buffer for dynamic text
text_layer_set_font(t, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD));
text_layer_set_text_color(t, GColorWhite);
text_layer_set_background_color(t, GColorClear);
text_layer_set_text_alignment(t, GTextAlignmentCenter);
text_layer_set_overflow_mode(t, GTextOverflowModeWordWrap);
layer_add_child(root, text_layer_get_layer(t));
// text_layer_destroy(t);
```

For dynamic text keep a `static char s_buf[32];`, `snprintf` into it, then `text_layer_set_text(t, s_buf)` — the layer stores the pointer, not a copy.

## Fonts

System fonts via `fonts_get_system_font(FONT_KEY_...)`: e.g. `FONT_KEY_GOTHIC_14/18/24/28`, `_BOLD` variants, `FONT_KEY_BITHAM_42_BOLD`, `FONT_KEY_BITHAM_34_MEDIUM_NUMBERS`, `FONT_KEY_LECO_38_BOLD_NUMBERS`, `FONT_KEY_ROBOTO_CONDENSED_21`. Custom fonts are TTF resources (see `resources.md`): `GFont f = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_MY_FONT_24)); ... fonts_unload_custom_font(f);`

## BitmapLayer and images

```c
GBitmap *bmp = gbitmap_create_with_resource(RESOURCE_ID_MY_IMAGE);   // may return NULL — check
BitmapLayer *bl = bitmap_layer_create(bounds);
bitmap_layer_set_bitmap(bl, bmp);
bitmap_layer_set_compositing_mode(bl, GCompOpSet);   // GCompOpSet respects transparency (PNG alpha)
bitmap_layer_set_alignment(bl, GAlignCenter);
layer_add_child(root, bitmap_layer_get_layer(bl));
// order matters: bitmap_layer_destroy(bl); then gbitmap_destroy(bmp);
```

For sub-images from a spritesheet use `gbitmap_create_as_sub_bitmap`. Animated PDC/APNG sequences: see `apis.md` and `resources.md`.

## MenuLayer (scrolling lists)

The workhorse for list UIs. Provide callbacks for row count, height, and drawing:

```c
static uint16_t num_rows(MenuLayer *m, uint16_t section, void *ctx) { return s_count; }
static void draw_row(GContext *ctx, const Layer *cell, MenuIndex *idx, void *c) {
  menu_cell_basic_draw(ctx, cell, s_items[idx->row].title, s_items[idx->row].subtitle, NULL);
}
static void select_click(MenuLayer *m, MenuIndex *idx, void *c) { /* open detail */ }

MenuLayer *menu = menu_layer_create(bounds);
menu_layer_set_callbacks(menu, NULL, (MenuLayerCallbacks) {
  .get_num_rows = num_rows,
  .draw_row = draw_row,
  .select_click = select_click,
});
menu_layer_set_click_config_onto_window(menu, window);   // wires up buttons
layer_add_child(root, menu_layer_get_layer(menu));
// menu_layer_destroy(menu);
```

Use `menu_cell_basic_draw` / `menu_cell_title_draw` for standard rows, or draw custom cells with the passed `ctx`. `SimpleMenuLayer` is a lighter static-list alternative. Call `menu_layer_reload_data(menu)` after data changes.

## ScrollLayer

Wrap tall content for vertical scrolling:

```c
ScrollLayer *sl = scroll_layer_create(bounds);
scroll_layer_set_content_size(sl, GSize(bounds.size.w, 400));
scroll_layer_add_child(sl, text_layer_get_layer(long_text));
scroll_layer_set_click_config_onto_window(sl, window);
layer_add_child(root, scroll_layer_get_layer(sl));
```

## ActionBarLayer and StatusBarLayer

`ActionBarLayer` is the right-edge icon strip mapping up/select/down to actions:

```c
ActionBarLayer *ab = action_bar_layer_create();
action_bar_layer_set_icon(ab, BUTTON_ID_UP, s_up_icon);
action_bar_layer_set_click_config_provider(ab, click_config_provider);
action_bar_layer_add_to_window(ab, window);
```

`StatusBarLayer` shows a thin top bar (time/battery area): `status_bar_layer_create()`, set colors, add as a child.

## Input (buttons)

Watchapps receive button events through a click config provider; watchfaces do not.

```c
static void select_click(ClickRecognizerRef r, void *ctx) { /* ... */ }
static void up_long(ClickRecognizerRef r, void *ctx) { /* ... */ }
static void click_config_provider(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, 100 /*ms*/, down_click);
  window_long_click_subscribe(BUTTON_ID_UP, 500, up_long, NULL /* release */);
  window_multi_click_subscribe(BUTTON_ID_SELECT, 2, 2, 0, true, double_select);
}
window_set_click_config_provider(window, click_config_provider);
```

Buttons: `BUTTON_ID_BACK`, `BUTTON_ID_UP`, `BUTTON_ID_SELECT`, `BUTTON_ID_DOWN`. Overriding `BUTTON_ID_BACK` suppresses the default pop — do so sparingly. `ClickRecognizerRef` gives `click_number_of_clicks_counted(r)` for multi-click.

## Animations

`PropertyAnimation` animates a layer's frame; `Animation` with a custom implementation animates anything.

```c
GRect from = layer_get_frame(layer);
GRect to = GRect(0, 0, 100, 40);
PropertyAnimation *pa = property_animation_create_layer_frame(layer, &from, &to);
Animation *a = property_animation_get_animation(pa);
animation_set_duration(a, 300);
animation_set_curve(a, AnimationCurveEaseInOut);
animation_schedule(a);   // auto-frees after running by default
```

For arbitrary interpolation, implement `AnimationImplementation` with an `.update` callback receiving a normalized `AnimationProgress` (0..ANIMATION_NORMALIZED_MAX). `AnimationCurve` options include linear and ease variants. Use sparingly on aplite for performance.

## Layout tips for round (chalk)

- Read `layer_get_bounds` every time; never assume 144×168.
- Use `MenuLayer` (auto-centers rows) or `grect_center_point` for manual centering.
- Consider `menu_layer_set_center_focused(menu, true)` on round.
- Guard rectangular-only layouts with `PBL_IF_RECT_ELSE`.
