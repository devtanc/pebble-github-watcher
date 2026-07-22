const { createConfigStore } = require('../../src/pkjs/brain/config-store');

// Storage seeded with a Clay settings blob (or empty).
function store(settings) {
  const s = {};
  if (settings !== undefined) s['clay-settings'] = JSON.stringify(settings);
  return {
    getItem: (k) => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; },
  };
}
const cs = (storage) => createConfigStore({ storage });

describe('config-store targets', () => {
  test('no config yields no targets (empty state)', () => {
    expect(cs(store()).getTargets()).toEqual([]);
    expect(cs(store({})).getTargets()).toEqual([]);
  });

  test('parses a single owner/repo:branch', () => {
    expect(cs(store({ repos: 'devtanc/dynamo-helper:master' })).getTargets())
      .toEqual([{ owner: 'devtanc', repo: 'dynamo-helper', branch: 'master' }]);
  });

  test('parses comma- and newline-separated repos, branch optional', () => {
    expect(cs(store({ repos: 'a/b:main, c/d\n e/f:dev' })).getTargets()).toEqual([
      { owner: 'a', repo: 'b', branch: 'main' },
      { owner: 'c', repo: 'd', branch: undefined },
      { owner: 'e', repo: 'f', branch: 'dev' },
    ]);
  });

  test('ignores malformed tokens', () => {
    expect(cs(store({ repos: 'noslash, /nope, ok/repo, bad/' })).getTargets())
      .toEqual([{ owner: 'ok', repo: 'repo', branch: undefined }]);
  });
});

describe('config-store other settings', () => {
  test('getPat trims, null when unset', () => {
    expect(cs(store({ pat: '  ghp_x  ' })).getPat()).toBe('ghp_x');
    expect(cs(store({})).getPat()).toBeNull();
  });

  test('getClientIdOverride', () => {
    expect(cs(store({ clientId: 'Iv2' })).getClientIdOverride()).toBe('Iv2');
    expect(cs(store({})).getClientIdOverride()).toBeNull();
  });

  test('getPollMinutes defaults to 15', () => {
    expect(cs(store({})).getPollMinutes()).toBe(15);
    expect(cs(store({ pollMinutes: 30 })).getPollMinutes()).toBe(30);
  });

  test('getUseTimeline defaults to true', () => {
    expect(cs(store({})).getUseTimeline()).toBe(true);
    expect(cs(store({ useTimeline: false })).getUseTimeline()).toBe(false);
  });
});
