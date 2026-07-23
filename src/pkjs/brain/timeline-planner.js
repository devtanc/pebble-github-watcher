// Estimates when an in-progress build will finish, from the trailing average of
// recent run durations, and builds the timeline pin payload. Pure + testable;
// used to cover the case where GitHub's own completion signal is delayed.
'use strict';

// Average duration (seconds) of completed runs. runs: [{ startedAtMs, endedAtMs }].
function averageDurationS(runs) {
  var total = 0;
  var n = 0;
  for (var i = 0; i < runs.length; i++) {
    var d = runs[i].endedAtMs - runs[i].startedAtMs;
    if (d > 0) { total += d; n++; }
  }
  if (n === 0) return null;
  return Math.round(total / n / 1000);
}

// ETA (ms epoch) for an in-progress run. Returns null if it can't be estimated.
function estimateEtaMs(startedAtMs, avgDurationS) {
  if (avgDurationS === null || !startedAtMs) return null;
  return startedAtMs + avgDurationS * 1000;
}

// Build a timeline pin for the estimated completion.
function buildPin(pinId, label, etaMs) {
  return {
    id: pinId,
    time: new Date(etaMs).toISOString(),
    layout: {
      type: 'genericPin',
      title: label,
      subtitle: 'Build likely done',
      tinyIcon: 'system://images/SCHEDULED_EVENT',
    },
  };
}

module.exports = {
  averageDurationS: averageDurationS,
  estimateEtaMs: estimateEtaMs,
  buildPin: buildPin,
};
