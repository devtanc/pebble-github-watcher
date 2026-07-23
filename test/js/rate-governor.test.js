const { createRateGovernor } = require('../../src/pkjs/brain/rate-governor');

function storage(init) {
  const s = Object.assign({}, init);
  return {
    _s: s,
    getItem: (k) => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; },
  };
}

// Build an httpGetJson mock whose response carries headers via getHeader.
function response(status, body, headers) {
  const h = headers || {};
  return { status, body, getHeader: (name) => (name in h ? h[name] : (name.toLowerCase() in h ? h[name.toLowerCase()] : null)) };
}

describe('rate-governor ETag caching', () => {
  test('caches the ETag and body on a 200, no conditional header first time', async () => {
    const http = jest.fn().mockResolvedValue(response(200, { a: 1 }, { ETag: 'W/"abc"' }));
    const store = storage();
    const gov = createRateGovernor({ httpGetJson: http, storage: store });
    const r = await gov.get('u', { Authorization: 'Bearer T' });
    expect(http.mock.calls[0][1]['If-None-Match']).toBeUndefined();
    expect(r).toEqual({ status: 200, body: { a: 1 }, fromCache: false });
    expect(store._s['etag:u']).toBe('W/"abc"');
    expect(JSON.parse(store._s['body:u'])).toEqual({ a: 1 });
  });

  test('sends If-None-Match when an ETag is cached, and serves cache on 304', async () => {
    const store = storage({ 'etag:u': 'W/"abc"', 'body:u': JSON.stringify({ a: 1 }) });
    const http = jest.fn().mockResolvedValue(response(304, {}, {}));
    const gov = createRateGovernor({ httpGetJson: http, storage: store });
    const r = await gov.get('u', {});
    expect(http.mock.calls[0][1]['If-None-Match']).toBe('W/"abc"');
    expect(r).toEqual({ status: 200, body: { a: 1 }, fromCache: true });
  });

  test('passes through non-200/304 statuses', async () => {
    const http = jest.fn().mockResolvedValue(response(401, { message: 'Bad creds' }, {}));
    const gov = createRateGovernor({ httpGetJson: http, storage: storage() });
    const r = await gov.get('u', {});
    expect(r).toMatchObject({ status: 401, fromCache: false });
  });
});

describe('rate-governor budget', () => {
  test('tracks remaining and backs off when low', async () => {
    const store = storage();
    const gov = createRateGovernor({ httpGetJson: jest.fn().mockResolvedValue(
      response(200, {}, { 'x-ratelimit-remaining': '50', 'x-ratelimit-reset': '123' })), storage: store });
    expect(gov.suggestInterval(1000)).toBe(1000); // unknown budget -> base
    await gov.get('u', {});
    expect(gov.getRemaining()).toBe(50);
    expect(gov.suggestInterval(1000)).toBe(4000); // <100 -> 4x
  });

  test('doubles when moderately low', async () => {
    const gov = createRateGovernor({ httpGetJson: jest.fn().mockResolvedValue(
      response(200, {}, { 'x-ratelimit-remaining': '300' })), storage: storage() });
    await gov.get('u', {});
    expect(gov.suggestInterval(1000)).toBe(2000);
  });
});
