// Maps GitHub Actions runs to board items. Transport (httpGetJson) and clock
// (now) are injected for testing. No async/await syntax (pkjs bundler limit).
'use strict';

var protocol = require('./protocol');
var STATUS = protocol.STATUS;
var ROW_ACTION = protocol.ROW_ACTION;
var API = 'https://api.github.com';

function createGithubClient(deps) {
  var httpGetJson = deps.httpGetJson;
  var httpPostJson = deps.httpPostJson;
  var httpPut = deps.httpPut;
  var now = deps.now;

  function headersFor(token) {
    return {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  function authErr() {
    var err = new Error('auth_required');
    err.code = 'auth_required';
    return err;
  }

  function runsUrl(target, perPage) {
    var base = API + '/repos/' + target.owner + '/' + target.repo;
    base += target.workflow ? ('/actions/workflows/' + target.workflow + '/runs') : '/actions/runs';
    var url = base + '?per_page=' + (perPage || 1);
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

  function ageFromIso(iso) {
    if (!iso) return 0;
    var ms = now() - Date.parse(iso);
    return ms > 0 ? Math.floor(ms / 1000) : 0;
  }

  function ageOf(run) {
    return run ? ageFromIso(run.updated_at) : 0;
  }

  function mapPrStatus(pr) {
    if (!pr || pr.state !== 'open') return STATUS.UNKNOWN;
    switch (pr.mergeable_state) {
      case 'clean': return STATUS.SUCCESS;
      case 'dirty':
      case 'blocked':
      case 'behind': return STATUS.FAILURE;
      case 'unstable':
      case 'unknown': return STATUS.IN_PROGRESS;
      default: return STATUS.UNKNOWN; // draft, etc.
    }
  }

  function fetchRun(token, target) {
    return httpGetJson(runsUrl(target), headersFor(token)).then(function (res) {
      if (res.status === 401) throw authErr();
      var runs = (res.body && res.body.workflow_runs) || [];
      var run = runs[0] || null;
      var status = mapStatus(run);
      return {
        label: labelFor(target, run),
        title: 'CI', // level-2 row title within a repo
        status: status,
        ageS: ageOf(run),
        url: (run && run.html_url) || ('https://github.com/' + target.owner + '/' + target.repo),
        owner: target.owner,
        repo: target.repo,
        runId: run ? run.id : null,
        pr: null,
        action: status === STATUS.FAILURE ? ROW_ACTION.RERUN : ROW_ACTION.NONE,
      };
    });
  }

  function fetchPr(token, target) {
    var url = API + '/repos/' + target.owner + '/' + target.repo + '/pulls/' + target.pr;
    return httpGetJson(url, headersFor(token)).then(function (res) {
      if (res.status === 401) throw authErr();
      var pr = res.body || {};
      return {
        label: target.repo + '#' + target.pr,
        title: pr.title || ('#' + target.pr), // level-2 title (number goes to the subtitle)
        status: mapPrStatus(pr),
        ageS: ageFromIso(pr.updated_at),
        url: pr.html_url || ('https://github.com/' + target.owner + '/' + target.repo + '/pull/' + target.pr),
        owner: target.owner,
        repo: target.repo,
        runId: null,
        pr: target.pr,
        action: pr.mergeable_state === 'clean' ? ROW_ACTION.MERGE : ROW_ACTION.NONE,
      };
    });
  }

  function fetchTarget(token, target) {
    return target.pr ? fetchPr(token, target) : fetchRun(token, target);
  }

  function fetchBoard(token, targets) {
    return Promise.all(targets.map(function (t) { return fetchTarget(token, t); }));
  }

  // Fetch recent runs and split into the current in-progress run (if any) and
  // the completed runs' timings. Used to estimate a "build likely done" ETA.
  function fetchRunTimings(token, target) {
    return httpGetJson(runsUrl(target, 10), headersFor(token)).then(function (res) {
      if (res.status === 401) {
        var err = new Error('auth_required');
        err.code = 'auth_required';
        throw err;
      }
      var runs = (res.body && res.body.workflow_runs) || [];
      var inProgress = null;
      var completed = [];
      for (var i = 0; i < runs.length; i++) {
        var r = runs[i];
        var startedAt = Date.parse(r.run_started_at || r.created_at);
        if (r.status !== 'completed') {
          if (!inProgress) inProgress = { id: r.id, startedAtMs: startedAt };
        } else {
          completed.push({ startedAtMs: startedAt, endedAtMs: Date.parse(r.updated_at) });
        }
      }
      return { inProgress: inProgress, completed: completed };
    });
  }

  // POST rerun-failed-jobs. Resolves { ok, msg }; rejects auth_required on 401.
  function rerunFailedJobs(token, owner, repo, runId) {
    var url = API + '/repos/' + owner + '/' + repo + '/actions/runs/' + runId + '/rerun-failed-jobs';
    return httpPostJson(url, headersFor(token), {}).then(function (res) {
      if (res.status === 401) {
        var err = new Error('auth_required');
        err.code = 'auth_required';
        throw err;
      }
      if (res.status === 201) return { ok: true, msg: 'Re-run started' };
      return { ok: false, msg: (res.body && res.body.message) ? res.body.message : ('HTTP ' + res.status) };
    });
  }

  // ---- Catalog listing (for the config page's checkbox lists) ----------------

  // All accessible repos, most-recently-updated first. Paginated internally
  // (100/page) up to a safety cap so >100 repos are still covered.
  function listRepos(token) {
    var all = [];
    function page(p) {
      var url = API + '/user/repos?per_page=100&sort=updated&direction=desc&page=' + p;
      return httpGetJson(url, headersFor(token)).then(function (res) {
        if (res.status === 401) throw authErr();
        var arr = Array.isArray(res.body) ? res.body : [];
        arr.forEach(function (r) {
          if (r.owner && r.owner.login && r.name) all.push({ owner: r.owner.login, repo: r.name });
        });
        if (arr.length === 100 && p < 5) return page(p + 1);
        return all;
      });
    }
    return page(1);
  }

  function listWorkflows(token, owner, repo) {
    var url = API + '/repos/' + owner + '/' + repo + '/actions/workflows?per_page=100';
    return httpGetJson(url, headersFor(token)).then(function (res) {
      if (res.status === 401) throw authErr();
      var wfs = (res.body && res.body.workflows) || [];
      return wfs.map(function (w) {
        return { name: w.name, file: w.path ? w.path.split('/').pop() : String(w.id) };
      });
    });
  }

  // Open PRs, most-recently-updated first, capped at the board size.
  function listOpenPrs(token, owner, repo) {
    var url = API + '/repos/' + owner + '/' + repo + '/pulls?state=open&sort=updated&direction=desc&per_page=16';
    return httpGetJson(url, headersFor(token)).then(function (res) {
      if (res.status === 401) throw authErr();
      var arr = Array.isArray(res.body) ? res.body : [];
      return arr.map(function (p) { return { number: p.number, title: p.title }; });
    });
  }

  // PUT merge. Resolves { ok, msg }; rejects auth_required on 401.
  function mergePr(token, owner, repo, pr) {
    var url = API + '/repos/' + owner + '/' + repo + '/pulls/' + pr + '/merge';
    return httpPut(url, headersFor(token), {}).then(function (res) {
      if (res.status === 401) throw authErr();
      if (res.status === 200) return { ok: true, msg: 'Merged' };
      return { ok: false, msg: (res.body && res.body.message) ? res.body.message : ('HTTP ' + res.status) };
    });
  }

  return {
    fetchTarget: fetchTarget,
    fetchBoard: fetchBoard,
    fetchRunTimings: fetchRunTimings,
    rerunFailedJobs: rerunFailedJobs,
    mergePr: mergePr,
    listRepos: listRepos,
    listWorkflows: listWorkflows,
    listOpenPrs: listOpenPrs,
  };
}

module.exports = { createGithubClient: createGithubClient };
