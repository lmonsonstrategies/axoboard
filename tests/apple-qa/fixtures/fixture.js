const params = new URLSearchParams(location.search);
const state = params.get('state') || 'landing';
const requestedTheme = params.get('theme');
const theme = requestedTheme === 'dark' || requestedTheme === 'light'
  ? requestedTheme
  : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = theme;
document.body.dataset.state = state;

const content = {
  landing: {
    title: 'One trusted view of progress.',
    copy: 'A stable fixture proves that hard gates detect regressions without relying on customer data.',
    surface: '<article class="card"><small>MONTHLY REVENUE</small><strong>$184,200</strong><p>92% of a verified goal</p></article><article class="card"><small>PIPELINE HEALTH</small><strong>4.8×</strong><p>Updated from a trusted source</p></article><article class="card"><small>NEXT ACTION</small><strong>Review stalled deals</strong><a class="button" href="#action">Open action</a></article>'
  },
  auth: {
    title: 'Welcome back to AxoBoard.',
    copy: 'Authentication feedback remains clear, recoverable, and private.',
    surface: '<article class="card"><form><div class="alert" role="alert">Use a valid work email to continue.</div><label for="fixtureEmail">Work email<input id="fixtureEmail" name="email" type="email" autocomplete="email" value="name@example.com" /></label><button type="button">Continue securely</button></form></article><article class="card"><small>PRIVACY BOUNDARY</small><strong>No customer credentials</strong><p>This fixture never authenticates or sends data.</p></article><article class="card"><small>RECOVERY</small><strong>Need help?</strong><a class="button" href="#support">Open support options</a></article>'
  },
  'app-empty': {
    title: 'Build your first trusted dashboard.',
    copy: 'A useful empty state explains the outcome and offers one clear next step.',
    surface: '<article class="card"><small>EMPTY WORKSPACE</small><strong>No KPI cards yet</strong><p>Connect a source, then publish a focused scorecard.</p><button type="button">Create first KPI</button></article><article class="card"><small>START WITH</small><strong>One decision</strong><p>Choose the number your team should act on today.</p></article><article class="card"><small>GOVERNANCE</small><strong>Draft before publish</strong><p>Nothing becomes visible until it is reviewed.</p></article>'
  },
  'app-loading': {
    title: 'Refreshing verified metrics.',
    copy: 'Loading feedback preserves layout and announces progress without visual noise.',
    surface: '<div class="card" role="status" aria-live="polite" aria-busy="true"><small>LOADING DASHBOARD</small><strong>Refreshing trusted values</strong><div class="skeleton"></div><div class="skeleton"></div></div><article class="card"><small>LAST VERIFIED</small><strong>2 minutes ago</strong><p>Previous values remain labeled while data refreshes.</p></article><article class="card"><small>STATUS</small><strong>Source connected</strong><p>No action is required.</p></article>'
  },
  'app-error': {
    title: 'The dashboard needs attention.',
    copy: 'Error states explain impact, preserve trusted context, and provide recovery.',
    surface: '<article class="card"><div class="alert" role="alert"><strong>Metric refresh paused</strong><p>The source did not respond. Last verified values remain visible.</p></div><button type="button">Retry refresh</button></article><article class="card"><small>LAST VERIFIED</small><strong>9:42 AM</strong><p>Values are labeled stale, not silently replaced.</p></article><article class="card"><small>OWNER</small><strong>Workspace admin</strong><a class="button" href="#details">View diagnostic details</a></article>'
  },
  tv: {
    title: 'Team performance at a glance.',
    copy: 'Ten-foot typography, safe margins, and calm motion keep the shared display legible.',
    surface: '<article class="card"><small>NET SALES</small><strong>$184K</strong><p>92% to goal</p></article><article class="card"><small>DEALS WON</small><strong>38</strong><p>Six above pace</p></article><article class="card"><small>FRESHNESS</small><strong>Live</strong><p>Verified two minutes ago</p></article>'
  }
};

const selected = content[state] || content.landing;
document.querySelector('#pageTitle').textContent = selected.title;
document.querySelector('#pageCopy').textContent = selected.copy;
document.querySelector('#stateSurface').innerHTML = selected.surface;
const themeButton = document.querySelector('#themeButton');
themeButton.setAttribute('aria-pressed', String(theme === 'dark'));
themeButton.addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  themeButton.setAttribute('aria-pressed', String(nextTheme === 'dark'));
});
