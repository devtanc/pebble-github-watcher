const { build, repoList } = require('../../src/pkjs/config-page');

const catalog = { repos: [{ owner: 'o', repo: 'r1' }, { owner: 'o', repo: 'r2' }] };

function findGroup(cfg, key) {
  for (const section of cfg) {
    for (const item of (section.items || [])) {
      if (item.messageKey === key) return item;
    }
  }
  return null;
}

describe('config-page build', () => {
  test('repo checkbox options are owner/repo strings', () => {
    expect(findGroup(build(catalog), 'selRepos').options).toEqual(['o/r1', 'o/r2']);
  });

  test('checked defaults reflect savedRepos (matched by value, not index)', () => {
    const g = findGroup(build(catalog, [{ owner: 'o', repo: 'r2' }]), 'selRepos');
    expect(g.defaultValue).toEqual([false, true]);
  });

  test('repoList maps options back to repo objects in order', () => {
    expect(repoList(catalog)).toEqual([{ owner: 'o', repo: 'r1' }, { owner: 'o', repo: 'r2' }]);
  });

  test('has the TTL select and refresh toggle', () => {
    const cfg = build(catalog);
    expect(findGroup(cfg, 'catalogTtlHours')).toBeTruthy();
    expect(findGroup(cfg, 'refreshCatalog')).toBeTruthy();
  });

  test('paginates repos 20 per page with a page select', () => {
    const big = { repos: [] };
    for (let i = 0; i < 25; i++) big.repos.push({ owner: 'o', repo: 'r' + i });
    expect(findGroup(build(big, [], 1), 'selRepos').options).toHaveLength(20);
    expect(findGroup(build(big, [], 2), 'selRepos').options).toHaveLength(5);
    expect(findGroup(build(big, [], 1), 'repoPage')).toBeTruthy();
    expect(repoList(big, 2)).toHaveLength(5);
  });

  test('no page select for a single page', () => {
    expect(findGroup(build(catalog), 'repoPage')).toBeNull();
  });

  test('handles an empty / undefined catalog', () => {
    expect(() => build()).not.toThrow();
    expect(findGroup(build({ repos: [] }), 'selRepos').options).toEqual([]);
  });
});
