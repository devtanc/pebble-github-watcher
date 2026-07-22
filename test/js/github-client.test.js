const { createGithubClient } = require('../../src/pkjs/brain/github-client');
const { STATUS } = require('../../src/pkjs/brain/protocol');

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
