const { groupByRepo, aggregate } = require('../../src/pkjs/brain/group');
const { STATUS } = require('../../src/pkjs/brain/protocol');

const item = (owner, repo, title, status) => ({ owner, repo, title, status, ageS: 1, action: 0 });

describe('group', () => {
  test('aggregate surfaces the worst status', () => {
    expect(aggregate([{ status: STATUS.SUCCESS }, { status: STATUS.FAILURE }])).toBe(STATUS.FAILURE);
    expect(aggregate([{ status: STATUS.SUCCESS }, { status: STATUS.IN_PROGRESS }])).toBe(STATUS.IN_PROGRESS);
    expect(aggregate([{ status: STATUS.SUCCESS }])).toBe(STATUS.SUCCESS);
    expect(aggregate([])).toBe(STATUS.SUCCESS);
  });

  test('groups items by repo, preserving order and flat indices', () => {
    const items = [
      item('o', 'a', 'CI', STATUS.SUCCESS),
      item('o', 'a', '#1 x', STATUS.FAILURE),
      item('o', 'b', 'CI', STATUS.SUCCESS),
    ];
    const groups = groupByRepo(items);
    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('o/a');
    expect(groups[0].status).toBe(STATUS.FAILURE); // worst of a's children
    expect(groups[0].children.map((c) => c.flatIdx)).toEqual([0, 1]);
    expect(groups[1].name).toBe('o/b');
    expect(groups[1].children[0].flatIdx).toBe(2);
  });
});
