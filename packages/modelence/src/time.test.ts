import { time } from './time';

describe('time utilities', () => {
  describe('seconds', () => {
    test('should convert seconds to milliseconds', () => {
      expect(time.seconds(1)).toBe(1000);
      expect(time.seconds(5)).toBe(5000);
      expect(time.seconds(0)).toBe(0);
    });
  });

  describe('minutes', () => {
    test('should convert minutes to milliseconds', () => {
      expect(time.minutes(1)).toBe(60000);
      expect(time.minutes(5)).toBe(300000);
      expect(time.minutes(0)).toBe(0);
    });
  });

  describe('hours', () => {
    test('should convert hours to milliseconds', () => {
      expect(time.hours(1)).toBe(3600000);
      expect(time.hours(2)).toBe(7200000);
      expect(time.hours(0)).toBe(0);
    });
  });

  describe('days', () => {
    test('should convert days to milliseconds', () => {
      expect(time.days(1)).toBe(86400000);
      expect(time.days(7)).toBe(604800000);
      expect(time.days(0)).toBe(0);
    });
  });

  describe('weeks', () => {
    test('should convert weeks to milliseconds', () => {
      expect(time.weeks(1)).toBe(604800000);
      expect(time.weeks(2)).toBe(1209600000);
      expect(time.weeks(0)).toBe(0);
    });
  });
});
