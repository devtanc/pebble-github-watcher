#include "unity.h"
#include "qr_unpack.h"

void setUp(void) {}
void tearDown(void) {}

void test_qr_module_3x3(void) {
  // 1 0 1 / 0 1 0 / 1 0 1  packed = { 0xAA, 0x80 }
  // (identical fixture to the JS pack test — proves both sides agree).
  const uint8_t fix[] = { 0xAA, 0x80 };
  int expected[9] = { 1, 0, 1, 0, 1, 0, 1, 0, 1 };
  for (int r = 0; r < 3; r++) {
    for (int c = 0; c < 3; c++) {
      TEST_ASSERT_EQUAL_INT(expected[r * 3 + c], qr_module_at(fix, 3, r, c) ? 1 : 0);
    }
  }
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_qr_module_3x3);
  return UNITY_END();
}
