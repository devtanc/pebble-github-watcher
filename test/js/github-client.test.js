const { createGithubClient } = require('../../src/pkjs/brain/github-client');
const { STATUS, ROW_ACTION } = require('../../src/pkjs/brain/protocol');

const T0 = Date.parse('2026-07-22T00:00:00Z');
function client(http, now) {
  return createGithubClient({ httpGetJson: http, now: now || (() => T0) });
}
function runsBody(run) {
  return { status: 200, body: { workflow_runs: run ? [run] : [] } };
}

describe('github-client fetchTarget', () => {
  test('builds the runs URL with branch and sends the auth header', async () => {
    const http = jest.fn().mockResolvedValue(runsBody(null));
    await client(http).fetchTarget('TOKEN', { owner: 'o', repo: 'r', branch: 'main' });
    const [url, headers] = http.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/o/r/actions/runs?per_page=1&branch=main');
    expect(headers.Authorization).toBe('Bearer TOKEN');
  });

  test('uses the workflow-scoped URL when a workflow is set', async () => {
    const http = jest.fn().mockResolvedValue(runsBody(null));
    await client(http).fetchTarget('T', { owner: 'o', repo: 'r', workflow: 'ci.yml' });
    expect(http.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r/actions/workflows/ci.yml/runs?per_page=1');
  });

  test('maps a successful completed run with its age', async () => {
    const now = () => Date.parse('2026-07-22T00:01:00Z');
    const http = jest.fn().mockResolvedValue(runsBody({
      status: 'completed', conclusion: 'success', updated_at: '2026-07-22T00:00:00Z',
      head_branch: 'main', html_url: 'u',
    }));
    const item = await client(http, now).fetchTarget('T', { owner: 'o', repo: 'r', branch: 'main' });
    expect(item).toMatchObject({ label: 'r:main', status: STATUS.SUCCESS, ageS: 60, url: 'u' });
  });

  test('maps in_progress and failure conclusions', async () => {
    const httpIP = jest.fn().mockResolvedValue(runsBody({ status: 'in_progress', updated_at: '2026-07-22T00:00:00Z' }));
    const httpF = jest.fn().mockResolvedValue(runsBody({ status: 'completed', conclusion: 'failure', updated_at: '2026-07-22T00:00:00Z' }));
    expect((await client(httpIP).fetchTarget('T', { owner: 'o', repo: 'r' })).status).toBe(STATUS.IN_PROGRESS);
    expect((await client(httpF).fetchTarget('T', { owner: 'o', repo: 'r' })).status).toBe(STATUS.FAILURE);
  });

  test('no runs maps to UNKNOWN', async () => {
    const item = await client(jest.fn().mockResolvedValue(runsBody(null))).fetchTarget('T', { owner: 'o', repo: 'r', branch: 'x' });
    expect(item.status).toBe(STATUS.UNKNOWN);
  });

  test('a 401 rejects with auth_required', async () => {
    const http = jest.fn().mockResolvedValue({ status: 401, body: { message: 'Bad credentials' } });
    await expect(client(http).fetchTarget('T', { owner: 'o', repo: 'r' })).rejects.toMatchObject({ code: 'auth_required' });
  });
});

describe('github-client PR targets', () => {
  test('a clean PR maps to a mergeable SUCCESS row with a merge action', async () => {
    const http = jest.fn().mockResolvedValue({ status: 200, body: {
      state: 'open', mergeable_state: 'clean', updated_at: '2026-07-22T00:00:00Z',
      html_url: 'https://github.com/o/r/pull/7', number: 7,
    } });
    const item = await client(http).fetchTarget('T', { owner: 'o', repo: 'r', pr: 7 });
    expect(http.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r/pulls/7');
    expect(item).toMatchObject({
      label: 'r#7', status: STATUS.SUCCESS, pr: 7, action: ROW_ACTION.MERGE,
      url: 'https://github.com/o/r/pull/7',
    });
  });

  test('a dirty PR is FAILURE with no action', async () => {
    const http = jest.fn().mockResolvedValue({ status: 200, body: {
      state: 'open', mergeable_state: 'dirty', updated_at: '2026-07-22T00:00:00Z',
    } });
    const item = await client(http).fetchTarget('T', { owner: 'o', repo: 'r', pr: 9 });
    expect(item.status).toBe(STATUS.FAILURE);
    expect(item.action).toBe(ROW_ACTION.NONE);
  });
});

describe('github-client mergePr', () => {
  test('PUTs merge and returns ok on 200', async () => {
    const put = jest.fn().mockResolvedValue({ status: 200, body: { merged: true } });
    const r = await createGithubClient({ httpPut: put }).mergePr('T', 'o', 'r', 7);
    expect(put.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r/pulls/7/merge');
    expect(put.mock.calls[0][1].Authorization).toBe('Bearer T');
    expect(r).toEqual({ ok: true, msg: 'Merged' });
  });

  test('surfaces the error message on failure', async () => {
    const put = jest.fn().mockResolvedValue({ status: 405, body: { message: 'Pull Request is not mergeable' } });
    expect(await createGithubClient({ httpPut: put }).mergePr('T', 'o', 'r', 7))
      .toEqual({ ok: false, msg: 'Pull Request is not mergeable' });
  });
});

describe('github-client catalog listing', () => {
  test('listRepos maps and filters repos', async () => {
    const http = jest.fn().mockResolvedValue({ status: 200, body: [
      { name: 'a', owner: { login: 'o' } },
      { name: 'b', owner: { login: 'o2' } },
      { name: 'bad' }, // no owner -> dropped
    ] });
    const repos = await client(http).listRepos('T');
    expect(http.mock.calls[0][0]).toBe('https://api.github.com/user/repos?per_page=100&sort=updated&direction=desc&page=1');
    expect(repos).toEqual([{ owner: 'o', repo: 'a' }, { owner: 'o2', repo: 'b' }]);
  });

  test('listRepos paginates when a full page comes back', async () => {
    const full = [];
    for (let i = 0; i < 100; i++) full.push({ name: 'r' + i, owner: { login: 'o' } });
    const http = jest.fn()
      .mockResolvedValueOnce({ status: 200, body: full })
      .mockResolvedValueOnce({ status: 200, body: [{ name: 'last', owner: { login: 'o' } }] });
    const repos = await client(http).listRepos('T');
    expect(http.mock.calls[1][0]).toContain('page=2');
    expect(repos).toHaveLength(101);
  });

  test('listWorkflows maps name + file', async () => {
    const http = jest.fn().mockResolvedValue({ status: 200, body: { workflows: [
      { name: 'CI', path: '.github/workflows/ci.yml', id: 1 },
      { name: 'Deploy', path: '.github/workflows/deploy.yml', id: 2 },
    ] } });
    const wfs = await client(http).listWorkflows('T', 'o', 'r');
    expect(http.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r/actions/workflows?per_page=100');
    expect(wfs).toEqual([{ name: 'CI', file: 'ci.yml' }, { name: 'Deploy', file: 'deploy.yml' }]);
  });

  test('listOpenPrs maps number + title', async () => {
    const http = jest.fn().mockResolvedValue({ status: 200, body: [
      { number: 7, title: 'Fix bug' }, { number: 9, title: 'Add feature' },
    ] });
    const prs = await client(http).listOpenPrs('T', 'o', 'r');
    expect(http.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r/pulls?state=open&sort=updated&direction=desc&per_page=16');
    expect(prs).toEqual([{ number: 7, title: 'Fix bug' }, { number: 9, title: 'Add feature' }]);
  });
});

describe('github-client fetchRunTimings', () => {
  test('splits in-progress from completed runs', async () => {
    const http = jest.fn().mockResolvedValue({ status: 200, body: { workflow_runs: [
      { id: 5, status: 'in_progress', run_started_at: '2026-07-22T00:00:00Z' },
      { id: 4, status: 'completed', run_started_at: '2026-07-21T00:00:00Z', updated_at: '2026-07-21T00:02:00Z' },
    ] } });
    const c = client(http);
    const r = await c.fetchRunTimings('T', { owner: 'o', repo: 'r', branch: 'main' });
    expect(http.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r/actions/runs?per_page=10&branch=main');
    expect(r.inProgress).toEqual({ id: 5, startedAtMs: Date.parse('2026-07-22T00:00:00Z') });
    expect(r.completed).toEqual([
      { startedAtMs: Date.parse('2026-07-21T00:00:00Z'), endedAtMs: Date.parse('2026-07-21T00:02:00Z') },
    ]);
  });
});

describe('github-client rerunFailedJobs', () => {
  test('posts to the rerun-failed-jobs endpoint with auth', async () => {
    const post = jest.fn().mockResolvedValue({ status: 201, body: {} });
    const c = createGithubClient({ httpPostJson: post, now: () => T0 });
    const r = await c.rerunFailedJobs('TOKEN', 'o', 'r', 42);
    const [url, headers] = post.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/o/r/actions/runs/42/rerun-failed-jobs');
    expect(headers.Authorization).toBe('Bearer TOKEN');
    expect(r).toEqual({ ok: true, msg: 'Re-run started' });
  });

  test('surfaces the error message on failure', async () => {
    const post = jest.fn().mockResolvedValue({ status: 403, body: { message: 'No failed jobs' } });
    const c = createGithubClient({ httpPostJson: post });
    expect(await c.rerunFailedJobs('T', 'o', 'r', 1)).toEqual({ ok: false, msg: 'No failed jobs' });
  });

  test('rejects auth_required on 401', async () => {
    const post = jest.fn().mockResolvedValue({ status: 401, body: {} });
    const c = createGithubClient({ httpPostJson: post });
    await expect(c.rerunFailedJobs('T', 'o', 'r', 1)).rejects.toMatchObject({ code: 'auth_required' });
  });
});

describe('github-client fetchBoard', () => {
  test('maps multiple targets in order', async () => {
    const now = () => Date.parse('2026-07-22T00:00:30Z');
    const http = jest.fn()
      .mockResolvedValueOnce(runsBody({ status: 'completed', conclusion: 'success', updated_at: '2026-07-22T00:00:00Z', head_branch: 'main' }))
      .mockResolvedValueOnce(runsBody(null));
    const items = await client(http, now).fetchBoard('T', [{ owner: 'o', repo: 'a', branch: 'main' }, { owner: 'o', repo: 'b' }]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ label: 'a:main', status: STATUS.SUCCESS, ageS: 30 });
    expect(items[1]).toMatchObject({ label: 'b:default', status: STATUS.UNKNOWN });
  });
});
