// Maps GitHub Actions runs to board items. Transport (httpGetJson) and clock
// (now) are injected for testing. No async/await syntax (pkjs bundler limit).
'use strict';

var STATUS = require('./protocol').STATUS;
var API = 'https://api.github.com';

function createGithubClient(deps) {
  var httpGetJson = deps.httpGetJson;
  var now = deps.now;

  function headersFor(token) {
    return {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  function runsUrl(target) {
    var base = API + '/repos/' + target.owner + '/' + target.repo;
    base += target.workflow ? ('/actions/workflows/' + target.workflow + '/runs') : '/actions/runs';
    var url = base + '?per_page=1';
    if (target.branch) url += '&branch=' + encodeURIComponent(target.branch);
    return url;
  }

  function mapStatus(run) {
    if (!run) return STATUS.UNKNOWN;
    if (run.status !== 'completed') return STATUS.IN_PROGRESS;
    switch (run.conclusion) {
      case 'success': return STATUS.SUCCESS;
      case 'failure':
      case 'timed_out':
      case 'startup_failure': return STATUS.FAILURE;
      default: return STATUS.UNKNOWN;
    }
  }

  function labelFor(target, run) {
    var branch = target.branch || (run && run.head_branch) || 'default';
    return target.repo + ':' + branch;
  }

  function ageOf(run) {
    if (!run || !run.updated_at) return 0;
    var ms = now() - Date.parse(run.updated_at);
    return ms > 0 ? Math.floor(ms / 1000) : 0;
  }

  function fetchTarget(token, target) {
    return httpGetJson(runsUrl(target), headersFor(token)).then(function (res) {
      if (res.status === 401) {
        var err = new Error('auth_required');
        err.code = 'auth_required';
        throw err;
      }
      var runs = (res.body && res.body.workflow_runs) || [];
      var run = runs[0] || null;
      return {
        label: labelFor(target, run),
        status: mapStatus(run),
        ageS: ageOf(run),
        url: run ? run.html_url : null,
      };
    });
  }

  function fetchBoard(token, targets) {
    return Promise.all(targets.map(function (t) { return fetchTarget(token, t); }));
  }

  return { fetchTarget: fetchTarget, fetchBoard: fetchBoard };
}

module.exports = { createGithubClient: createGithubClient };
