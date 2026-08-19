import { REEL_CONCEPTS, REEL_SCHEDULE, loadExtensions } from "../src/reelConcepts";

const beforeConcepts = REEL_CONCEPTS.length;
const beforeSched = REEL_SCHEDULE.length;
const report = loadExtensions();
const afterSched = REEL_SCHEDULE.length;

const dates = REEL_SCHEDULE.map((row) => row.date);
const consecutiveFrom815 = dates.filter((d) => d >= "2026-08-15");
let dayByDay = true;
for (let i = 1; i < consecutiveFrom815.length; i += 1) {
  const prev = Date.parse(`${consecutiveFrom815[i - 1]}T00:00:00Z`);
  const cur = Date.parse(`${consecutiveFrom815[i]}T00:00:00Z`);
  if (cur - prev !== 86_400_000) dayByDay = false;
}

const types = REEL_SCHEDULE.map((row) => {
  const concept = REEL_CONCEPTS.find((c) => c.id === row.conceptId);
  return { date: row.date, id: row.conceptId, object_type: concept?.object_type };
});
let adjacentOk = true;
for (let i = 1; i < types.length; i += 1) {
  if (types[i]?.object_type && types[i]?.object_type === types[i - 1]?.object_type) {
    adjacentOk = false;
  }
}

const payload = {
  accepted_concepts: report.accepted_concepts.length,
  accepted_dates: report.accepted_dates.length,
  rejected: report.rejected.length,
  schedule_before: beforeSched,
  schedule_after: afterSched,
  concepts_before: beforeConcepts,
  concepts_after: REEL_CONCEPTS.length,
  extension_span: [consecutiveFrom815[0], consecutiveFrom815.at(-1)],
  extension_count: consecutiveFrom815.length,
  day_by_day_from_0815: dayByDay,
  adjacent_object_type_ok: adjacentOk,
  rejected_sample: report.rejected.slice(0, 8)
};

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
