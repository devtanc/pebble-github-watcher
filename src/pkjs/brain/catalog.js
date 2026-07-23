// Builds and caches the "catalog" of things you can watch — your repos, each
// one's workflows (pipelines) and open PRs — so the config page renders from a
// local cache instead of hitting GitHub on every open. Refetched when the cache
// is older than the configured TTL, or on an explicit refresh.
'use strict';

var CACHE_KEY = 'gh_catalog';

function createCatalog(deps) {
  var github = deps.github;
  var storage = deps.storage;
  var now = deps.now;

  function readCache() {
    var raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function isFresh(cache, ttlMs) {
    return !!(cache && cache.fetchedAt && (now() - cache.fetchedAt) < ttlMs);
  }

  function fetchFresh(token) {
    // Only the repo list is needed for the config page — pipelines are dropped
    // and PRs are discovered live at board load, not picked here.
    return github.listRepos(token).then(function (repos) {
      var catalog = { fetchedAt: now(), repos: repos };
      storage.setItem(CACHE_KEY, JSON.stringify(catalog));
      return catalog;
    });
  }

  // get(token, ttlMs, force) -> Promise<catalog>. Serves cache unless stale/forced.
  function get(token, ttlMs, force) {
    var cache = readCache();
    if (!force && isFresh(cache, ttlMs)) {
      return Promise.resolve(cache);
    }
    return fetchFresh(token);
  }

  function invalidate() {
    storage.removeItem(CACHE_KEY);
  }

  return { get: get, invalidate: invalidate };
}

module.exports = { createCatalog: createCatalog, CACHE_KEY: CACHE_KEY };
