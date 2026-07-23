// Builds the Clay config page from the cached repo catalog. Clay's checkboxgroup
// renders each option as a plain string and stores its value as a boolean array
// (checked-state by index) — so options are display strings, and index.js
// resolves the checked booleans back to repos via repoList() at save time.
// Each checked repo is watched as: its CI + all its open PRs (discovered live).
'use strict';

var TTL_OPTIONS = [
  { label: '1 hour', value: 1 }, { label: '2 hours', value: 2 }, { label: '4 hours', value: 4 },
  { label: '6 hours', value: 6 }, { label: '8 hours', value: 8 },
  { label: '1 day', value: 24 }, { label: '2 days', value: 48 }, { label: '3 days', value: 72 },
  { label: '5 days', value: 120 }, { label: '7 days', value: 168 },
];

function repoLabels(catalog) {
  return catalog.repos.map(function (r) { return r.owner + '/' + r.repo; });
}

// Repos in the same order as the checkbox options — used to resolve checked
// booleans back to repo objects.
function repoList(catalog) {
  catalog = catalog || { repos: [] };
  return catalog.repos.map(function (r) { return { owner: r.owner, repo: r.repo }; });
}

function sameRepo(a, b) { return a.owner === b.owner && a.repo === b.repo; }

function checkedDefaults(repos, saved) {
  return repos.map(function (r) {
    return saved.some(function (s) { return sameRepo(s, r); });
  });
}

// build(catalog, savedRepos) -> Clay config array.
function build(catalog, savedRepos) {
  catalog = catalog || { repos: [] };
  savedRepos = savedRepos || [];
  return [
    { type: 'heading', defaultValue: 'GitHub Watcher' },
    { type: 'text', defaultValue: 'Tick the repos to watch. Each shows its CI plus a live row per open PR.' },
    {
      type: 'section',
      items: [
        { type: 'heading', defaultValue: 'Repositories' },
        {
          type: 'checkboxgroup', messageKey: 'selRepos', label: 'Watch these repos',
          options: repoLabels(catalog),
          defaultValue: checkedDefaults(repoList(catalog), savedRepos),
        },
      ],
    },
    {
      type: 'section',
      items: [
        { type: 'heading', defaultValue: 'Repo list' },
        { type: 'select', messageKey: 'catalogTtlHours', label: 'Auto-refresh list every', defaultValue: 1, options: TTL_OPTIONS },
        { type: 'toggle', messageKey: 'refreshCatalog', label: 'Refresh repositories now', defaultValue: false },
      ],
    },
    {
      type: 'section',
      items: [
        { type: 'heading', defaultValue: 'Advanced' },
        {
          type: 'input', messageKey: 'repos', label: 'Manual targets (optional)',
          attributes: { placeholder: 'owner/repo:branch, owner/repo#123' },
          description: 'Comma-separated. Adds to the checked repos above.',
        },
        {
          type: 'input', messageKey: 'pat', label: 'Access token (optional)',
          attributes: { type: 'password', placeholder: 'blank = sign in on watch' },
          description: 'Fine-grained PAT: Metadata: Read; Actions: Read and write; Checks: Read; ' +
            'Commit statuses: Read; Pull requests: Read and write; Contents: Read.',
        },
        { type: 'input', messageKey: 'clientId', label: 'GitHub App Client ID (advanced)' },
        { type: 'slider', messageKey: 'pollMinutes', label: 'Board refresh (minutes)', min: 5, max: 60, step: 5, defaultValue: 15 },
        { type: 'toggle', messageKey: 'useTimeline', label: 'Use timeline pins', defaultValue: true },
      ],
    },
    { type: 'submit', defaultValue: 'Save' },
  ];
}

module.exports = { build: build, repoList: repoList, TTL_OPTIONS: TTL_OPTIONS };
