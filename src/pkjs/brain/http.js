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

// GET and resolve { status, body, getHeader }, where body is parsed JSON (or {}).
// getHeader(name) exposes response headers (ETag, rate-limit) for later use.
// Never rejects — network failure resolves as { status: 0, body: {} }.
function httpGetJson(url, headers) {
  return new Promise(function (resolve) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    if (headers) {
      Object.keys(headers).forEach(function (k) { xhr.setRequestHeader(k, headers[k]); });
    }
    xhr.onload = function () {
      var body = {};
      try { body = JSON.parse(xhr.responseText); } catch (e) { body = {}; }
      resolve({
        status: xhr.status,
        body: body,
        getHeader: function (name) { return xhr.getResponseHeader(name); },
      });
    };
    xhr.onerror = function () { resolve({ status: 0, body: {} }); };
    xhr.send();
  });
}

// POST a JSON body (or empty) with custom headers; resolve { status, body }.
function httpPostJson(url, headers, body) {
  return new Promise(function (resolve) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    if (headers) {
      Object.keys(headers).forEach(function (k) { xhr.setRequestHeader(k, headers[k]); });
    }
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      var parsed = {};
      try { parsed = JSON.parse(xhr.responseText); } catch (e) { parsed = {}; }
      resolve({ status: xhr.status, body: parsed });
    };
    xhr.onerror = function () { resolve({ status: 0, body: {} }); };
    xhr.send(body ? JSON.stringify(body) : '');
  });
}

// PUT a JSON body with custom headers; resolve { status, body }.
function httpPut(url, headers, body) {
  return new Promise(function (resolve) {
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    if (headers) {
      Object.keys(headers).forEach(function (k) { xhr.setRequestHeader(k, headers[k]); });
    }
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      var parsed = {};
      try { parsed = JSON.parse(xhr.responseText); } catch (e) { parsed = {}; }
      resolve({ status: xhr.status, body: parsed });
    };
    xhr.onerror = function () { resolve({ status: 0, body: {} }); };
    xhr.send(body ? JSON.stringify(body) : '');
  });
}

module.exports = { httpPostForm, httpGetJson, httpPostJson, httpPut };
