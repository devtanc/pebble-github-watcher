// Clay configuration page. Message keys here map to the flat settings read by
// brain/config-store.js (repos, pat, clientId, pollMinutes, useTimeline).
module.exports = [
  { type: 'heading', defaultValue: 'GitHub Watcher' },
  { type: 'text', defaultValue: 'Choose which repositories to watch and how to sign in.' },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Repositories' },
      {
        type: 'input',
        messageKey: 'repos',
        label: 'Repos',
        attributes: { placeholder: 'owner/repo:branch, owner/repo2' },
        description: 'Comma-separated. Format: owner/repo or owner/repo:branch. ' +
          'Example: devtanc/dynamo-helper:master, devtanc/other',
      },
    ],
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Authentication' },
      {
        type: 'input',
        messageKey: 'pat',
        label: 'Access token (optional)',
        attributes: { type: 'password', placeholder: 'blank = sign in on watch' },
        description: 'Leave blank to sign in on your watch with GitHub. To use a fine-grained ' +
          'personal access token instead, scope it to only the repos you watch and grant ONLY: ' +
          'Metadata: Read; Actions: Read and write; Checks: Read; Commit statuses: Read; ' +
          'Pull requests: Read and write; Contents: Read.',
      },
      {
        type: 'input',
        messageKey: 'clientId',
        label: 'GitHub App Client ID (advanced)',
        description: 'Overrides the built-in device-flow client id. Leave blank unless you are ' +
          'self-hosting your own GitHub App.',
      },
    ],
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Options' },
      {
        type: 'slider',
        messageKey: 'pollMinutes',
        label: 'Refresh interval (minutes)',
        min: 5, max: 60, step: 5, defaultValue: 15,
      },
      { type: 'toggle', messageKey: 'useTimeline', label: 'Use timeline pins', defaultValue: true },
    ],
  },
  { type: 'submit', defaultValue: 'Save' },
];
