const secondMs = 1000;
const minuteMs = 60 * secondMs;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;
const weekMs = 7 * dayMs;

export const time = {
  seconds: (x: number) => x * secondMs,
  minutes: (x: number) => x * minuteMs,
  hours: (x: number) => x * hourMs,
  days: (x: number) => x * dayMs,
  weeks: (x: number) => x * weekMs,
};
