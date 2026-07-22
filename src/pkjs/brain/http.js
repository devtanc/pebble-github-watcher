// Thin XMLHttpRequest adapter. Kept separate so brain/auth.js (and later the
// GitHub client) stay transport-agnostic and testable with a mock.
'use strict';

// POST an application/x-www-form-urlencoded body and resolve { status, body },
// where body is the parsed JSON response (or {} if absent/unparseable).
// Never rejects — network failure resolves as { status: 0, body: {} }.
function httpPostForm(url, params) {
  return new Promise(function (resolve) {
    var encoded = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onload = function () {
      var body = {};
      try { body = JSON.parse(xhr.responseText); } catch (e) { body = {}; }
      resolve({ status: xhr.status, body: body });
    };
    xhr.onerror = function () { resolve({ status: 0, body: {} }); };
    xhr.send(encoded);
  });
}

module.exports = { httpPostForm };
