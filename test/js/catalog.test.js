const { createCatalog, CACHE_KEY } = require('../../src/pkjs/brain/catalog');

function storage(init) {
  const s = Object.assign({}, init);
  return {
    _s: s,
    getItem: (k) => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; },
  };
}

function fakeGithub() {
  return {
    listRepos: jest.fn().mockResolvedValue([{ owner: 'o', repo: 'r' }]),
    listWorkflows: jest.fn().mockResolvedValue([{ name: 'CI', file: 'ci.yml' }]),
    listOpenPrs: jest.fn().mockResolvedValue([{ number: 7, title: 'Fix' }]),
  };
}

describe('catalog', () => {
  test('fetches the repo list and caches it (no per-repo calls)', async () => {
    const github = fakeGithub();
    const store = storage();
    const cat = createCatalog({ github, storage: store, now: () => 1000 });
    const c = await cat.get('T', 3600000, false);
    expect(c.repos).toEqual([{ owner: 'o', repo: 'r' }]);
    expect(c.fetchedAt).toBe(1000);
    expect(JSON.parse(store._s[CACHE_KEY]).fetchedAt).toBe(1000);
    expect(github.listWorkflows).not.toHaveBeenCalled();
    expect(github.listOpenPrs).not.toHaveBeenCalled();
  });

  test('serves the cache when fresh (no GitHub calls)', async () => {
    const github = fakeGithub();
    const cached = { fetchedAt: 1000, repos: [{ owner: 'o', repo: 'cached' }] };
    const store = storage({ [CACHE_KEY]: JSON.stringify(cached) });
    const cat = createCatalog({ github, storage: store, now: () => 1000 + 60000 }); // 1 min later
    const c = await cat.get('T', 3600000, false); // ttl 1h
    expect(c).toEqual(cached);
    expect(github.listRepos).not.toHaveBeenCalled();
  });

  test('refetches when the cache is older than the TTL', async () => {
    const github = fakeGithub();
    const store = storage({ [CACHE_KEY]: JSON.stringify({ fetchedAt: 0, repos: [] }) });
    const cat = createCatalog({ github, storage: store, now: () => 3600000 + 1 }); // just over 1h
    await cat.get('T', 3600000, false);
    expect(github.listRepos).toHaveBeenCalled();
  });

  test('force refetches even when fresh', async () => {
    const github = fakeGithub();
    const store = storage({ [CACHE_KEY]: JSON.stringify({ fetchedAt: 1000, repos: [] }) });
    const cat = createCatalog({ github, storage: store, now: () => 1000 });
    await cat.get('T', 3600000, true);
    expect(github.listRepos).toHaveBeenCalled();
  });

  test('invalidate clears the cache', () => {
    const store = storage({ [CACHE_KEY]: 'x' });
    createCatalog({ github: fakeGithub(), storage: store, now: () => 1 }).invalidate();
    expect(store._s[CACHE_KEY]).toBeUndefined();
  });
});
