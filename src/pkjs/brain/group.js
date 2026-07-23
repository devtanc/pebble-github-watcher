// Groups the flat board items by repo for the nested UI (repo -> items), and
// computes each repo's aggregate status (worst-first). Each child keeps its flat
// index so the watch can map actions/QR back to the original item.
'use strict';

var STATUS = require('./protocol').STATUS;

// Attention priority — a failing repo aggregates to FAILURE, etc.
var PRIORITY = {};
PRIORITY[STATUS.FAILURE] = 4;
PRIORITY[STATUS.IN_PROGRESS] = 3;
PRIORITY[STATUS.UNKNOWN] = 2;
PRIORITY[STATUS.STALE] = 1;
PRIORITY[STATUS.SUCCESS] = 0;

function aggregate(children) {
  var worst = STATUS.SUCCESS;
  var worstP = -1;
  for (var i = 0; i < children.length; i++) {
    var p = PRIORITY[children[i].status] || 0;
    if (p > worstP) { worstP = p; worst = children[i].status; }
  }
  return worst;
}

function groupByRepo(items) {
  var map = {};
  var order = [];
  items.forEach(function (it, idx) {
    var key = it.owner + '/' + it.repo;
    if (!map[key]) { map[key] = { name: key, status: STATUS.SUCCESS, children: [] }; order.push(key); }
    map[key].children.push({ flatIdx: idx, title: it.title, status: it.status, ageS: it.ageS, action: it.action });
  });
  return order.map(function (key) {
    map[key].status = aggregate(map[key].children);
    return map[key];
  });
}

module.exports = { groupByRepo: groupByRepo, aggregate: aggregate };
