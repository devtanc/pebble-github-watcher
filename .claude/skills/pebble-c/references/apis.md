# Pebble Services & Events Reference

Timing, sensors, system services, background execution, and wakeups. Subscribe in `init`/window-`load`, and **always unsubscribe** in the matching `deinit`/`unload`.

## Time and ticks (watchfaces)

Update once per minute/second via the tick timer:

```c
static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  static char s_time[8];
  strftime(s_time, sizeof(s_time), clock_is_24h_style() ? "%H:%M" : "%I:%M", tick_time);
  text_layer_set_text(s_time_layer, s_time);
}
tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);   // or SECOND_UNIT / HOUR_UNIT / DAY_UNIT
// tick_timer_service_unsubscribe();
```

Get the current time without ticks: `time_t now = time(NULL); struct tm *t = localtime(&now);`. `SECOND_UNIT` drains battery — use only when a seconds hand is visible. `clock_is_24h_style()` respects the user's setting.

## AppTimer (one-shot / polling)

```c
static void timer_cb(void *data) {
  // ...work...
  s_timer = app_timer_register(1000, timer_cb, NULL);   // reschedule for repeating
}
AppTimer *s_timer = app_timer_register(1000 /*ms*/, timer_cb, NULL);
app_timer_reschedule(s_timer, 500);
app_timer_cancel(s_timer);
```

Use for AppMessage retry backoff, animations you drive manually, or debouncing. Timers only fire while the app is running.

## Accelerometer

Two modes — batched data and tap events:

```c
// Tap (cheap, event-driven):
static void tap_handler(AccelAxisType axis, int32_t direction) { /* flick detected */ }
accel_tap_service_subscribe(tap_handler);

// Sampled data (for motion apps):
static void data_handler(AccelData *data, uint32_t num_samples) {
  int16_t x = data[0].x, y = data[0].y, z = data[0].z;
}
accel_data_service_subscribe(25 /*samples per batch*/, data_handler);
accel_service_set_sampling_rate(ACCEL_SAMPLING_25HZ);   // 10/25/50/100 HZ
// unsubscribe when done — sampling costs battery.
```

`accel_service_peek(&accel)` reads one sample synchronously (only when not subscribed to batched data).

## Compass

```c
static void compass_handler(CompassHeadingData h) {
  if (h.compass_status == CompassStatusCalibrated) {
    int deg = TRIGANGLE_TO_DEG(h.magnetic_heading);
  }
}
compass_service_subscribe(compass_handler);
compass_service_set_heading_filter(DEG_TO_TRIGANGLE(2));
```

## Health (HealthService)

Guard with `PBL_IF_HEALTH_ELSE` / `#if defined(PBL_HEALTH)`.

```c
#if defined(PBL_HEALTH)
HealthValue steps = health_service_sum_today(HealthMetricStepCount);
HealthValue hr = health_service_peek_current_value(HealthMetricHeartRateBPM);
health_service_events_subscribe(health_handler, NULL);
#endif
```

Metrics: `HealthMetricStepCount`, `HealthMetricActiveSeconds`, `HealthMetricWalkedDistanceMeters`, `HealthMetricSleepSeconds`, `HealthMetricHeartRateBPM`. Requires the user to have Health enabled.

## System services (vibes, backlight, battery, connection)

```c
vibes_short_pulse();  vibes_long_pulse();  vibes_double_pulse();
static const uint32_t seg[] = { 200, 100, 400 };
vibes_enqueue_custom_pattern((VibePattern){ .durations = seg, .num_segments = 3 });

light_enable_interaction();   // brief backlight; light_enable(true) forces on

BatteryChargeState b = battery_state_service_peek();  // b.charge_percent, b.is_charging
battery_state_service_subscribe(battery_handler);

bool phone = connection_service_peek_pebble_app_connection();
connection_service_subscribe((ConnectionHandlers){ .pebble_app_connection_handler = conn_handler });
```

## Unobstructed area (Timeline Quick View)

On modern faces the bottom can be covered by a peek card. Respect it so content isn't hidden:

```c
GRect full = layer_get_unobstructed_bounds(layer);
unobstructed_area_service_subscribe((UnobstructedAreaHandlers){
  .will_change = will_change, .did_change = did_change }, NULL);
```

## Background worker

A separate, tiny always-running binary for step-counting-style background work. Add C under `worker_src/c/` (the `wscript` auto-detects `worker_src` and builds `pebble-worker.elf`). The worker has its own `main()` and can only use a restricted API subset; it communicates with the foreground app via `AppWorkerMessage`:

```c
// foreground
app_worker_launch();
app_worker_message_subscribe(worker_msg_handler);
bool running = app_worker_is_running();
// worker <-> app
app_worker_send_message(TYPE, &msg);
```

Only one app may run a worker at a time (user grants permission). Use for persistent sensor logging; otherwise prefer `wakeup`.

## Wakeup (scheduled relaunch)

Relaunch the app at a future time even when closed:

```c
time_t future = time(NULL) + 3600;
WakeupId id = wakeup_schedule(future, 42 /*cookie*/, true /*notify if missed*/);
persist_write_int(KEY_WAKEUP_ID, id);

// in init, detect a wakeup launch:
if (launch_reason() == APP_LAUNCH_WAKEUP) {
  WakeupId id; int32_t cookie;
  wakeup_get_launch_event(&id, &cookie);
}
wakeup_cancel(id);   // or wakeup_cancel_all();
```

Wakeups are limited in number and minimum spacing; schedule conservatively. Ideal for periodic checks (e.g. a watcher that polls on a schedule) without a background worker.

## App Glance (launcher subtitle)

Update the text/icon shown in the launcher, typically at `deinit` so it reflects latest state:

```c
static void glance_reload(AppGlanceReloadSession *session, size_t limit, void *context) {
  if (limit < 1) return;
  const AppGlanceSlice slice = {
    .layout = { .icon = PUBLISHED_ID_GLANCE_ICON,
                .subtitle_template_string = "3 new events" },
    .expiration_time = time(NULL) + 3600,
  };
  app_glance_add_slice(session, slice);
}
app_glance_reload(glance_reload, NULL);
```

`PUBLISHED_ID_*` comes from `publishedMedia` in `package.json` (see `resources.md`).

## Dictation (voice input)

Available on watches with a microphone (`PBL_IF_MICROPHONE_ELSE`):

```c
DictationSession *s = dictation_session_create(256, dictation_cb, NULL);
dictation_session_start(s);
static void dictation_cb(DictationSession *s, DictationSessionStatus status, char *transcript, void *ctx) {
  if (status == DictationSessionStatusSuccess) text_layer_set_text(layer, transcript);
}
// dictation_session_destroy(s);
```

## Launch reasons

`launch_reason()` returns why the app started: `APP_LAUNCH_USER`, `APP_LAUNCH_WAKEUP`, `APP_LAUNCH_TIMELINE_ACTION`, `APP_LAUNCH_QUICK_LAUNCH`, `APP_LAUNCH_PHONE`, etc. Branch on it in `init` to handle wakeups or timeline actions differently from a normal launch.

## Unsubscribe checklist

Each `*_service_subscribe` needs its `*_service_unsubscribe` (or the app leaks/keeps sensors hot). Cancel `AppTimer`s and wakeups you no longer need. Battery: subscribing to `SECOND_UNIT` ticks or high accel sampling rates are the biggest drains — scope them tightly.
