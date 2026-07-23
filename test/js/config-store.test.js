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

describe('config-store watched repos', () => {
  test('empty when unset', () => {
    expect(cs(store()).getWatchedRepos()).toEqual([]);
    expect(cs(store({})).getWatchedRepos()).toEqual([]);
  });

  test('reads resolved savedRepos, dropping malformed entries', () => {
    expect(cs(store({ savedRepos: [{ owner: 'o', repo: 'r1' }, { owner: 'o' }, { repo: 'x' }] })).getWatchedRepos())
      .toEqual([{ owner: 'o', repo: 'r1' }]);
  });
});

describe('config-store manual targets', () => {
  test('empty when unset', () => {
    expect(cs(store({})).getManualTargets()).toEqual([]);
  });

  test('parses owner/repo, :branch and #PR, comma/newline separated', () => {
    expect(cs(store({ repos: 'a/b:main, c/d\n e/f#7' })).getManualTargets()).toEqual([
      { owner: 'a', repo: 'b', branch: 'main' },
      { owner: 'c', repo: 'd', branch: undefined },
      { owner: 'e', repo: 'f', pr: 7 },
    ]);
  });

  test('ignores malformed tokens', () => {
    expect(cs(store({ repos: 'noslash, /nope, ok/repo, bad/' })).getManualTargets())
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

  test('getCatalogTtlMs defaults to 1 hour, honors the setting', () => {
    expect(cs(store({})).getCatalogTtlMs()).toBe(3600000);
    expect(cs(store({ catalogTtlHours: 4 })).getCatalogTtlMs()).toBe(4 * 3600000);
  });
});
