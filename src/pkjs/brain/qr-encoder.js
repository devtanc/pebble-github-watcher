// Encodes a string into a QR code and packs the module grid into bytes for the
// watch to draw. Wire format: 1 bit per module, row-major, MSB-first
// (bit index = row*size + col). Mirrored by src/c/lib/qr_unpack.c.
'use strict';

var qrcode = require('qrcode-generator');

function pack(matrix) {
  var size = matrix.length;
  var total = size * size;
  var bytes = [];
  var n = Math.ceil(total / 8);
  for (var b = 0; b < n; b++) bytes.push(0);
  for (var i = 0; i < total; i++) {
    var r = Math.floor(i / size);
    var c = i % size;
    if (matrix[r][c]) {
      bytes[i >> 3] |= (1 << (7 - (i & 7)));
    }
  }
  return bytes;
}

// encode(text) -> { size, bytes }. ecc defaults to 'M'. Version is auto-selected
// (smallest that fits), so size grows with the input length.
function encode(text, ecc) {
  var qr = qrcode(0, ecc || 'M');
  qr.addData(text);
  qr.make();
  var size = qr.getModuleCount();
  var matrix = [];
  for (var r = 0; r < size; r++) {
    var row = [];
    for (var c = 0; c < size; c++) row.push(qr.isDark(r, c));
    matrix.push(row);
  }
  return { size: size, bytes: pack(matrix) };
}

module.exports = { encode: encode, pack: pack };
