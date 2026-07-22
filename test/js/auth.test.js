const { createAuth, AuthError } = require('../../src/pkjs/brain/auth');

// Build an auth instance with fully injected, controllable dependencies.
function setup({ http, now, getPat, sleep } = {}) {
  const store = {};
  const httpMock = http || jest.fn();
  const sleeps = [];
  const deps = {
    httpPostForm: httpMock,
    storage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    now: now || (() => 1_000_000),
    sleep: sleep || ((ms) => { sleeps.push(ms); return Promise.resolve(); }),
    clientId: 'Iv23liTEST',
    getPat: getPat || (() => null),
  };
  return { auth: createAuth(deps), store, http: httpMock, sleeps };
}

const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEVICE_URL = 'https://github.com/login/device/code';

describe('auth device flow', () => {
  test('requestDeviceCode posts the client id and maps the response', async () => {
    const http = jest.fn().mockResolvedValue({ status: 200, body: {
      device_code: 'DEV', user_code: 'WXYZ-1234',
      verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900,
    } });
    const { auth } = setup({ http });
    const r = await auth.requestDeviceCode();
    expect(http).toHaveBeenCalledWith(DEVICE_URL, expect.objectContaining({ client_id: 'Iv23liTEST' }));
    expect(r).toEqual({
      deviceCode: 'DEV', userCode: 'WXYZ-1234',
      verificationUri: 'https://github.com/login/device', interval: 5, expiresIn: 900,
    });
  });

  test('pollForToken waits through authorization_pending, then stores the token', async () => {
    const http = jest.fn()
      .mockResolvedValueOnce({ status: 200, body: { error: 'authorization_pending' } })
      .mockResolvedValueOnce({ status: 200, body: { access_token: 'AT', refresh_token: 'RT', expires_in: 28800 } });
    const { auth, store, sleeps } = setup({ http, now: () => 1000 });
    const tok = await auth.pollForToken('DEV', 5);
    expect(tok.accessToken).toBe('AT');
    expect(sleeps).toEqual([5000, 5000]);
    expect(JSON.parse(store['gh_tokens'])).toMatchObject({
      accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000 + 28800 * 1000,
    });
  });

  test('pollForToken backs off on slow_down', async () => {
    const http = jest.fn()
      .mockResolvedValueOnce({ status: 200, body: { error: 'slow_down', interval: 10 } })
      .mockResolvedValueOnce({ status: 200, body: { access_token: 'AT', expires_in: 100 } });
    const { auth, sleeps } = setup({ http });
    await auth.pollForToken('DEV', 5);
    expect(sleeps).toEqual([5000, 10000]);
  });

  test('pollForToken rejects when the user denies access', async () => {
    const http = jest.fn().mockResolvedValue({ status: 200, body: { error: 'access_denied' } });
    const { auth } = setup({ http });
    await expect(auth.pollForToken('DEV', 5)).rejects.toMatchObject({ code: 'access_denied' });
  });
});

describe('auth getAccessToken', () => {
  test('returns a configured PAT without any HTTP', async () => {
    const http = jest.fn();
    const { auth } = setup({ http, getPat: () => 'ghp_pat' });
    await expect(auth.getAccessToken()).resolves.toBe('ghp_pat');
    expect(http).not.toHaveBeenCalled();
  });

  test('returns a non-expired stored token without refreshing', async () => {
    const http = jest.fn();
    const { auth, store } = setup({ http, now: () => 1000 });
    store['gh_tokens'] = JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000 + 3600 * 1000 });
    await expect(auth.getAccessToken()).resolves.toBe('AT');
    expect(http).not.toHaveBeenCalled();
  });

  test('refreshes an expired token', async () => {
    const http = jest.fn().mockResolvedValue({ status: 200, body: {
      access_token: 'AT2', refresh_token: 'RT2', expires_in: 28800,
    } });
    const { auth, store } = setup({ http, now: () => 5_000_000 });
    store['gh_tokens'] = JSON.stringify({ accessToken: 'AT1', refreshToken: 'RT1', expiresAt: 1000 });
    await expect(auth.getAccessToken()).resolves.toBe('AT2');
    expect(http).toHaveBeenCalledWith(TOKEN_URL, expect.objectContaining({
      grant_type: 'refresh_token', refresh_token: 'RT1', client_id: 'Iv23liTEST',
    }));
    expect(JSON.parse(store['gh_tokens']).accessToken).toBe('AT2');
  });

  test('throws auth_required and clears tokens when refresh fails', async () => {
    const http = jest.fn().mockResolvedValue({ status: 400, body: { error: 'bad_refresh_token' } });
    const { auth, store } = setup({ http, now: () => 5_000_000 });
    store['gh_tokens'] = JSON.stringify({ accessToken: 'AT1', refreshToken: 'RT1', expiresAt: 1000 });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'auth_required' });
    expect(store['gh_tokens']).toBeUndefined();
  });

  test('throws auth_required when there is no stored token', async () => {
    const { auth } = setup({ http: jest.fn() });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'auth_required' });
  });
});
