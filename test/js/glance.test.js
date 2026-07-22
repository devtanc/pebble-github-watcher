const { summarize } = require('../../src/pkjs/brain/glance');
const { STATUS } = require('../../src/pkjs/brain/protocol');

const item = (label, status) => ({ label, status });

describe('glance summarize', () => {
  test('no items', () => {
    expect(summarize([])).toBe('No repos configured');
  });

  test('a single failure names the repo', () => {
    expect(summarize([item('api:main', STATUS.FAILURE)])).toBe('api:main failed');
  });

  test('multiple failures are counted', () => {
    expect(summarize([item('a', STATUS.FAILURE), item('b', STATUS.FAILURE)])).toBe('2 repos failing');
  });

  test('failure takes priority over running', () => {
    expect(summarize([item('a', STATUS.FAILURE), item('b', STATUS.IN_PROGRESS)])).toBe('a failed');
  });

  test('running when nothing failed', () => {
    expect(summarize([item('a', STATUS.SUCCESS), item('b', STATUS.IN_PROGRESS)])).toBe('1 running');
  });

  test('all green', () => {
    expect(summarize([item('a', STATUS.SUCCESS), item('b', STATUS.SUCCESS)])).toBe('All 2 green');
    expect(summarize([item('a', STATUS.SUCCESS)])).toBe('Green');
  });
});
