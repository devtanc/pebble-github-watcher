# Pebble Data & Communication Reference

The "backend": talking to the phone/network via AppMessage + PebbleKit JS, and saving state with persistent storage. The C app on the watch **cannot reach the network directly** — all HTTP goes through JavaScript running on the phone (PebbleKit JS), which relays results over AppMessage.

```
[ watch C app ] ⇄ AppMessage ⇄ [ phone JS (pkjs) ] ⇄ XMLHttpRequest ⇄ [ internet ]
```

## Message keys

Every key exchanged must be declared in `package.json` under `pebble.messageKeys` (an array of names, or an object for explicit ids):

```json
"messageKeys": ["Temperature", "City", "RequestWeather"]
```

In C these become `MESSAGE_KEY_Temperature`, etc. In JS they are plain string keys (`"Temperature"`). Keeping names identical on both sides avoids confusion.

## AppMessage — C side

### Setup (in `init`, after handlers)

```c
static void inbox_received(DictionaryIterator *iter, void *context);
static void inbox_dropped(AppMessageResult reason, void *context);
static void outbox_sent(DictionaryIterator *iter, void *context);
static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context);

app_message_register_inbox_received(inbox_received);
app_message_register_inbox_dropped(inbox_dropped);
app_message_register_outbox_sent(outbox_sent);
app_message_register_outbox_failed(outbox_failed);

const uint32_t inbox = 256, outbox = 128;   // size for your largest message, in bytes
app_message_open(inbox, outbox);
// Or app_message_open(app_message_inbox_size_maximum(), app_message_outbox_size_maximum());
```

Sizing: a message's serialized size is ~7 bytes overhead per tuple plus the value. Undersized buffers cause `APP_MSG_BUFFER_OVERFLOW` (send) or dropped inbox messages. Don't over-allocate on aplite (RAM is scarce).

### Receiving

```c
static void inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *t = dict_find(iter, MESSAGE_KEY_Temperature);
  if (t) {
    int temp = t->value->int32;                 // copy out immediately
  }
  Tuple *city = dict_find(iter, MESSAGE_KEY_City);
  if (city) {
    static char s_city[32];
    snprintf(s_city, sizeof(s_city), "%s", city->value->cstring);
    text_layer_set_text(s_city_layer, s_city);  // layer keeps the pointer -> must be static
  }
}
```

`Tuple->value` is a union: `.int8 .uint8 .int16 .uint16 .int32 .uint32 .cstring .data[]`. **Never keep the `Tuple*` or `cstring` pointer past the callback** — the buffer is reused. Copy scalars to variables and strings/data into your own storage.

### Sending

```c
DictionaryIterator *out;
AppMessageResult r = app_message_outbox_begin(&out);
if (r == APP_MSG_OK) {
  int value = 1;
  dict_write_int(out, MESSAGE_KEY_RequestWeather, &value, sizeof(int), true /*signed*/);
  dict_write_cstring(out, MESSAGE_KEY_City, "London");
  dict_write_uint8(out, MESSAGE_KEY_Flags, 0x3);
  // dict_write_data(out, KEY, bytes, len);
  app_message_outbox_send();
} else {
  // busy — a send is already in flight; retry later (e.g. via AppTimer)
}
```

Only one outbox transfer is in flight at a time. If `outbox_begin` returns `APP_MSG_BUSY`, back off and retry. Handle `outbox_failed` (log `reason`, optionally retry with `AppTimer`). Common `AppMessageResult` codes: `APP_MSG_OK`, `APP_MSG_BUSY`, `APP_MSG_BUFFER_OVERFLOW`, `APP_MSG_NOT_CONNECTED`, `APP_MSG_SEND_TIMEOUT`.

## PebbleKit JS — phone side (`src/pkjs/index.js`)

Requires `"enableMultiJS": true` in `package.json`. Runs in the phone app's JS sandbox.

```js
// Fires once the JS environment and Bluetooth link are ready.
Pebble.addEventListener('ready', function() {
  console.log('PebbleKit JS ready');
  fetchWeather();
});

// Fires when the watch sends an AppMessage.
Pebble.addEventListener('appmessage', function(e) {
  var payload = e.payload;            // { RequestWeather: 1, City: "London" }
  if (payload.RequestWeather) fetchWeather();
});

function fetchWeather() {
  var req = new XMLHttpRequest();
  req.open('GET', 'https://api.example.com/weather?q=London', true);
  req.onload = function() {
    if (req.status === 200) {
      var data = JSON.parse(req.responseText);
      Pebble.sendAppMessage(
        { Temperature: Math.round(data.temp), City: data.name },
        function() { console.log('sent'); },
        function(err) { console.log('send failed: ' + JSON.stringify(err)); }
      );
    }
  };
  req.send();
}
```

Key points:
- **Do not send before `ready`.** Sending earlier silently fails.
- `Pebble.sendAppMessage(dict, onSuccess, onFailure)` — values are auto-typed (JS number → int, string → cstring, array of bytes → data).
- Network uses standard `XMLHttpRequest` (no `fetch` guarantee across SDK versions; XHR is safe). CORS does not apply — it's a native sandbox.
- `console.log` output appears in `pebble logs`.
- `Pebble.getAccountToken()` / `Pebble.getWatchToken()` give stable per-user / per-watch identifiers. `Pebble.getActiveWatchInfo()` returns model/platform/language.
- Geolocation: `navigator.geolocation.getCurrentPosition(success, error)` is available.

### Persisting JS-side settings

Use `localStorage` in pkjs for phone-side config (API keys, last query). It persists across launches:

```js
localStorage.setItem('city', 'London');
var city = localStorage.getItem('city') || 'London';
```

## App configuration pages (Clay)

To let users configure the app from the phone, add a config page. The manual path:

```js
Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL('https://myapp.example.com/config.html');
});
Pebble.addEventListener('webviewclosed', function(e) {
  if (!e.response) return;
  var config = JSON.parse(decodeURIComponent(e.response));
  // persist and/or forward to the watch via sendAppMessage
});
```

The **Clay** library (a Pebble package) generates the config page from a JSON schema and handles the round-trip — prefer it for real config UIs. Add it with `pebble package install pebble-clay` and follow its README; it wires `showConfiguration`/`webviewclosed` for you and delivers values as message keys.

## Persistent storage (watch-side)

Key-value store on the watch, keyed by `uint32_t`, surviving app exits and watch reboots. ~4KB total per app; each value up to `PERSIST_DATA_MAX_LENGTH` (256 bytes).

```c
#define KEY_COUNTER 1
#define KEY_NAME 2

if (persist_exists(KEY_COUNTER)) {
  int32_t n = persist_read_int(KEY_COUNTER);
}
persist_write_int(KEY_COUNTER, 42);

persist_write_string(KEY_NAME, "Tanner");
char buf[32];
persist_read_string(KEY_NAME, buf, sizeof(buf));

// arbitrary bytes:
persist_write_data(KEY_BLOB, &my_struct, sizeof(my_struct));
persist_read_data(KEY_BLOB, &my_struct, sizeof(my_struct));

persist_delete(KEY_COUNTER);
```

Read persisted state in `init`, write in `deinit` (or on change). Returns default (0/empty) if the key is absent, so pair with `persist_exists` when 0 is a valid value.

## Data logging and dictation

- **Data Logging** (`data_logging_create`, `data_logging_log`, `data_logging_finish`) batches sensor/event records for later bulk retrieval by a companion app — niche; consult docs when needed.
- **Dictation** (voice-to-text) is covered in `apis.md`.

## Debugging comms

- `pebble logs --emulator basalt` shows both `APP_LOG` (C) and `console.log` (JS).
- Emulator has no real Bluetooth/network by default; use `pebble emu-app-config` and note that some XHR endpoints may need a real phone. Test network paths on hardware when possible.
- If messages don't arrive: verify the key is in `messageKeys`, buffers are large enough, and JS waited for `ready`.
