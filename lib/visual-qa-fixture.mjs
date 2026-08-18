const visualQaTypes = [
  'scorecard',
  'goal_pace',
  'gauge',
  'rep_cards',
  'leaderboard',
  'trend',
  'category_bar',
  'funnel',
  'pipeline',
  'activity_feed',
  'heatmap',
  'table'
];

const edgeCases = ['flat', 'declining', 'negative', 'outlier', 'comparison', 'long-label', 'stale', 'empty'];
const workspaceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const processVisualQaEpoch = new Date();

export function visualQaNow(env = {}) {
  const configured = String(env.AXOBOARD_VISUAL_QA_FROZEN_AT || '').trim();
  if (!configured) return new Date(processVisualQaEpoch);
  const parsed = new Date(configured);
  if (Number.isNaN(parsed.getTime())) throw new TypeError('AXOBOARD_VISUAL_QA_FROZEN_AT must be a valid ISO timestamp.');
  return parsed;
}

function isoOffset(now, offsetMs = 0) {
  return new Date(now.getTime() + offsetMs).toISOString();
}

function paired(kind, labels, values, options = {}) {
  return {
    kind,
    orientation: 'columns',
    headers: { label: options.labelHeader || 'Label', value: options.valueHeader || 'Value' },
    ...(options.comparisonHeader ? { comparisonHeaders: { label: options.labelHeader || 'Label', value: options.comparisonHeader } } : {}),
    items: labels.map((label, index) => ({
      label,
      value: values[index],
      comparisonValue: options.comparisonValues?.[index] ?? null,
      ...(options.goals ? { goalValue: options.goals[index] } : {})
    }))
  };
}

function baseCard({ id, order, name, displayType, now, group = 'core', cases = [], ...card }) {
  const fetchedAt = card.fetchedAt || isoOffset(now, -2 * 60_000);
  return {
    id: `visual-qa-${id}`,
    name: `${group === 'core' ? `Core ${String(order).padStart(2, '0')}` : `Edge ${String(order).padStart(2, '0')}`} · ${name}`,
    displayType,
    displayFormat: card.displayFormat || 'number',
    periodGranularity: card.periodGranularity || null,
    displayPayload: card.displayPayload ?? null,
    goalDirection: card.goalDirection || 'higher_is_better',
    goalCalendarType: card.goalCalendarType || 'weekdays',
    goalTimezone: 'America/Denver',
    goalValue: card.goalValue ?? null,
    refreshSeconds: 300,
    staleAfterSeconds: 900,
    status: card.status || 'active',
    value: card.value ?? 0,
    comparisonValue: card.comparisonValue ?? null,
    comparisonDelta: card.comparisonDelta ?? null,
    sourceRowCount: card.sourceRowCount ?? 1,
    fetchedAt,
    lastSyncAt: fetchedAt,
    nextSyncAt: null,
    metricId: null,
    certification: null,
    goal: null,
    intelligence: card.intelligence || null,
    spreadsheetId: 'axoboard_visual_qa_fixture',
    spreadsheetTitle: 'AxoBoard Visual QA Fixtures',
    sheetId: order,
    sheetTitle: group === 'core' ? 'Canonical cards' : 'Edge cases',
    range: card.range || `A${order}:F${order + 5}`,
    sourceRange: `Synthetic QA fixture · ${group === 'core' ? 'canonical' : 'edge'} ${String(order).padStart(2, '0')}`,
    comparisonSourceRange: card.comparisonSourceRange || null,
    aggregation: card.aggregation || (['scorecard', 'goal_pace', 'gauge'].includes(displayType) ? 'single_value' : 'sum'),
    includeHeaders: true,
    qa: { synthetic: true, readOnly: true, group, order, cases }
  };
}

export function createVisualQaKpis({ now = new Date() } = {}) {
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) throw new TypeError('Visual QA time must be valid.');
  const cards = [
    baseCard({
      id: 'core-scorecard', order: 1, name: 'Rep scorecard', displayType: 'scorecard', now: current,
      value: 90, goalValue: 100,
      displayPayload: {
        kind: 'scorecard', layout: 'rep_metric_goal',
        rep: { label: 'Representative', value: 'Ava Chen' },
        metric: { label: 'Qualified conversations', value: 90 },
        goal: { label: 'Monthly goal', value: 100 }
      }
    }),
    baseCard({
      id: 'core-goal-pace', order: 2, name: 'Revenue pace', displayType: 'goal_pace', now: current,
      displayFormat: 'currency', periodGranularity: 'month', value: 82_400, goalValue: 100_000,
      displayPayload: { kind: 'goal_pace', headers: { value: 'Revenue', comparison: null } },
      intelligence: { projectedFinish: 104_200, requiredPerDay: 1_760, status: 'on_track' }
    }),
    baseCard({
      id: 'core-gauge', order: 3, name: 'Quality score', displayType: 'gauge', now: current,
      displayFormat: 'percentage', value: 42, goalValue: 100,
      displayPayload: { kind: 'gauge', headers: { value: 'Quality score', comparison: null } }
    }),
    baseCard({
      id: 'core-rep-cards', order: 4, name: 'Rep performance', displayType: 'rep_cards', now: current,
      periodGranularity: 'month', value: 160,
      displayPayload: paired('rep_cards', ['Ava Chen', 'Ben Ortiz'], [90, 70], {
        labelHeader: 'Representative', valueHeader: 'Qualified conversations', goals: [100, 80]
      })
    }),
    baseCard({
      id: 'core-leaderboard', order: 5, name: 'Closed revenue leaderboard', displayType: 'leaderboard', now: current,
      value: 240,
      displayPayload: paired('leaderboard', ['Ben Ortiz', 'Ava Chen', 'Chloe Martin'], [70, 90, 80], {
        labelHeader: 'Representative', valueHeader: 'Closed deals'
      })
    }),
    baseCard({
      id: 'core-trend', order: 6, name: 'Weekly conversion trend', displayType: 'trend', now: current,
      displayFormat: 'percentage', value: 187,
      displayPayload: paired('trend', ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6'], [22, 27, 25, 31, 38, 44], {
        labelHeader: 'Week', valueHeader: 'Conversion rate'
      })
    }),
    baseCard({
      id: 'core-category-bar', order: 7, name: 'Revenue by channel', displayType: 'category_bar', now: current,
      displayFormat: 'currency', value: 191_000,
      displayPayload: paired('category_bar', ['Inbound', 'Partner', 'Outbound', 'Referral'], [72_000, 48_000, 39_000, 32_000], {
        labelHeader: 'Channel', valueHeader: 'Revenue'
      })
    }),
    baseCard({
      id: 'core-funnel', order: 8, name: 'Lead conversion funnel', displayType: 'funnel', now: current,
      value: 205,
      displayPayload: paired('funnel', ['New leads', 'Qualified', 'Proposal sent', 'Closed won'], [100, 65, 30, 10], {
        labelHeader: 'Stage', valueHeader: 'Records'
      })
    }),
    baseCard({
      id: 'core-pipeline', order: 9, name: 'Pipeline by stage', displayType: 'pipeline', now: current,
      displayFormat: 'currency', value: 1_115_000,
      displayPayload: paired('pipeline', ['Discovery', 'Solution fit', 'Proposal', 'Legal review', 'Committed'], [410_000, 320_000, 210_000, 110_000, 65_000], {
        labelHeader: 'Stage', valueHeader: 'Open value'
      })
    }),
    baseCard({
      id: 'core-activity-feed', order: 10, name: 'Latest activity', displayType: 'activity_feed', now: current,
      value: 4, sourceRowCount: 4,
      displayPayload: {
        kind: 'activity_feed', columns: ['Time', 'Event', 'Detail', 'Value'],
        entries: [
          { timestamp: '9:42 AM', label: 'Closed won', detail: 'North Ridge expansion', value: '$18,420' },
          { timestamp: '9:16 AM', label: 'Proposal sent', detail: 'Westline Foods', value: '$8,900' },
          { timestamp: '8:54 AM', label: 'No-show count', detail: 'Current morning block', value: 0 },
          { timestamp: '8:31 AM', label: 'Qualified lead', detail: 'Referral channel', value: '1' }
        ]
      }
    }),
    baseCard({
      id: 'core-heatmap', order: 11, name: 'Activity by rep and day', displayType: 'heatmap', now: current,
      value: 75,
      displayPayload: {
        kind: 'heatmap', cornerLabel: 'Rep / Day',
        xLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        yLabels: ['Avery', 'Ben', 'Chloe'],
        cells: [[3, 5, 4, 8, 7], [2, 4, 6, 5, 9], [1, 3, 7, 6, 5]], min: 1, max: 9
      }
    }),
    baseCard({
      id: 'core-table', order: 12, name: 'Detailed pipeline table', displayType: 'table', now: current,
      displayFormat: 'currency', value: 529_500, sourceRowCount: 12,
      displayPayload: {
        kind: 'table', columns: ['Owner', 'Account', 'Stage', 'Region', 'Age', 'Value'],
        rows: Array.from({ length: 12 }, (_, index) => [
          ['Ava', 'Ben', 'Chloe', 'Devon'][index % 4],
          index === 5 ? 'Northern Industrial Supply and Multi-Region Distribution Cooperative' : `Account ${String(index + 1).padStart(2, '0')}`,
          ['Discovery', 'Proposal', 'Legal review'][index % 3],
          ['West', 'Central', 'East'][index % 3],
          `${index + 2} days`,
          `$${(12_500 + index * 5_750).toLocaleString('en-US')}`
        ])
      }
    }),
    baseCard({
      id: 'edge-flat', order: 13, name: 'Flat trend', displayType: 'trend', now: current, group: 'edge', cases: ['flat'],
      value: 240,
      displayPayload: paired('trend', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], [40, 40, 40, 40, 40, 40], {
        labelHeader: 'Day', valueHeader: 'Completed calls'
      })
    }),
    baseCard({
      id: 'edge-declining', order: 14, name: 'Declining funnel', displayType: 'funnel', now: current, group: 'edge', cases: ['declining'],
      value: 242,
      displayPayload: paired('funnel', ['Entered', 'Qualified', 'Evaluated', 'Converted'], [100, 72, 46, 24], {
        labelHeader: 'Stage', valueHeader: 'Records'
      })
    }),
    baseCard({
      id: 'edge-negative', order: 15, name: 'Signed category values', displayType: 'category_bar', now: current, group: 'edge', cases: ['negative'],
      value: 25,
      displayPayload: paired('category_bar', ['Returns', 'Renewals', 'Expansion'], [-25, 10, 40], {
        labelHeader: 'Movement', valueHeader: 'Net change'
      })
    }),
    baseCard({
      id: 'edge-outlier', order: 16, name: 'Heatmap outlier', displayType: 'heatmap', now: current, group: 'edge', cases: ['outlier'],
      value: 1_035,
      displayPayload: {
        kind: 'heatmap', cornerLabel: 'Team / Slot', xLabels: ['8 AM', '10 AM', 'Noon', '2 PM'], yLabels: ['North', 'South', 'West'],
        cells: [[1, 2, 3, 4], [2, 3, 999, 4], [3, 4, 5, 5]], min: 1, max: 999
      }
    }),
    baseCard({
      id: 'edge-comparison', order: 17, name: 'Trend with comparison', displayType: 'trend', now: current, group: 'edge', cases: ['comparison'],
      value: 160, comparisonValue: 162, comparisonDelta: -2,
      comparisonSourceRange: 'Synthetic QA fixture · prior period',
      displayPayload: paired('trend', ['Week 1', 'Week 2', 'Week 3', 'Week 4'], [40, 40, 40, 40], {
        labelHeader: 'Week', valueHeader: 'Current period', comparisonHeader: 'Prior period',
        comparisonValues: [45, 42, 39, 36]
      })
    }),
    baseCard({
      id: 'edge-long-label', order: 18, name: 'Long label handling', displayType: 'pipeline', now: current, group: 'edge', cases: ['long-label'],
      displayFormat: 'currency', value: 209_000,
      displayPayload: paired('pipeline', [
        'New',
        'Discovery call completed and awaiting multi-department stakeholder alignment before final executive review',
        'Technical validation',
        'Contract review'
      ], [72_000, 61_000, 49_000, 27_000], { labelHeader: 'Stage', valueHeader: 'Open value' })
    }),
    baseCard({
      id: 'edge-stale', order: 19, name: 'Stale metric', displayType: 'scorecard', now: current, group: 'edge', cases: ['stale'],
      value: 84, status: 'degraded', fetchedAt: isoOffset(current, -49 * 60 * 60_000),
      displayPayload: { kind: 'scorecard', headers: { value: 'Records processed', comparison: null } }
    }),
    baseCard({
      id: 'edge-empty', order: 20, name: 'Empty activity state', displayType: 'activity_feed', now: current, group: 'edge', cases: ['empty'],
      value: 0, sourceRowCount: 0,
      displayPayload: { kind: 'activity_feed', columns: ['Time', 'Event', 'Detail', 'Value'], entries: [] }
    })
  ];
  return cards;
}

export function visualQaAccess(env = {}, session = {}) {
  const enabled = String(env.AXOBOARD_VISUAL_QA_ENABLED || '').toLowerCase() === 'true';
  const workspaceId = String(env.AXOBOARD_VISUAL_QA_WORKSPACE_ID || '').trim();
  const workspaceName = String(env.AXOBOARD_VISUAL_QA_WORKSPACE_NAME || '').trim();
  const configured = enabled && workspaceIdPattern.test(workspaceId) && workspaceName.length >= 2;
  const allowed = configured
    && String(session.workspace_id || '') === workspaceId
    && String(session.workspace_name || '') === workspaceName
    && ['owner', 'admin', 'editor'].includes(String(session.role || ''));
  return { enabled, configured, allowed };
}

export function createVisualQaBoard({ workspaceId, workspaceName, brand = null, now = new Date() } = {}) {
  const kpis = createVisualQaKpis({ now });
  const tokens = brand?.tokens || {
    primary: '#E96F98', secondary: '#43BDE8', success: '#6DDB65',
    background: '#FFF9FB', text: '#35233A', logoMode: 'initial', motion: 'system', sound: 'system'
  };
  return {
    workspace: { id: workspaceId, name: workspaceName },
    brand: {
      id: brand?.id || 'visual-qa-brand', version: Number(brand?.version || 1),
      name: brand?.name || workspaceName || 'Visual QA', tokens,
      publishedAt: brand?.published_at || brand?.publishedAt || null
    },
    dashboard: {
      layout: { preset: 'balanced', showTrend: false, showActionCenter: false, kpiOrder: kpis.map((kpi) => kpi.id) },
      updatedAt: null
    },
    kpis,
    visualQa: {
      active: true, synthetic: true, readOnly: true, version: 1,
      canonicalTypes: [...visualQaTypes], edgeCases: [...edgeCases],
      surfaces: ['builder', 'dashboard', 'tv-preview', 'paired-tv', 'celebration']
    }
  };
}

export const visualQaFixtureContract = Object.freeze({
  canonicalTypes: [...visualQaTypes],
  edgeCases: [...edgeCases],
  cardCount: visualQaTypes.length + edgeCases.length
});
