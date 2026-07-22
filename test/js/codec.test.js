const codec = require('../../src/pkjs/brain/codec');
const { MSG_TYPE, STATUS, KEY } = require('../../src/pkjs/brain/protocol');

describe('codec', () => {
  test('encodeRequestBoard sets only the message type', () => {
    expect(codec.encodeRequestBoard()).toEqual({ [KEY.MSG_TYPE]: MSG_TYPE.REQUEST_BOARD });
  });

  test('decode recognizes a board request', () => {
    expect(codec.decode({ [KEY.MSG_TYPE]: MSG_TYPE.REQUEST_BOARD })).toEqual({ type: 'REQUEST_BOARD' });
  });

  test('encodeBoardItem maps all fields onto message keys', () => {
    const wire = codec.encodeBoardItem({
      idx: 1, count: 3, label: 'api:main', status: STATUS.FAILURE, ageS: 120,
    });
    expect(wire).toEqual({
      [KEY.MSG_TYPE]: MSG_TYPE.BOARD_ITEM,
      [KEY.IDX]: 1,
      [KEY.COUNT]: 3,
      [KEY.LABEL]: 'api:main',
      [KEY.STATUS]: STATUS.FAILURE,
      [KEY.AGE_S]: 120,
    });
  });

  test('a board item round-trips through encode then decode', () => {
    const item = { idx: 0, count: 2, label: 'web:dev', status: STATUS.SUCCESS, ageS: 45 };
    expect(codec.decode(codec.encodeBoardItem(item))).toEqual({ type: 'BOARD_ITEM', ...item });
  });

  test('an unknown message type is surfaced, not thrown', () => {
    const out = codec.decode({ [KEY.MSG_TYPE]: 99 });
    expect(out.type).toBe('UNKNOWN');
  });

  test('device code round-trips through encode then decode', () => {
    const info = { userCode: 'WXYZ-1234', verificationUri: 'https://github.com/login/device' };
    expect(codec.decode(codec.encodeShowDeviceCode(info))).toEqual({
      type: 'SHOW_DEVICE_CODE', userCode: 'WXYZ-1234', verificationUri: 'https://github.com/login/device',
    });
  });

  test('auth ok and auth error round-trip', () => {
    expect(codec.decode(codec.encodeAuthOk())).toEqual({ type: 'AUTH_OK' });
    expect(codec.decode(codec.encodeAuthError('denied'))).toEqual({ type: 'AUTH_ERROR', msg: 'denied' });
  });

  test('status round-trips', () => {
    expect(codec.decode(codec.encodeStatus('No repos'))).toEqual({ type: 'STATUS', msg: 'No repos' });
  });
});
