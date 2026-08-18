import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { calculateGoalIntelligence, recordSnapshotEngagement } from '../lib/engagement-core.mjs';

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

if (process.env.DATABASE_URL) {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false, max: 2 });
  const schema = await pool.query("SELECT to_regclass('public.goal_configs') AS goal_configs");
  if (schema.rows[0].goal_configs) {
    const workspaceId = randomUUID();
    const connectionId = randomUUID();
    const mappingId = randomUUID();
    try {
      await pool.query('INSERT INTO workspaces (id,name) VALUES ($1,$2)', [workspaceId, 'Goal retirement test']);
      const token = Buffer.from('00', 'hex');
      await pool.query(`INSERT INTO integration_connections
        (id,workspace_id,provider,external_account_id,external_account_email,token_ciphertext,token_iv,token_auth_tag)
        VALUES ($1,$2,'google_sheets',$3,$4,$5,$5,$5)`,
      [connectionId, workspaceId, `goal-retirement-${workspaceId}`, `goal-${workspaceId}@example.test`, token]);
      await pool.query(`INSERT INTO kpi_mappings
        (id,workspace_id,connection_id,name,provider,spreadsheet_id,spreadsheet_title,sheet_id,sheet_title,a1_range,
         aggregation,display_format,display_type,status,goal_source,goal_value)
        VALUES ($1,$2,$3,'Revenue','google_sheets',$4,'Goal Test',1,'Metrics','A1','single_value','number','scorecard','active','manual',100)`,
      [mappingId, workspaceId, connectionId, `sheet-${mappingId}`]);
      const firstSnapshot = randomUUID();
      await pool.query(`INSERT INTO metric_snapshots
        (id,workspace_id,mapping_id,value,goal_value,source_row_count,source_range,lineage_hash)
        VALUES ($1,$2,$3,50,100,1,'A1',$4)`, [firstSnapshot, workspaceId, mappingId, '1'.repeat(64)]);
      let mapping = (await pool.query('SELECT * FROM kpi_mappings WHERE workspace_id=$1 AND id=$2', [workspaceId, mappingId])).rows[0];
      let client = await pool.connect();
      try {
        await client.query('BEGIN');
        await recordSnapshotEngagement(client, { mapping, snapshotId: firstSnapshot, value: 50, goalValue: 100 });
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM goal_configs WHERE workspace_id=$1 AND status='active'", [workspaceId])).rows[0].count), 1);

      await pool.query('UPDATE kpi_mappings SET goal_value=NULL WHERE workspace_id=$1 AND id=$2', [workspaceId, mappingId]);
      const secondSnapshot = randomUUID();
      await pool.query(`INSERT INTO metric_snapshots
        (id,workspace_id,mapping_id,value,source_row_count,source_range,lineage_hash)
        VALUES ($1,$2,$3,60,1,'A1',$4)`, [secondSnapshot, workspaceId, mappingId, '2'.repeat(64)]);
      mapping = (await pool.query('SELECT * FROM kpi_mappings WHERE workspace_id=$1 AND id=$2', [workspaceId, mappingId])).rows[0];
      client = await pool.connect();
      let removed;
      try {
        await client.query('BEGIN');
        removed = await recordSnapshotEngagement(client, { mapping, snapshotId: secondSnapshot, value: 60, goalValue: null });
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      assert.equal(removed.goal, null);
      assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM goal_configs WHERE workspace_id=$1 AND status='active'", [workspaceId])).rows[0].count), 0,
        'clearing a KPI goal retires its previously active goal contract');
      assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM goal_configs WHERE workspace_id=$1 AND status='retired'", [workspaceId])).rows[0].count), 1,
        'retired goal history is preserved');
    } finally {
      await pool.query('DELETE FROM workspaces WHERE id=$1', [workspaceId]).catch(() => {});
    }
  }
  await pool.end();
}

console.log('AxoBoard engagement core test passed: calendar-aware pace, projections, direction, milestones, and goal retirement.');
