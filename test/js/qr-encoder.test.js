const { encode, pack } = require('../../src/pkjs/brain/qr-encoder');
const qrcode = require('qrcode-generator');

describe('qr pack', () => {
  test('packs a 3x3 matrix row-major, MSB-first', () => {
    // 1 0 1 / 0 1 0 / 1 0 1  ->  bits 10101010 1  ->  0xAA 0x80
    // (This exact fixture is also asserted by the C qr_unpack Unity test.)
    expect(pack([[1, 0, 1], [0, 1, 0], [1, 0, 1]])).toEqual([0xAA, 0x80]);
  });
});

describe('qr encode', () => {
  const url = 'https://github.com/devtanc/dynamo-helper/actions/runs/123';

  test('size is odd (>=21) and byte length is consistent', () => {
    const { size, bytes } = encode(url);
    expect(size % 2).toBe(1);
    expect(size).toBeGreaterThanOrEqual(21);
    expect(bytes.length).toBe(Math.ceil((size * size) / 8));
  });

  test('packed bits reproduce the qrcode-generator grid exactly', () => {
    const { size, bytes } = encode(url);
    const ref = qrcode(0, 'M');
    ref.addData(url);
    ref.make();
    expect(ref.getModuleCount()).toBe(size);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const i = r * size + c;
        const bit = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
        expect(bit === 1).toBe(ref.isDark(r, c));
      }
    }
  });
});
