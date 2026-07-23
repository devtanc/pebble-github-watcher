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
      idx: 1, repoIdx: 2, label: 'CI', status: STATUS.FAILURE, ageS: 120, action: 1, num: 0,
      branch: 'main', sha: '7363432', durationS: 75,
    });
    expect(wire).toEqual({
      [KEY.MSG_TYPE]: MSG_TYPE.BOARD_ITEM,
      [KEY.IDX]: 1,
      [KEY.REPO_IDX]: 2,
      [KEY.LABEL]: 'CI',
      [KEY.STATUS]: STATUS.FAILURE,
      [KEY.AGE_S]: 120,
      [KEY.ACTION]: 1,
      [KEY.NUM]: 0,
      [KEY.BRANCH]: 'main',
      [KEY.SHA]: '7363432',
      [KEY.DUR]: 75,
    });
  });

  test('a board item round-trips through encode then decode', () => {
    const item = {
      idx: 0, repoIdx: 1, label: 'fix', status: STATUS.SUCCESS, ageS: 45, action: 2, num: 7,
      branch: 'main', sha: 'abc1234', durationS: 30,
    };
    expect(codec.decode(codec.encodeBoardItem(item))).toEqual({ type: 'BOARD_ITEM', ...item });
  });

  test('a board repo round-trips', () => {
    expect(codec.decode(codec.encodeBoardRepo({ repoIdx: 0, count: 2, name: 'o/r', status: STATUS.FAILURE })))
      .toEqual({ type: 'BOARD_REPO', repoIdx: 0, count: 2, name: 'o/r', status: STATUS.FAILURE });
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

  test('device code can carry a QR', () => {
    const wire = codec.encodeShowDeviceCode(
      { userCode: 'X', verificationUri: 'u' }, { size: 29, bytes: [1, 2] });
    expect(wire[KEY.SIZE]).toBe(29);
    expect(wire[KEY.DATA]).toEqual([1, 2]);
  });

  test('auth ok and auth error round-trip', () => {
    expect(codec.decode(codec.encodeAuthOk())).toEqual({ type: 'AUTH_OK' });
    expect(codec.decode(codec.encodeAuthError('denied'))).toEqual({ type: 'AUTH_ERROR', msg: 'denied' });
  });

  test('status round-trips', () => {
    expect(codec.decode(codec.encodeStatus('No repos'))).toEqual({ type: 'STATUS', msg: 'No repos' });
  });

  test('request-qr round-trips', () => {
    expect(codec.decode(codec.encodeRequestQr(2))).toEqual({ type: 'REQUEST_QR', idx: 2 });
  });

  test('qr-data round-trips', () => {
    expect(codec.decode(codec.encodeQrData({ size: 29, bytes: [1, 2, 3] })))
      .toEqual({ type: 'QR_DATA', size: 29, data: [1, 2, 3] });
  });

  test('glance round-trips', () => {
    expect(codec.decode(codec.encodeGlance('All 2 green'))).toEqual({ type: 'GLANCE', msg: 'All 2 green' });
  });

  test('action-rerun decodes with its row index', () => {
    expect(codec.decode({ [KEY.MSG_TYPE]: MSG_TYPE.ACTION_RERUN, [KEY.IDX]: 1 }))
      .toEqual({ type: 'ACTION_RERUN', idx: 1 });
  });

  test('action-result round-trips ok/msg', () => {
    expect(codec.decode(codec.encodeActionResult(true, 'Re-run started')))
      .toEqual({ type: 'ACTION_RESULT', ok: true, msg: 'Re-run started' });
    expect(codec.decode(codec.encodeActionResult(false, 'No failed jobs')))
      .toEqual({ type: 'ACTION_RESULT', ok: false, msg: 'No failed jobs' });
  });

  test('wakeup round-trips its epoch time', () => {
    expect(codec.decode(codec.encodeWakeup(1800000000))).toEqual({ type: 'WAKEUP', time: 1800000000 });
  });

  test('action-merge decodes with its row index', () => {
    expect(codec.decode(codec.encodeActionMerge(3))).toEqual({ type: 'ACTION_MERGE', idx: 3 });
  });
});
