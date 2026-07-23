#include "unity.h"
#include "view_model.h"
#include "protocol.h"

void setUp(void) {}
void tearDown(void) {}

static void expect_age(uint32_t age, const char *expected) {
  char buf[8];
  vm_format_age(age, buf, sizeof(buf));
  TEST_ASSERT_EQUAL_STRING(expected, buf);
}

void test_age_seconds(void) {
  expect_age(0, "0s");
  expect_age(59, "59s");
}

void test_age_minutes(void) {
  expect_age(60, "1m");
  expect_age(3599, "59m");
}

void test_age_hours(void) {
  expect_age(3600, "1h");
  expect_age(86399, "23h");
}

void test_age_days(void) {
  expect_age(86400, "1d");
  expect_age(172800, "2d");
}

void test_status_glyphs(void) {
  TEST_ASSERT_EQUAL_STRING("OK", vm_status_glyph(STATUS_SUCCESS));
  TEST_ASSERT_EQUAL_STRING("X", vm_status_glyph(STATUS_FAILURE));
  TEST_ASSERT_EQUAL_STRING("~", vm_status_glyph(STATUS_IN_PROGRESS));
  TEST_ASSERT_EQUAL_STRING("-", vm_status_glyph(STATUS_STALE));
  TEST_ASSERT_EQUAL_STRING("?", vm_status_glyph(STATUS_UNKNOWN));
}

void test_status_words(void) {
  TEST_ASSERT_EQUAL_STRING("Passed", vm_status_word(STATUS_SUCCESS));
  TEST_ASSERT_EQUAL_STRING("Failing", vm_status_word(STATUS_FAILURE));
  TEST_ASSERT_EQUAL_STRING("Running", vm_status_word(STATUS_IN_PROGRESS));
  TEST_ASSERT_EQUAL_STRING("Unknown", vm_status_word(STATUS_UNKNOWN));
}

void test_dur(void) {
  char buf[16];
  vm_format_dur(45, buf, sizeof(buf));   TEST_ASSERT_EQUAL_STRING("45s", buf);
  vm_format_dur(75, buf, sizeof(buf));   TEST_ASSERT_EQUAL_STRING("1m 15s", buf);
  vm_format_dur(120, buf, sizeof(buf));  TEST_ASSERT_EQUAL_STRING("2m", buf);
  vm_format_dur(3900, buf, sizeof(buf)); TEST_ASSERT_EQUAL_STRING("1h 5m", buf);
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_age_seconds);
  RUN_TEST(test_age_minutes);
  RUN_TEST(test_age_hours);
  RUN_TEST(test_age_days);
  RUN_TEST(test_status_glyphs);
  RUN_TEST(test_status_words);
  RUN_TEST(test_dur);
  return UNITY_END();
}
