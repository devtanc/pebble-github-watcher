const { averageDurationS, estimateEtaMs, buildPin } = require('../../src/pkjs/brain/timeline-planner');

describe('timeline-planner', () => {
  test('averageDurationS averages completed runs, ignoring bad spans', () => {
    expect(averageDurationS([
      { startedAtMs: 0, endedAtMs: 120000 }, // 120s
      { startedAtMs: 1000, endedAtMs: 61000 }, // 60s
      { startedAtMs: 5, endedAtMs: 5 }, // zero -> ignored
    ])).toBe(90);
  });

  test('averageDurationS returns null with no usable runs', () => {
    expect(averageDurationS([])).toBeNull();
    expect(averageDurationS([{ startedAtMs: 10, endedAtMs: 5 }])).toBeNull();
  });

  test('estimateEtaMs adds the average duration to the start', () => {
    expect(estimateEtaMs(1_000_000, 90)).toBe(1_000_000 + 90000);
  });

  test('estimateEtaMs is null when it cannot estimate', () => {
    expect(estimateEtaMs(1_000_000, null)).toBeNull();
    expect(estimateEtaMs(0, 90)).toBeNull();
  });

  test('buildPin produces a timeline pin with an ISO time', () => {
    const eta = Date.parse('2026-07-22T00:05:00Z');
    expect(buildPin('run-42', 'dynamo-helper build', eta)).toEqual({
      id: 'run-42',
      time: '2026-07-22T00:05:00.000Z',
      layout: {
        type: 'genericPin',
        title: 'dynamo-helper build',
        subtitle: 'Build likely done',
        tinyIcon: 'system://images/SCHEDULED_EVENT',
      },
    });
  });
});
