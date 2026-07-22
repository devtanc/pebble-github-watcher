// Reads user configuration (watched targets, PAT) from storage. Clay writes
// these keys; until the config page exists, DEFAULT_TARGETS is used.
'use strict';

// PLACEHOLDER(clay): temporary hardcoded target. MUST be removed when the Clay
// config page lands (SPEC §11) — this becomes [] and the watch shows a
// "configure repos in the phone app" empty state. Watched targets then come
// solely from Clay via the gh_targets key.
var DEFAULT_TARGETS = [
  { owner: 'devtanc', repo: 'dynamo-helper', branch: 'master' },
];

function createConfigStore(deps) {
  var storage = deps.storage;
  var defaults = deps.defaults || DEFAULT_TARGETS;

  function getTargets() {
    var raw = storage.getItem('gh_targets');
    if (!raw) return defaults;
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return defaults; }
    if (!Array.isArray(parsed) || parsed.length === 0) return defaults;
    return parsed
      .filter(function (t) { return t && t.owner && t.repo; })
      .map(function (t) {
        return {
          owner: String(t.owner),
          repo: String(t.repo),
          branch: t.branch ? String(t.branch) : undefined,
          workflow: t.workflow ? String(t.workflow) : undefined,
        };
      });
  }

  function getPat() {
    return storage.getItem('gh_pat');
  }

  function setTargets(targets) {
    storage.setItem('gh_targets', JSON.stringify(targets));
  }

  return { getTargets: getTargets, getPat: getPat, setTargets: setTargets };
}

module.exports = { createConfigStore: createConfigStore, DEFAULT_TARGETS: DEFAULT_TARGETS };
