#include <pebble.h>
#include <string.h>
#include "lib/protocol.h"
#include "lib/view_model.h"
#include "lib/qr_unpack.h"

#define MAX_ITEMS 16

typedef struct {
  char label[32];
  uint8_t status;
  uint32_t age_s;
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

  snprintf(s_items[idx].label, sizeof(s_items[idx].label), "%s", label_t->value->cstring);
  s_items[idx].status = (uint8_t) status_t->value->int32;
  s_items[idx].age_s = (uint32_t) age_t->value->int32;

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
    default: break;
  }
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

static void main_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  s_menu_layer = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_menu_layer, NULL, (MenuLayerCallbacks) {
    .get_num_rows = menu_get_num_rows,
    .draw_row = menu_draw_row,
    .select_click = menu_select,
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
