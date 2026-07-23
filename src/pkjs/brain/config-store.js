// Reads user configuration from the Clay settings blob (localStorage
// 'clay-settings', a flat { messageKey: value } object). No hardcoded config:
// when nothing is set, getTargets() returns [] and the watch shows an empty
// state. Storage is injected for testing.
'use strict';

function ownerRepo(s) {
  var slash = s.indexOf('/');
  if (slash <= 0 || slash >= s.length - 1) return null;
  var owner = s.slice(0, slash).trim();
  var repo = s.slice(slash + 1).trim();
  if (!owner || !repo) return null;
  return { owner: owner, repo: repo };
}

function parseOne(token) {
  // "owner/repo#123" (a PR), "owner/repo:branch", or "owner/repo"
  var hash = token.indexOf('#');
  if (hash !== -1) {
    var t = ownerRepo(token.slice(0, hash));
    var pr = parseInt(token.slice(hash + 1).trim(), 10);
    if (!t || isNaN(pr)) return null;
    return { owner: t.owner, repo: t.repo, pr: pr };
  }
  var branch;
  var repoPart = token;
  var colon = token.indexOf(':');
  if (colon !== -1) {
    repoPart = token.slice(0, colon);
    branch = token.slice(colon + 1).trim() || undefined;
  }
  var t2 = ownerRepo(repoPart);
  if (!t2) return null;
  return { owner: t2.owner, repo: t2.repo, branch: branch };
}

function parseRepos(text) {
  if (!text) return [];
  return String(text)
    .split(/[\n,]+/)
    .map(function (s) { return s.trim(); })
    .filter(Boolean)
    .map(parseOne)
    .filter(Boolean);
}

function createConfigStore(deps) {
  var storage = deps.storage;

  function settings() {
    var raw = storage.getItem('clay-settings');
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  }

  function getTargets() {
    return parseRepos(settings().repos);
  }

  function getPat() {
    var pat = settings().pat;
    return (pat && String(pat).trim()) || null;
  }

  function getClientIdOverride() {
    var id = settings().clientId;
    return (id && String(id).trim()) || null;
  }

  function getPollMinutes() {
    var m = Number(settings().pollMinutes);
    return m && m > 0 ? m : 15;
  }

  function getUseTimeline() {
    var v = settings().useTimeline;
    return v === undefined ? true : !!v;
  }

  return {
    getTargets: getTargets,
    getPat: getPat,
    getClientIdOverride: getClientIdOverride,
    getPollMinutes: getPollMinutes,
    getUseTimeline: getUseTimeline,
  };
}

module.exports = { createConfigStore: createConfigStore, parseRepos: parseRepos };
