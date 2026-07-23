#include <pebble.h>
#include <string.h>
#include "lib/protocol.h"
#include "lib/view_model.h"
#include "lib/qr_unpack.h"

#define MAX_ITEMS 16
#define PERSIST_KEY_GLANCE 1

typedef struct {
  char label[32];
  uint8_t status;
  uint32_t age_s;
  uint8_t action; // ROW_ACTION_* — long-press action for this row
} BoardItem;

// Board window
static Window *s_main_window;
static MenuLayer *s_menu_layer;
static TextLayer *s_empty_layer;
static BoardItem s_items[MAX_ITEMS];
static uint8_t s_count = 0;
static char s_status_text[96] = "Loading…";

// Sign-in window
static Window *s_signin_window = NULL;
static TextLayer *s_signin_code;
static TextLayer *s_signin_instr;
static Layer *s_signin_qr_layer;
static uint8_t s_signin_qr_bytes[256];
static int s_signin_qr_size = 0;
static char s_user_code[16] = "";
static char s_instr_text[64] = "github.com/login/device";

// QR window
static Window *s_qr_window = NULL;
static Layer *s_qr_layer;
static uint8_t s_qr_bytes[512];
static int s_qr_size = 0;

// Action window (confirm re-run, then show result)
static Window *s_action_window = NULL;
static TextLayer *s_action_text_layer = NULL;
static char s_action_text[96] = "";
static int s_action_idx = -1;
static int s_action_kind = 0;  // ROW_ACTION_RERUN or ROW_ACTION_MERGE
static int s_action_state = 0; // 0 = prompt, 1 = working, 2 = done

// ---- QR drawing (shared by the board QR window and the sign-in QR) ----------

static void draw_qr(GContext *ctx, GRect area, const uint8_t *bytes, int size) {
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, area, 0, GCornerNone);
  if (size <= 0) {
    return;
  }
  const int quiet = 4; // quiet-zone modules per side (needed for scanning)
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
    // Already visible — just refresh the on-screen content.
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
  draw_qr(ctx, layer_get_bounds(layer), s_qr_bytes, s_qr_size);
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

// ---- Incoming messages (phone -> watch) ------------------------------------

static void handle_board_item(DictionaryIterator *iter) {
  Tuple *idx_t = dict_find(iter, MESSAGE_KEY_Idx);
  Tuple *count_t = dict_find(iter, MESSAGE_KEY_Count);
  Tuple *label_t = dict_find(iter, MESSAGE_KEY_Label);
  Tuple *status_t = dict_find(iter, MESSAGE_KEY_Status);
  Tuple *age_t = dict_find(iter, MESSAGE_KEY_AgeS);
  if (!idx_t || !count_t || !label_t || !status_t || !age_t) {
    return;
  }
  int idx = idx_t->value->int32;
  if (idx < 0 || idx >= MAX_ITEMS) {
    return;
  }
  int count = count_t->value->int32;
  s_count = (count > MAX_ITEMS) ? MAX_ITEMS : (uint8_t) count;

  Tuple *action_t = dict_find(iter, MESSAGE_KEY_Action);
  snprintf(s_items[idx].label, sizeof(s_items[idx].label), "%s", label_t->value->cstring);
  s_items[idx].status = (uint8_t) status_t->value->int32;
  s_items[idx].age_s = (uint32_t) age_t->value->int32;
  s_items[idx].action = action_t ? (uint8_t) action_t->value->int32 : ROW_ACTION_NONE;

  layer_set_hidden(text_layer_get_layer(s_empty_layer), s_count > 0);
  menu_layer_reload_data(s_menu_layer);
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
    if (len > sizeof(s_signin_qr_bytes)) {
      len = sizeof(s_signin_qr_bytes);
    }
    memcpy(s_signin_qr_bytes, data_tuple->value->data, len);
    s_signin_qr_size = size_tuple->value->int32;
  }
  snprintf(s_instr_text, sizeof(s_instr_text), "github.com/login/device");
  show_signin();
}

static void handle_status(DictionaryIterator *iter) {
  Tuple *msg_t = dict_find(iter, MESSAGE_KEY_Msg);
  if (msg_t) {
    snprintf(s_status_text, sizeof(s_status_text), "%s", msg_t->value->cstring);
    text_layer_set_text(s_empty_layer, s_status_text);
  }
  s_count = 0;
  layer_set_hidden(text_layer_get_layer(s_empty_layer), false);
  menu_layer_reload_data(s_menu_layer);
}

static void handle_auth_error(DictionaryIterator *iter) {
  Tuple *msg_t = dict_find(iter, MESSAGE_KEY_Msg);
  const char *msg = msg_t ? msg_t->value->cstring : "sign-in failed";
  snprintf(s_instr_text, sizeof(s_instr_text), "Sign-in failed:\n%s", msg);
  show_signin();
}

static void handle_glance(DictionaryIterator *iter) {
  // Persist the launcher subtitle; it is applied on deinit (glance can only be
  // written by the foreground app, so we set it as the app closes).
  Tuple *msg_t = dict_find(iter, MESSAGE_KEY_Msg);
  if (msg_t) {
    persist_write_string(PERSIST_KEY_GLANCE, msg_t->value->cstring);
  }
}

static void handle_qr_data(DictionaryIterator *iter) {
  Tuple *size_tuple = dict_find(iter, MESSAGE_KEY_Size);
  Tuple *data_tuple = dict_find(iter, MESSAGE_KEY_Data);
  if (!size_tuple || !data_tuple) {
    return;
  }
  uint16_t len = data_tuple->length;
  if (len > sizeof(s_qr_bytes)) {
    len = sizeof(s_qr_bytes);
  }
  memcpy(s_qr_bytes, data_tuple->value->data, len);
  s_qr_size = size_tuple->value->int32;
  show_qr();
}

static void handle_action_result(DictionaryIterator *iter) {
  Tuple *ok_t = dict_find(iter, MESSAGE_KEY_Ok);
  Tuple *msg_t = dict_find(iter, MESSAGE_KEY_Msg);
  bool ok = ok_t && ok_t->value->int32 == 1;
  s_action_state = 2;
  snprintf(s_action_text, sizeof(s_action_text), "%s",
           msg_t ? msg_t->value->cstring : (ok ? "Done" : "Failed"));
  if (s_action_text_layer) {
    text_layer_set_text(s_action_text_layer, s_action_text);
  }
  if (ok) {
    vibes_short_pulse();
  } else {
    vibes_double_pulse();
  }
}

static void handle_wakeup(DictionaryIterator *iter) {
  Tuple *time_tuple = dict_find(iter, MESSAGE_KEY_Time);
  if (!time_tuple) {
    return;
  }
  time_t when = (time_t) time_tuple->value->int32;
  if (when <= time(NULL) + 60) {
    return; // too soon or in the past to schedule
  }
  wakeup_cancel_all();
  wakeup_schedule(when, 0, true); // notify_if_missed
}

static void inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *type_t = dict_find(iter, MESSAGE_KEY_MsgType);
  if (!type_t) {
    return;
  }
  switch (type_t->value->int32) {
    case MSG_TYPE_BOARD_ITEM:       handle_board_item(iter); break;
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

// ---- Action window (confirm re-run + show result) --------------------------

static void send_action(int idx, int kind) {
  DictionaryIterator *out;
  if (app_message_outbox_begin(&out) != APP_MSG_OK) {
    return;
  }
  int type = (kind == ROW_ACTION_MERGE) ? MSG_TYPE_ACTION_MERGE : MSG_TYPE_ACTION_RERUN;
  dict_write_int(out, MESSAGE_KEY_MsgType, &type, sizeof(int), true);
  dict_write_int(out, MESSAGE_KEY_Idx, &idx, sizeof(int), true);
  app_message_outbox_send();
}

static void action_confirm(ClickRecognizerRef recognizer, void *context) {
  if (s_action_state == 0) {
    send_action(s_action_idx, s_action_kind);
    s_action_state = 1;
    snprintf(s_action_text, sizeof(s_action_text), "%s",
             (s_action_kind == ROW_ACTION_MERGE) ? "Merging…" : "Re-running…");
    if (s_action_text_layer) {
      text_layer_set_text(s_action_text_layer, s_action_text);
    }
  }
}

static void action_click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, action_confirm);
}

static void action_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  s_action_text_layer = text_layer_create(GRect(6, b.size.h / 2 - 42, b.size.w - 12, 84));
  text_layer_set_text_alignment(s_action_text_layer, GTextAlignmentCenter);
  text_layer_set_overflow_mode(s_action_text_layer, GTextOverflowModeWordWrap);
  text_layer_set_text(s_action_text_layer, s_action_text);
  layer_add_child(root, text_layer_get_layer(s_action_text_layer));
}

static void action_unload(Window *window) {
  text_layer_destroy(s_action_text_layer);
  s_action_text_layer = NULL;
}

static void show_action(int idx, int kind) {
  s_action_idx = idx;
  s_action_kind = kind;
  s_action_state = 0;
  snprintf(s_action_text, sizeof(s_action_text), "%s\n\nSELECT = yes\nBACK = no",
           (kind == ROW_ACTION_MERGE) ? "Merge this PR?" : "Re-run failed jobs?");
  if (!s_action_window) {
    s_action_window = window_create();
    window_set_window_handlers(s_action_window, (WindowHandlers) {
      .load = action_load,
      .unload = action_unload,
    });
    window_set_click_config_provider(s_action_window, action_click_config);
  }
  window_stack_push(s_action_window, true);
}

// ---- Board window / MenuLayer ----------------------------------------------

static uint16_t menu_get_num_rows(MenuLayer *menu, uint16_t section, void *context) {
  return s_count;
}

static void menu_draw_row(GContext *ctx, const Layer *cell, MenuIndex *cell_index, void *context) {
  if (cell_index->row >= s_count) {
    return;
  }
  BoardItem *it = &s_items[cell_index->row];
  char age[8];
  vm_format_age(it->age_s, age, sizeof(age));
  char subtitle[24];
  snprintf(subtitle, sizeof(subtitle), "%s  %s", vm_status_glyph(it->status), age);
  menu_cell_basic_draw(ctx, cell, it->label, subtitle, NULL);
}

static void send_request_qr(int idx) {
  DictionaryIterator *out;
  if (app_message_outbox_begin(&out) != APP_MSG_OK) {
    return;
  }
  int type = MSG_TYPE_REQUEST_QR;
  dict_write_int(out, MESSAGE_KEY_MsgType, &type, sizeof(int), true);
  dict_write_int(out, MESSAGE_KEY_Idx, &idx, sizeof(int), true);
  app_message_outbox_send();
}

static void menu_select(MenuLayer *menu, MenuIndex *cell_index, void *context) {
  if (cell_index->row < s_count) {
    send_request_qr(cell_index->row);
  }
}

static void menu_select_long(MenuLayer *menu, MenuIndex *cell_index, void *context) {
  if (cell_index->row >= s_count) {
    return;
  }
  uint8_t action = s_items[cell_index->row].action;
  if (action == ROW_ACTION_RERUN || action == ROW_ACTION_MERGE) {
    show_action(cell_index->row, action);
  } else {
    vibes_short_pulse(); // no action available for this row
  }
}

static void main_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  s_menu_layer = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_menu_layer, NULL, (MenuLayerCallbacks) {
    .get_num_rows = menu_get_num_rows,
    .draw_row = menu_draw_row,
    .select_click = menu_select,
    .select_long_click = menu_select_long,
  });
  menu_layer_set_click_config_onto_window(s_menu_layer, window);
  layer_add_child(root, menu_layer_get_layer(s_menu_layer));

  s_empty_layer = text_layer_create(GRect(4, bounds.size.h / 2 - 32, bounds.size.w - 8, 64));
  text_layer_set_text(s_empty_layer, s_status_text);
  text_layer_set_text_alignment(s_empty_layer, GTextAlignmentCenter);
  text_layer_set_overflow_mode(s_empty_layer, GTextOverflowModeWordWrap);
  layer_add_child(root, text_layer_get_layer(s_empty_layer));
}

static void main_window_unload(Window *window) {
  text_layer_destroy(s_empty_layer);
  menu_layer_destroy(s_menu_layer);
}

// ---- App lifecycle ----------------------------------------------------------

static void init(void) {
  if (launch_reason() == APP_LAUNCH_WAKEUP) {
    APP_LOG(APP_LOG_LEVEL_INFO, "woke via wakeup");
    vibes_double_pulse(); // woke at the estimated build-done time
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

static void glance_reload(AppGlanceReloadSession *session, size_t limit, void *context) {
  if (limit < 1 || !persist_exists(PERSIST_KEY_GLANCE)) {
    return;
  }
  char subtitle[64];
  persist_read_string(PERSIST_KEY_GLANCE, subtitle, sizeof(subtitle));
  const AppGlanceSlice slice = {
    .layout = {
      .icon = APP_GLANCE_SLICE_DEFAULT_ICON,
      .subtitle_template_string = subtitle,
    },
    .expiration_time = APP_GLANCE_SLICE_NO_EXPIRATION,
  };
  app_glance_add_slice(session, slice);
}

static void deinit(void) {
  app_glance_reload(glance_reload, NULL);
  if (s_action_window) {
    window_destroy(s_action_window);
  }
  if (s_qr_window) {
    window_destroy(s_qr_window);
  }
  if (s_signin_window) {
    window_destroy(s_signin_window);
  }
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
