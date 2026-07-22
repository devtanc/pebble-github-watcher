#include <pebble.h>
#include "lib/protocol.h"
#include "lib/view_model.h"

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

// Sign-in window
static Window *s_signin_window = NULL;
static TextLayer *s_signin_title;
static TextLayer *s_signin_code;
static TextLayer *s_signin_instr;
static char s_user_code[16] = "";
static char s_instr_text[64] = "Enter at\ngithub.com/login/device";

// ---- Sign-in window ---------------------------------------------------------

static void signin_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);

  s_signin_title = text_layer_create(GRect(0, 6, b.size.w, 22));
  text_layer_set_text(s_signin_title, "Sign in to GitHub");
  text_layer_set_text_alignment(s_signin_title, GTextAlignmentCenter);
  layer_add_child(root, text_layer_get_layer(s_signin_title));

  s_signin_code = text_layer_create(GRect(0, b.size.h / 2 - 22, b.size.w, 32));
  text_layer_set_font(s_signin_code, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD));
  text_layer_set_text_alignment(s_signin_code, GTextAlignmentCenter);
  text_layer_set_text(s_signin_code, s_user_code);
  layer_add_child(root, text_layer_get_layer(s_signin_code));

  s_signin_instr = text_layer_create(GRect(4, b.size.h - 50, b.size.w - 8, 46));
  text_layer_set_text_alignment(s_signin_instr, GTextAlignmentCenter);
  text_layer_set_text(s_signin_instr, s_instr_text);
  layer_add_child(root, text_layer_get_layer(s_signin_instr));
}

static void signin_unload(Window *window) {
  text_layer_destroy(s_signin_title);
  text_layer_destroy(s_signin_code);
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
    // Already visible — just refresh the on-screen text.
    text_layer_set_text(s_signin_code, s_user_code);
    text_layer_set_text(s_signin_instr, s_instr_text);
  }
}

static void hide_signin(void) {
  if (s_signin_window && window_stack_contains_window(s_signin_window)) {
    window_stack_remove(s_signin_window, true);
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
  snprintf(s_instr_text, sizeof(s_instr_text), "Enter at\ngithub.com/login/device");
  show_signin();
}

static void handle_auth_error(DictionaryIterator *iter) {
  Tuple *msg_t = dict_find(iter, MESSAGE_KEY_Msg);
  const char *msg = msg_t ? msg_t->value->cstring : "sign-in failed";
  snprintf(s_instr_text, sizeof(s_instr_text), "Sign-in failed:\n%s", msg);
  show_signin();
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
}

static void main_window_unload(Window *window) {
  text_layer_destroy(s_empty_layer);
  menu_layer_destroy(s_menu_layer);
}

// ---- App lifecycle ----------------------------------------------------------

static void init(void) {
  app_message_register_inbox_received(inbox_received);
  app_message_open(256, 64);

  s_main_window = window_create();
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = main_window_load,
    .unload = main_window_unload,
  });
  window_stack_push(s_main_window, true);
}

static void deinit(void) {
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
