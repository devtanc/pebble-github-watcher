// Wraps GET requests with ETag conditional requests and rate-limit awareness.
// A 304 (Not Modified) does NOT count against GitHub's REST rate limit, so
// caching ETags is the main lever for staying within budget. Injected deps
// (httpGetJson, storage, now) keep it unit-testable.
'use strict';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function createRateGovernor(deps) {
  var httpGetJson = deps.httpGetJson;
  var storage = deps.storage;
  var state = { remaining: null, reset: null };

  // GET with a conditional request; resolves { status, body, fromCache }.
  // On 304, returns the cached body (status normalized to 200).
  function get(url, headers) {
    var h = {};
    if (headers) {
      Object.keys(headers).forEach(function (k) { h[k] = headers[k]; });
    }
    var etag = storage.getItem('etag:' + url);
    if (etag) h['If-None-Match'] = etag;

    return httpGetJson(url, h).then(function (res) {
      if (res.getHeader) {
        var rem = num(res.getHeader('x-ratelimit-remaining'));
        var rst = num(res.getHeader('x-ratelimit-reset'));
        if (rem !== null) state.remaining = rem;
        if (rst !== null) state.reset = rst;
      }
      if (res.status === 304) {
        var cached = storage.getItem('body:' + url);
        return { status: 200, body: cached ? JSON.parse(cached) : {}, fromCache: true };
      }
      if (res.status === 200) {
        var newEtag = res.getHeader ? res.getHeader('ETag') : null;
        if (newEtag) {
          storage.setItem('etag:' + url, newEtag);
          storage.setItem('body:' + url, JSON.stringify(res.body));
        }
        return { status: 200, body: res.body, fromCache: false };
      }
      return { status: res.status, body: res.body, fromCache: false };
    });
  }

  function getRemaining() { return state.remaining; }

  // Suggest a poll interval (ms), backing off as the remaining budget shrinks.
  function suggestInterval(baseMs) {
    if (state.remaining === null) return baseMs;
    if (state.remaining < 100) return baseMs * 4;
    if (state.remaining < 500) return baseMs * 2;
    return baseMs;
  }

  return { get: get, getRemaining: getRemaining, suggestInterval: suggestInterval };
}

module.exports = { createRateGovernor: createRateGovernor };
