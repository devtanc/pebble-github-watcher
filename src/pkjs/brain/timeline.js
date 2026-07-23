// Pushes a personal timeline pin via the (rebble-hosted) timeline web API.
// Best-effort: if no timeline token is available (e.g. the service is down or
// unconfigured), it resolves { ok:false } and the caller falls back to the
// local wakeup alert. Deps injected for testing.
'use strict';

var TIMELINE_API = 'https://timeline-api.rebble.io/v1/user/pins/';

function createTimeline(deps) {
  var getToken = deps.getToken; // getToken(successCb(token), failCb(err))
  var httpPut = deps.httpPut;   // httpPut(url, headers, body) -> Promise<{status}>

  function pushPin(pin) {
    return new Promise(function (resolve) {
      getToken(function (token) {
        httpPut(TIMELINE_API + pin.id, { 'X-User-Token': token }, pin).then(function (res) {
          resolve({ ok: res.status >= 200 && res.status < 300, status: res.status });
        });
      }, function () {
        resolve({ ok: false, error: 'no-token' });
      });
    });
  }

  return { pushPin: pushPin };
}

module.exports = { createTimeline: createTimeline };
