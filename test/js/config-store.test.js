const { createConfigStore, DEFAULT_TARGETS } = require('../../src/pkjs/brain/config-store');

function store(init) {
  const s = Object.assign({}, init);
  return {
    getItem: (k) => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; },
  };
}

describe('config-store', () => {
  test('returns defaults when unset', () => {
    expect(createConfigStore({ storage: store() }).getTargets()).toEqual(DEFAULT_TARGETS);
  });

  test('parses configured targets', () => {
    const cs = createConfigStore({ storage: store({ gh_targets: JSON.stringify([{ owner: 'o', repo: 'r', branch: 'dev' }]) }) });
    expect(cs.getTargets()).toEqual([{ owner: 'o', repo: 'r', branch: 'dev', workflow: undefined }]);
  });

  test('falls back to defaults on invalid JSON', () => {
    expect(createConfigStore({ storage: store({ gh_targets: 'not json' }) }).getTargets()).toEqual(DEFAULT_TARGETS);
  });

  test('drops entries missing owner or repo', () => {
    const cs = createConfigStore({ storage: store({ gh_targets: JSON.stringify([{ owner: 'o' }, { owner: 'o', repo: 'r' }]) }) });
    expect(cs.getTargets()).toEqual([{ owner: 'o', repo: 'r', branch: undefined, workflow: undefined }]);
  });

  test('reads the PAT', () => {
    expect(createConfigStore({ storage: store({ gh_pat: 'ghp_x' }) }).getPat()).toBe('ghp_x');
    expect(createConfigStore({ storage: store() }).getPat()).toBeNull();
  });
});
