// GitHub OAuth device-flow auth. All I/O (http, storage, clock, sleep) is
// injected so this module is fully unit-tested off-device; index.js wires the
// real XMLHttpRequest / localStorage adapters.
//
// NOTE: the Pebble SDK's pkjs bundler (old webpack) cannot parse async/await
// syntax, so this module uses Promise .then() chains, not async functions.
'use strict';

var DEVICE_CODE_URL = 'https://github.com/login/device/code';
var TOKEN_URL = 'https://github.com/login/oauth/access_token';
var GRANT_DEVICE = 'urn:ietf:params:oauth:grant-type:device_code';
var STORAGE_KEY = 'gh_tokens';
var EXPIRY_SKEW_MS = 60 * 1000; // refresh a minute early to avoid edge races

function AuthError(code, message) {
  this.name = 'AuthError';
  this.code = code;
  this.message = message || code;
}
AuthError.prototype = Object.create(Error.prototype);
AuthError.prototype.constructor = AuthError;

function createAuth(deps) {
  var httpPostForm = deps.httpPostForm;
  var storage = deps.storage;
  var now = deps.now;
  var sleep = deps.sleep;
  var clientId = deps.clientId;
  var getPat = deps.getPat;

  function loadTokens() {
    var raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function saveFromResponse(body, prev) {
    var tok = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token || (prev && prev.refreshToken) || null,
      expiresAt: now() + (Number(body.expires_in) || 0) * 1000,
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(tok));
    return tok;
  }

  function signOut() {
    storage.removeItem(STORAGE_KEY);
  }

  function requestDeviceCode() {
    return httpPostForm(DEVICE_CODE_URL, { client_id: clientId }).then(function (res) {
      var b = (res && res.body) || {};
      if (!b.device_code) {
        throw new AuthError('device_code_failed', b.error || 'no device_code returned');
      }
      return {
        deviceCode: b.device_code,
        userCode: b.user_code,
        verificationUri: b.verification_uri,
        interval: b.interval || 5,
        expiresIn: b.expires_in,
      };
    });
  }

  function pollForToken(deviceCode, intervalSec) {
    var interval = intervalSec || 5;
    function attempt() {
      return sleep(interval * 1000).then(function () {
        return httpPostForm(TOKEN_URL, {
          client_id: clientId,
          device_code: deviceCode,
          grant_type: GRANT_DEVICE,
        });
      }).then(function (res) {
        var b = (res && res.body) || {};
        if (b.access_token) return saveFromResponse(b);
        switch (b.error) {
          case 'authorization_pending':
            return attempt();
          case 'slow_down':
            interval = b.interval || interval + 5;
            return attempt();
          default:
            throw new AuthError(b.error || 'unknown', b.error_description);
        }
      });
    }
    return attempt();
  }

  function refresh(prev) {
    return httpPostForm(TOKEN_URL, {
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: prev.refreshToken,
    }).then(function (res) {
      var b = (res && res.body) || {};
      if (!res || res.status !== 200 || b.error || !b.access_token) {
        signOut();
        throw new AuthError('auth_required', b.error || 'refresh failed');
      }
      return saveFromResponse(b, prev);
    });
  }

  // Resolve a usable access token, refreshing if needed. A configured PAT wins
  // and skips the device flow entirely.
  function getAccessToken() {
    var pat = getPat && getPat();
    if (pat) return Promise.resolve(pat);

    var tok = loadTokens();
    if (!tok || !tok.accessToken) return Promise.reject(new AuthError('auth_required'));
    if (now() < tok.expiresAt - EXPIRY_SKEW_MS) return Promise.resolve(tok.accessToken);
    if (!tok.refreshToken) { signOut(); return Promise.reject(new AuthError('auth_required')); }
    return refresh(tok).then(function (fresh) { return fresh.accessToken; });
  }

  return {
    requestDeviceCode: requestDeviceCode,
    pollForToken: pollForToken,
    getAccessToken: getAccessToken,
    signOut: signOut,
  };
}

module.exports = { createAuth: createAuth, AuthError: AuthError };
