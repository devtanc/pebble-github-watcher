const { createTimeline } = require('../../src/pkjs/brain/timeline');

const pin = { id: 'ghw-42', time: '2026-07-22T00:05:00.000Z', layout: {} };

describe('timeline pushPin', () => {
  test('PUTs the pin to the timeline API with the user token', async () => {
    const put = jest.fn().mockResolvedValue({ status: 200 });
    const tl = createTimeline({ getToken: (ok) => ok('TOKEN'), httpPut: put });
    const r = await tl.pushPin(pin);
    const [url, headers, body] = put.mock.calls[0];
    expect(url).toBe('https://timeline-api.rebble.io/v1/user/pins/ghw-42');
    expect(headers['X-User-Token']).toBe('TOKEN');
    expect(body).toBe(pin);
    expect(r).toEqual({ ok: true, status: 200 });
  });

  test('resolves ok:false with no PUT when the token is unavailable', async () => {
    const put = jest.fn();
    const tl = createTimeline({ getToken: (ok, fail) => fail('unavailable'), httpPut: put });
    expect(await tl.pushPin(pin)).toEqual({ ok: false, error: 'no-token' });
    expect(put).not.toHaveBeenCalled();
  });

  test('resolves ok:false on a non-2xx response', async () => {
    const put = jest.fn().mockResolvedValue({ status: 500 });
    const tl = createTimeline({ getToken: (ok) => ok('TOKEN'), httpPut: put });
    expect(await tl.pushPin(pin)).toEqual({ ok: false, status: 500 });
  });
});
