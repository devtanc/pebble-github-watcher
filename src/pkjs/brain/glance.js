// Summarizes the board into a one-line launcher subtitle (App Glance).
'use strict';

var STATUS = require('./protocol').STATUS;

function summarize(items) {
  if (!items || items.length === 0) return 'No repos configured';
  var failed = [];
  var running = 0;
  var green = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].status === STATUS.FAILURE) failed.push(items[i]);
    else if (items[i].status === STATUS.IN_PROGRESS) running++;
    else if (items[i].status === STATUS.SUCCESS) green++;
  }
  if (failed.length === 1) return failed[0].label + ' failed';
  if (failed.length > 1) return failed.length + ' repos failing';
  if (running > 0) return running + ' running';
  if (green === items.length) return items.length === 1 ? 'Green' : 'All ' + items.length + ' green';
  return items.length + ' repos';
}

module.exports = { summarize: summarize };
