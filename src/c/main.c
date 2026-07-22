#include <pebble.h>
#include "lib/protocol.h"
#include "lib/view_model.h"

#define MAX_ITEMS 16

typedef struct {
  char label[32];
  uint8_t status;
  uint32_t age_s;
} BoardItem;

static Window *s_main_window;
static MenuLayer *s_menu_layer;
static TextLayer *s_empty_layer;

static BoardItem s_items[MAX_ITEMS];
static uint8_t s_count = 0;
static AppTimer *s_retry_timer = NULL;

// ---- Board request (watch -> phone) ----------------------------------------

static void request_board(void *context) {
  s_retry_timer = NULL;
  DictionaryIterator *out;
  if (app_message_outbox_begin(&out) != APP_MSG_OK) {
    return; // busy; a later request/retry will cover it
  }
  int type = MSG_TYPE_REQUEST_BOARD;
  dict_write_int(out, MESSAGE_KEY_MsgType, &type, sizeof(int), true);
  app_message_outbox_send();
}

// ---- Incoming board rows (phone -> watch) ----------------------------------

static void inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *type_t = dict_find(iter, MESSAGE_KEY_MsgType);
  if (!type_t || type_t->value->int32 != MSG_TYPE_BOARD_ITEM) {
    return;
  }
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

static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  // Retry the request shortly (e.g. phone JS not ready yet).
  if (!s_retry_timer) {
    s_retry_timer = app_timer_register(750, request_board, NULL);
  }
}

// ---- MenuLayer callbacks ----------------------------------------------------

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

// ---- Window lifecycle -------------------------------------------------------

static void main_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  s_menu_layer = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_menu_layer, NULL, (MenuLayerCallbacks) {
    .get_num_rows = menu_get_num_rows,
    .draw_row = menu_draw_row,
  });
  menu_layer_set_click_config_onto_window(s_menu_layer, window);
  layer_add_child(root, menu_layer_get_layer(s_menu_layer));

  s_empty_layer = text_layer_create(GRect(0, bounds.size.h / 2 - 10, bounds.size.w, 20));
  text_layer_set_text(s_empty_layer, "Loading…");
  text_layer_set_text_alignment(s_empty_layer, GTextAlignmentCenter);
  layer_add_child(root, text_layer_get_layer(s_empty_layer));

  request_board(NULL);
}

static void main_window_unload(Window *window) {
  if (s_retry_timer) {
    app_timer_cancel(s_retry_timer);
    s_retry_timer = NULL;
  }
  text_layer_destroy(s_empty_layer);
  menu_layer_destroy(s_menu_layer);
}

// ---- App lifecycle ----------------------------------------------------------

static void init(void) {
  app_message_register_inbox_received(inbox_received);
  app_message_register_outbox_failed(outbox_failed);
  app_message_open(256, 64);

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
  app_event_loop();
  deinit();
}
