import assert from 'node:assert/strict';
import { calculateGoalIntelligence } from '../lib/engagement-core.mjs';

const monthly = calculateGoalIntelligence({
  actualValue: 82400,
  targetValue: 100000,
  direction: 'higher_is_better',
  periodGranularity: 'month',
  calendarType: 'weekdays',
  timezone: 'America/Denver',
  asOf: new Date('2026-08-17T18:00:00.000Z')
});
assert.equal(monthly.periodStart, '2026-08-01');
assert.equal(monthly.periodEnd, '2026-08-31');
assert.ok(Math.abs(monthly.attainmentPercent - 82.4) < 1e-9);
assert.deepEqual(monthly.crossedMilestones, [25, 50, 75]);
assert.equal(monthly.nextMilestone, 90);
assert.ok(monthly.remainingDays > 0);
assert.ok(monthly.requiredPerDay > 0);

const complete = calculateGoalIntelligence({
  actualValue: 120,
  targetValue: 100,
  periodGranularity: 'week',
  calendarType: 'calendar_days',
  timezone: 'UTC',
  asOf: '2026-08-17T12:00:00.000Z'
});
assert.equal(complete.status, 'complete');
assert.equal(complete.requiredPerDay, 0);
assert.deepEqual(complete.crossedMilestones, [25, 50, 75, 90, 100]);

const lowerIsBetter = calculateGoalIntelligence({
  actualValue: 8,
  targetValue: 10,
  direction: 'lower_is_better',
  periodGranularity: 'day',
  calendarType: 'calendar_days',
  timezone: 'America/New_York',
  asOf: '2026-11-01T06:30:00.000Z'
});
assert.equal(lowerIsBetter.status, 'complete');
assert.deepEqual(lowerIsBetter.crossedMilestones, [], 'lower-is-better goals do not emit cumulative milestones');
assert.throws(() => calculateGoalIntelligence({ actualValue: 1, targetValue: 0 }), /cannot be zero/);
assert.throws(() => calculateGoalIntelligence({ actualValue: 1, targetValue: 2, timezone: 'Mars/Olympus' }), /Timezone/);

console.log('AxoBoard engagement core test passed: calendar-aware pace, projections, direction, and milestones.');
