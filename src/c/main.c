#include <pebble.h>
#include <string.h>
#include "lib/protocol.h"
#include "lib/view_model.h"
#include "lib/qr_unpack.h"

#define MAX_REPOS 16
#define MAX_BOARD 16
#define PERSIST_KEY_GLANCE 1

typedef struct {
  char title[40];   // workflow name (CI) or PR title
  uint8_t status;
  uint32_t age_s;
  uint8_t action;   // ROW_ACTION_*
  int flat_idx;     // index into pkjs's flat item list (for QR / actions)
  int pr;           // PR number (0 for CI)
  char branch[20];  // CI: run branch
  char sha[10];     // CI: short commit sha
  uint32_t dur_s;   // CI: run duration (seconds)
} Child;

typedef struct {
  char name[32];
  uint8_t status;       // aggregate
  uint8_t child_count;
  uint8_t child_start;  // index into s_children of this repo's first item
} Repo;

static Repo s_repos[MAX_REPOS];
static uint8_t s_repo_count = 0;
// Children live in one flat pool indexed by their flat index (items arrive
// grouped by repo, so each repo's items are contiguous).
static Child s_children[MAX_BOARD];
static int s_sel_repo = 0;   // repo currently drilled into
static char s_status_text[96] = "Loading…";

// ---- Windows ---------------------------------------------------------------
static Window *s_main_window;      // level 1: repos
static MenuLayer *s_main_menu;
static TextLayer *s_status_layer;  // empty / error state on the main window

static Window *s_repo_window = NULL;   // level 2: a repo's items
static MenuLayer *s_repo_menu = NULL;

static Window *s_detail_window = NULL;  // level 3: item detail + action
static TextLayer *s_detail_title_layer = NULL;
static TextLayer *s_detail_status_layer = NULL;
static char s_detail_title[64] = "";
static char s_detail_status[96] = "";
static int s_detail_flat_idx = -1;
static uint8_t s_detail_action = ROW_ACTION_NONE;
static int s_detail_state = 0; // 0 view, 1 confirm-merge, 2 working, 3 done

// Sign-in window
static Window *s_signin_window = NULL;
static TextLayer *s_signin_code;
static TextLayer *s_signin_instr;
static Layer *s_signin_qr_layer;
static uint8_t s_signin_qr_bytes[256];
static int s_signin_qr_size = 0;
static char s_user_code[16] = "";
static char s_instr_text[64] = "github.com/login/device";

// QR window. QRs are pushed proactively by the phone with the board (one per
// item, keyed by flat index), so long-press shows a cached QR instantly — no
// watch->phone round-trip.
#define MAX_QR_BYTES 256
static Window *s_qr_window = NULL;
static Layer *s_qr_layer;
static uint8_t s_qr_cache[MAX_BOARD][MAX_QR_BYTES];
static uint16_t s_qr_cache_size[MAX_BOARD]; // 0 = not cached yet
static int s_qr_current = -1;               // which cached QR the window shows

// ---- QR drawing (shared by the board QR window and the sign-in QR) ----------

static void draw_qr(GContext *ctx, GRect area, const uint8_t *bytes, int size) {
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, area, 0, GCornerNone);
  if (size <= 0) {
    return;
  }
  const int quiet = 4;
  int total = size + quiet * 2;
  int mindim = area.size.w < area.size.h ? area.size.w : area.size.h;
  int scale = mindim / total;
  if (scale < 1) scale = 1;
  int dim = scale * size;
  int ox = area.origin.x + (area.size.w - dim) / 2;
  int oy = area.origin.y + (area.size.h - dim) / 2;
  graphics_context_set_fill_color(ctx, GColorBlack);
  for (int r = 0; r < size; r++) {
    for (int c = 0; c < size; c++) {
      if (qr_module_at(bytes, size, r, c)) {
        graphics_fill_rect(ctx, GRect(ox + c * scale, oy + r * scale, scale, scale), 0, GCornerNone);
      }
    }
  }
}

// ---- Sign-in window ---------------------------------------------------------

static void signin_qr_update_proc(Layer *layer, GContext *ctx) {
  draw_qr(ctx, layer_get_bounds(layer), s_signin_qr_bytes, s_signin_qr_size);
}

static void signin_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);

  s_signin_code = text_layer_create(GRect(0, 0, b.size.w, 30));
  text_layer_set_font(s_signin_code, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD));
  text_layer_set_text_alignment(s_signin_code, GTextAlignmentCenter);
  text_layer_set_text(s_signin_code, s_user_code);
  layer_add_child(root, text_layer_get_layer(s_signin_code));

  s_signin_qr_layer = layer_create(GRect(0, 30, b.size.w, b.size.h - 50));
  layer_set_update_proc(s_signin_qr_layer, signin_qr_update_proc);
  layer_add_child(root, s_signin_qr_layer);

  s_signin_instr = text_layer_create(GRect(0, b.size.h - 20, b.size.w, 20));
  text_layer_set_text_alignment(s_signin_instr, GTextAlignmentCenter);
  text_layer_set_text(s_signin_instr, s_instr_text);
  layer_add_child(root, text_layer_get_layer(s_signin_instr));
}

static void signin_unload(Window *window) {
  text_layer_destroy(s_signin_code);
  layer_destroy(s_signin_qr_layer);
  text_layer_destroy(s_signin_instr);
}

static void show_signin(void) {
  if (!s_signin_window) {
    s_signin_window = window_create();
    window_set_window_handlers(s_signin_window, (WindowHandlers) {
      .load = signin_load,
      .unload = signin_unload,
    });
  }
  if (window_stack_get_top_window() != s_signin_window) {
    window_stack_push(s_signin_window, true);
  } else {
    text_layer_set_text(s_signin_code, s_user_code);
    text_layer_set_text(s_signin_instr, s_instr_text);
    layer_mark_dirty(s_signin_qr_layer);
  }
}

static void hide_signin(void) {
  if (s_signin_window && window_stack_contains_window(s_signin_window)) {
    window_stack_remove(s_signin_window, true);
  }
}

// ---- QR window --------------------------------------------------------------

static void qr_update_proc(Layer *layer, GContext *ctx) {
  if (s_qr_current < 0 || s_qr_cache_size[s_qr_current] == 0) return;
  draw_qr(ctx, layer_get_bounds(layer), s_qr_cache[s_qr_current], s_qr_cache_size[s_qr_current]);
}

static void qr_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_qr_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_qr_layer, qr_update_proc);
  layer_add_child(root, s_qr_layer);
}

static void qr_window_unload(Window *window) {
  layer_destroy(s_qr_layer);
}

static void show_qr(void) {
  if (!s_qr_window) {
    s_qr_window = window_create();
    window_set_window_handlers(s_qr_window, (WindowHandlers) {
      .load = qr_window_load,
      .unload = qr_window_unload,
    });
  }
  if (window_stack_get_top_window() != s_qr_window) {
    window_stack_push(s_qr_window, true);
  } else {
    layer_mark_dirty(s_qr_layer);
  }
}

// ---- Outbound (watch -> phone) ----------------------------------------------

static void send_action(int flat_idx, int kind) {
  DictionaryIterator *out;
  if (app_message_outbox_begin(&out) != APP_MSG_OK) return;
  int type = (kind == ROW_ACTION_MERGE) ? MSG_TYPE_ACTION_MERGE : MSG_TYPE_ACTION_RERUN;
  dict_write_int(out, MESSAGE_KEY_MsgType, &type, sizeof(int), true);
  dict_write_int(out, MESSAGE_KEY_Idx, &flat_idx, sizeof(int), true);
  app_message_outbox_send();
}

// ---- Level 3: item detail (folds the action confirm/result) -----------------

static void detail_render(void) {
  if (s_detail_state == 1) {
    snprintf(s_detail_status, sizeof(s_detail_status), "Merge this PR?\n\nSELECT = yes\nBACK = no");
  } else if (s_detail_state == 2) {
    snprintf(s_detail_status, sizeof(s_detail_status), "%s",
             (s_detail_action == ROW_ACTION_MERGE) ? "Merging…" : "Re-running…");
  }
  // state 0 (view) and 3 (done) set s_detail_status elsewhere (show_detail / result).
  if (s_detail_status_layer) {
    text_layer_set_text(s_detail_status_layer, s_detail_status);
  }
}

static void detail_select(ClickRecognizerRef recognizer, void *context) {
  if (s_detail_state == 0) {
    if (s_detail_action == ROW_ACTION_RERUN) {
      send_action(s_detail_flat_idx, ROW_ACTION_RERUN);
      s_detail_state = 2;
      detail_render();
    } else if (s_detail_action == ROW_ACTION_MERGE) {
      s_detail_state = 1; // ask for confirmation
      detail_render();
    }
  } else if (s_detail_state == 1) {
    send_action(s_detail_flat_idx, ROW_ACTION_MERGE);
    s_detail_state = 2;
    detail_render();
  }
}

static void detail_back(ClickRecognizerRef recognizer, void *context) {
  if (s_detail_state == 1) {
    s_detail_state = 0; // cancel the merge confirm, back to view
    snprintf(s_detail_status, sizeof(s_detail_status), "SELECT to merge");
    detail_render();
  } else {
    window_stack_pop(true);
  }
}

static void detail_click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, detail_select);
  window_single_click_subscribe(BUTTON_ID_BACK, detail_back);
}

static void detail_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  s_detail_title_layer = text_layer_create(GRect(4, 4, b.size.w - 8, 66));
  text_layer_set_font(s_detail_title_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_overflow_mode(s_detail_title_layer, GTextOverflowModeWordWrap);
  text_layer_set_text(s_detail_title_layer, s_detail_title);
  layer_add_child(root, text_layer_get_layer(s_detail_title_layer));

  s_detail_status_layer = text_layer_create(GRect(4, 74, b.size.w - 8, b.size.h - 78));
  text_layer_set_text_alignment(s_detail_status_layer, GTextAlignmentCenter);
  text_layer_set_overflow_mode(s_detail_status_layer, GTextOverflowModeWordWrap);
  text_layer_set_text(s_detail_status_layer, s_detail_status);
  layer_add_child(root, text_layer_get_layer(s_detail_status_layer));
}

static void detail_unload(Window *window) {
  text_layer_destroy(s_detail_title_layer);
  text_layer_destroy(s_detail_status_layer);
  s_detail_title_layer = NULL;
  s_detail_status_layer = NULL;
}

static void show_detail(int repo_idx, int child_idx) {
  Child *c = &s_children[s_repos[repo_idx].child_start + child_idx];
  s_detail_flat_idx = c->flat_idx;
  s_detail_action = c->action;
  s_detail_state = 0;

  char age[8];
  vm_format_age(c->age_s, age, sizeof(age));
  const char *prompt = "";
  if (c->action == ROW_ACTION_MERGE) prompt = "\n\nSELECT to merge";
  else if (c->action == ROW_ACTION_RERUN) prompt = "\n\nSELECT to re-run";

  if (c->pr > 0) {
    snprintf(s_detail_title, sizeof(s_detail_title), "#%d %s", c->pr, c->title);
    snprintf(s_detail_status, sizeof(s_detail_status), "%s · updated %s ago%s",
             vm_status_word(c->status), age, prompt);
  } else {
    snprintf(s_detail_title, sizeof(s_detail_title), "%s", c->title);
    char took[24] = "";
    if (c->dur_s > 0) {
      char d[16];
      vm_format_dur(c->dur_s, d, sizeof(d));
      snprintf(took, sizeof(took), " · took %s", d);
    }
    snprintf(s_detail_status, sizeof(s_detail_status), "%s @ %s\nran %s ago%s\n%s%s",
             c->branch[0] ? c->branch : "?", c->sha[0] ? c->sha : "?", age, took,
             vm_status_word(c->status), prompt);
  }

  if (!s_detail_window) {
    s_detail_window = window_create();
    window_set_window_handlers(s_detail_window, (WindowHandlers) {
      .load = detail_load,
      .unload = detail_unload,
    });
    window_set_click_config_provider(s_detail_window, detail_click_config);
  }
  window_stack_push(s_detail_window, true);
}

// ---- Level 2: a repo's items ------------------------------------------------

static uint16_t repo_menu_num_rows(MenuLayer *menu, uint16_t section, void *context) {
  return s_repos[s_sel_repo].child_count;
}

static int16_t repo_menu_header_height(MenuLayer *menu, uint16_t section, void *context) {
  return MENU_CELL_BASIC_HEADER_HEIGHT;
}

static void repo_menu_draw_header(GContext *ctx, const Layer *cell, uint16_t section, void *context) {
  menu_cell_basic_header_draw(ctx, cell, s_repos[s_sel_repo].name);
}

static void repo_menu_draw_row(GContext *ctx, const Layer *cell, MenuIndex *cell_index, void *context) {
  Repo *repo = &s_repos[s_sel_repo];
  if (cell_index->row >= repo->child_count) return;
  Child *c = &s_children[repo->child_start + cell_index->row];
  char age[8];
  vm_format_age(c->age_s, age, sizeof(age));
  char sub[32];
  if (c->pr > 0) {
    snprintf(sub, sizeof(sub), "#%d  %s  %s", c->pr, vm_status_glyph(c->status), age);
  } else if (c->branch[0]) {
    char br[11];
    snprintf(br, sizeof(br), "%s", c->branch); // truncate branch to keep room for status/age
    snprintf(sub, sizeof(sub), "%s  %s  %s", br, vm_status_glyph(c->status), age);
  } else {
    snprintf(sub, sizeof(sub), "%s  %s", vm_status_glyph(c->status), age);
  }
  menu_cell_basic_draw(ctx, cell, c->title, sub, NULL);
}

static void repo_menu_select(MenuLayer *menu, MenuIndex *cell_index, void *context) {
  if (cell_index->row < s_repos[s_sel_repo].child_count) {
    show_detail(s_sel_repo, cell_index->row);
  }
}

static void repo_menu_select_long(MenuLayer *menu, MenuIndex *cell_index, void *context) {
  Repo *repo = &s_repos[s_sel_repo];
  if (cell_index->row < repo->child_count) {
    int fi = s_children[repo->child_start + cell_index->row].flat_idx;
    if (fi >= 0 && fi < MAX_BOARD && s_qr_cache_size[fi] > 0) {
      s_qr_current = fi;
      show_qr();
    } else {
      vibes_short_pulse(); // QR not cached yet — the phone is still sending
    }
  }
}

static void repo_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_repo_menu = menu_layer_create(layer_get_bounds(root));
  menu_layer_set_callbacks(s_repo_menu, NULL, (MenuLayerCallbacks) {
    .get_num_rows = repo_menu_num_rows,
    .get_header_height = repo_menu_header_height,
    .draw_header = repo_menu_draw_header,
    .draw_row = repo_menu_draw_row,
    .select_click = repo_menu_select,
    .select_long_click = repo_menu_select_long,
  });
  menu_layer_set_click_config_onto_window(s_repo_menu, window);
  layer_add_child(root, menu_layer_get_layer(s_repo_menu));
}

static void repo_window_unload(Window *window) {
  menu_layer_destroy(s_repo_menu);
  s_repo_menu = NULL;
}

static void show_repo(int repo_idx) {
  s_sel_repo = repo_idx;
  if (!s_repo_window) {
    s_repo_window = window_create();
    window_set_window_handlers(s_repo_window, (WindowHandlers) {
      .load = repo_window_load,
      .unload = repo_window_unload,
    });
  }
  window_stack_push(s_repo_window, true);
}

// ---- Level 1: repos ---------------------------------------------------------

static uint16_t main_menu_num_rows(MenuLayer *menu, uint16_t section, void *context) {
  return s_repo_count;
}

static void main_menu_draw_row(GContext *ctx, const Layer *cell, MenuIndex *cell_index, void *context) {
  if (cell_index->row >= s_repo_count) return;
  Repo *r = &s_repos[cell_index->row];
  char sub[24];
  snprintf(sub, sizeof(sub), "%s  %d item%s", vm_status_glyph(r->status), r->child_count,
           r->child_count == 1 ? "" : "s");
  menu_cell_basic_draw(ctx, cell, r->name, sub, NULL);
}

static void main_menu_select(MenuLayer *menu, MenuIndex *cell_index, void *context) {
  if (cell_index->row < s_repo_count) {
    show_repo(cell_index->row);
  }
}

static void main_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  s_main_menu = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_main_menu, NULL, (MenuLayerCallbacks) {
    .get_num_rows = main_menu_num_rows,
    .draw_row = main_menu_draw_row,
    .select_click = main_menu_select,
  });
  menu_layer_set_click_config_onto_window(s_main_menu, window);
  layer_add_child(root, menu_layer_get_layer(s_main_menu));

  s_status_layer = text_layer_create(GRect(4, bounds.size.h / 2 - 32, bounds.size.w - 8, 64));
  text_layer_set_text(s_status_layer, s_status_text);
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  text_layer_set_overflow_mode(s_status_layer, GTextOverflowModeWordWrap);
  layer_set_hidden(text_layer_get_layer(s_status_layer), s_repo_count > 0);
  layer_add_child(root, text_layer_get_layer(s_status_layer));
}

static void main_window_unload(Window *window) {
  text_layer_destroy(s_status_layer);
  menu_layer_destroy(s_main_menu);
}

static void refresh_menus(void) {
  if (s_main_menu) menu_layer_reload_data(s_main_menu);
  if (s_repo_menu) menu_layer_reload_data(s_repo_menu);
}

// ---- Incoming messages (phone -> watch) ------------------------------------

// Drop every cached QR. Called when a fresh board begins arriving so items that
// vanished (e.g. a merged PR) can't leave a stale QR behind at a reused index.
static void reset_qr_cache(void) {
  for (int i = 0; i < MAX_BOARD; i++) s_qr_cache_size[i] = 0;
  s_qr_current = -1;
}

static void handle_board_repo(DictionaryIterator *iter) {
  Tuple *ri = dict_find(iter, MESSAGE_KEY_RepoIdx);
  Tuple *cnt = dict_find(iter, MESSAGE_KEY_Count);
  Tuple *name = dict_find(iter, MESSAGE_KEY_Label);
  Tuple *st = dict_find(iter, MESSAGE_KEY_Status);
  if (!ri || !name || !st) return;
  int i = ri->value->int32;
  if (i < 0 || i >= MAX_REPOS) return;
  if (i == 0) reset_qr_cache(); // first repo of a new board load
  if (cnt) {
    int c = cnt->value->int32;
    s_repo_count = (c > MAX_REPOS) ? MAX_REPOS : (uint8_t) c;
  }
  snprintf(s_repos[i].name, sizeof(s_repos[i].name), "%s", name->value->cstring);
  s_repos[i].status = (uint8_t) st->value->int32;
  s_repos[i].child_count = 0; // children arrive after all repos
  layer_set_hidden(text_layer_get_layer(s_status_layer), s_repo_count > 0);
  refresh_menus();
}

static void handle_child(DictionaryIterator *iter) {
  Tuple *ri = dict_find(iter, MESSAGE_KEY_RepoIdx);
  Tuple *idx_t = dict_find(iter, MESSAGE_KEY_Idx);
  Tuple *label = dict_find(iter, MESSAGE_KEY_Label);
  Tuple *st = dict_find(iter, MESSAGE_KEY_Status);
  Tuple *age = dict_find(iter, MESSAGE_KEY_AgeS);
  Tuple *act = dict_find(iter, MESSAGE_KEY_Action);
  if (!ri || !idx_t || !label || !st || !age) return;
  int r = ri->value->int32;
  int fi = idx_t->value->int32;
  if (r < 0 || r >= MAX_REPOS || fi < 0 || fi >= MAX_BOARD) return;
  Child *c = &s_children[fi];
  snprintf(c->title, sizeof(c->title), "%s", label->value->cstring);
  c->status = (uint8_t) st->value->int32;
  c->age_s = (uint32_t) age->value->int32;
  c->action = act ? (uint8_t) act->value->int32 : ROW_ACTION_NONE;
  c->flat_idx = fi;
  Tuple *num = dict_find(iter, MESSAGE_KEY_Num);
  c->pr = num ? num->value->int32 : 0;
  Tuple *br = dict_find(iter, MESSAGE_KEY_Branch);
  Tuple *sh = dict_find(iter, MESSAGE_KEY_Sha);
  Tuple *du = dict_find(iter, MESSAGE_KEY_Dur);
  snprintf(c->branch, sizeof(c->branch), "%s", br ? br->value->cstring : "");
  snprintf(c->sha, sizeof(c->sha), "%s", sh ? sh->value->cstring : "");
  c->dur_s = du ? (uint32_t) du->value->int32 : 0;
  Repo *repo = &s_repos[r];
  if (repo->child_count == 0) repo->child_start = (uint8_t) fi;
  repo->child_count++;
  refresh_menus();
}

static void handle_status(DictionaryIterator *iter) {
  Tuple *msg_t = dict_find(iter, MESSAGE_KEY_Msg);
  if (msg_t) {
    snprintf(s_status_text, sizeof(s_status_text), "%s", msg_t->value->cstring);
    text_layer_set_text(s_status_layer, s_status_text);
  }
  s_repo_count = 0;
  reset_qr_cache(); // board replaced by a status screen — no items to point at
  layer_set_hidden(text_layer_get_layer(s_status_layer), false);
  refresh_menus();
}

static void handle_show_device_code(DictionaryIterator *iter) {
  Tuple *code_t = dict_find(iter, MESSAGE_KEY_UserCode);
  if (code_t) {
    snprintf(s_user_code, sizeof(s_user_code), "%s", code_t->value->cstring);
  }
  Tuple *size_tuple = dict_find(iter, MESSAGE_KEY_Size);
  Tuple *data_tuple = dict_find(iter, MESSAGE_KEY_Data);
  if (size_tuple && data_tuple) {
    uint16_t len = data_tuple->length;
    if (len > sizeof(s_signin_qr_bytes)) len = sizeof(s_signin_qr_bytes);
    memcpy(s_signin_qr_bytes, data_tuple->value->data, len);
    s_signin_qr_size = size_tuple->value->int32;
  }
  snprintf(s_instr_text, sizeof(s_instr_text), "github.com/login/device");
  show_signin();
}

static void handle_auth_error(DictionaryIterator *iter) {
  Tuple *msg_t = dict_find(iter, MESSAGE_KEY_Msg);
  const char *msg = msg_t ? msg_t->value->cstring : "sign-in failed";
  snprintf(s_instr_text, sizeof(s_instr_text), "Sign-in failed:\n%s", msg);
  show_signin();
}

// The phone pushes a QR per item after the board; cache it by flat index so a
// later long-press can show it instantly.
static void handle_qr_data(DictionaryIterator *iter) {
  Tuple *idx_t = dict_find(iter, MESSAGE_KEY_Idx);
  Tuple *size_tuple = dict_find(iter, MESSAGE_KEY_Size);
  Tuple *data_tuple = dict_find(iter, MESSAGE_KEY_Data);
  if (!idx_t || !size_tuple || !data_tuple) return;
  int fi = idx_t->value->int32;
  if (fi < 0 || fi >= MAX_BOARD) return;
  uint16_t len = data_tuple->length;
  if (len > MAX_QR_BYTES) len = MAX_QR_BYTES;
  memcpy(s_qr_cache[fi], data_tuple->value->data, len);
  s_qr_cache_size[fi] = (uint16_t) size_tuple->value->int32;
}

static void handle_glance(DictionaryIterator *iter) {
  Tuple *msg_t = dict_find(iter, MESSAGE_KEY_Msg);
  if (msg_t) {
    persist_write_string(PERSIST_KEY_GLANCE, msg_t->value->cstring);
  }
}

static void handle_action_result(DictionaryIterator *iter) {
  Tuple *ok_t = dict_find(iter, MESSAGE_KEY_Ok);
  Tuple *msg_t = dict_find(iter, MESSAGE_KEY_Msg);
  bool ok = ok_t && ok_t->value->int32 == 1;
  s_detail_state = 3;
  snprintf(s_detail_status, sizeof(s_detail_status), "%s",
           msg_t ? msg_t->value->cstring : (ok ? "Done" : "Failed"));
  if (s_detail_status_layer) {
    text_layer_set_text(s_detail_status_layer, s_detail_status);
  }
  if (ok) {
    vibes_short_pulse();
  } else {
    vibes_double_pulse();
  }
}

static void handle_wakeup(DictionaryIterator *iter) {
  Tuple *time_tuple = dict_find(iter, MESSAGE_KEY_Time);
  if (!time_tuple) return;
  time_t when = (time_t) time_tuple->value->int32;
  if (when <= time(NULL) + 60) return;
  wakeup_cancel_all();
  wakeup_schedule(when, 0, true);
}

static void inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *type_t = dict_find(iter, MESSAGE_KEY_MsgType);
  if (!type_t) return;
  switch (type_t->value->int32) {
    case MSG_TYPE_BOARD_REPO:       handle_board_repo(iter); break;
    case MSG_TYPE_BOARD_ITEM:       handle_child(iter); break;
    case MSG_TYPE_SHOW_DEVICE_CODE: handle_show_device_code(iter); break;
    case MSG_TYPE_AUTH_OK:          hide_signin(); break;
    case MSG_TYPE_AUTH_ERROR:       handle_auth_error(iter); break;
    case MSG_TYPE_STATUS:           handle_status(iter); break;
    case MSG_TYPE_QR_DATA:          handle_qr_data(iter); break;
    case MSG_TYPE_GLANCE:           handle_glance(iter); break;
    case MSG_TYPE_ACTION_RESULT:    handle_action_result(iter); break;
    case MSG_TYPE_WAKEUP:           handle_wakeup(iter); break;
    default: break;
  }
}

// ---- App lifecycle ----------------------------------------------------------

static void glance_reload(AppGlanceReloadSession *session, size_t limit, void *context) {
  if (limit < 1 || !persist_exists(PERSIST_KEY_GLANCE)) return;
  char subtitle[64];
  persist_read_string(PERSIST_KEY_GLANCE, subtitle, sizeof(subtitle));
  const AppGlanceSlice slice = {
    .layout = { .icon = APP_GLANCE_SLICE_DEFAULT_ICON, .subtitle_template_string = subtitle },
    .expiration_time = APP_GLANCE_SLICE_NO_EXPIRATION,
  };
  app_glance_add_slice(session, slice);
}

static void init(void) {
  if (launch_reason() == APP_LAUNCH_WAKEUP) {
    vibes_double_pulse();
  }
  app_message_register_inbox_received(inbox_received);
  app_message_open(512, 64);

  s_main_window = window_create();
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = main_window_load,
    .unload = main_window_unload,
  });
  window_stack_push(s_main_window, true);
}

static void deinit(void) {
  app_glance_reload(glance_reload, NULL);
  if (s_detail_window) window_destroy(s_detail_window);
  if (s_repo_window) window_destroy(s_repo_window);
  if (s_qr_window) window_destroy(s_qr_window);
  if (s_signin_window) window_destroy(s_signin_window);
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
