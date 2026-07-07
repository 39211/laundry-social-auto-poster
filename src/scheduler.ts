import { isMain } from "./cli";
import type { SlotSchedule } from "./types";

export const DAILY_SCHEDULE: SlotSchedule[] = [
  { slot: 1, time: "11:30", category: "知識文" },
  { slot: 2, time: "19:30", category: "情境文" }
];

export function getZonedDateParts(now: Date, timezone = "Asia/Taipei"): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);

  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    time: `${lookup.hour}:${lookup.minute}`
  };
}

function minutesOfDay(time: string): number {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Invalid time: ${time}`);
  }
  return hour * 60 + minute;
}

export function findSlotByNumber(slot: number): SlotSchedule {
  const schedule = DAILY_SCHEDULE.find((item) => item.slot === slot);
  if (!schedule) throw new Error(`Unknown slot: ${slot}`);
  return schedule;
}

export function resolveCurrentSlot(
  now = new Date(),
  timezone = "Asia/Taipei",
  windowMinutes = 29
): SlotSchedule | undefined {
  const { time } = getZonedDateParts(now, timezone);
  const current = minutesOfDay(time);

  return DAILY_SCHEDULE.find((item) => {
    const scheduled = minutesOfDay(item.time);
    const delta = current - scheduled;
    return delta >= 0 && delta <= windowMinutes;
  });
}

if (isMain(import.meta.url)) {
  console.log(JSON.stringify(DAILY_SCHEDULE, null, 2));
}
