const navButtons = [...document.querySelectorAll('[data-screen]')];
const screens = [...document.querySelectorAll('[data-screen-panel]')];
const modeButtons = [...document.querySelectorAll('[data-mode]')];
const builderScreen = document.querySelector('[data-screen-panel="builder"]');
const toast = document.querySelector('#toast');
const dashboardGrid = document.querySelector('#dashboardGrid');
const titleInput = document.querySelector('#cardTitleInput');
let toastTimer;

function showToast(title, detail) {
  toast.querySelector('strong').textContent = title;
  toast.querySelector('small').textContent = detail;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function showScreen(name) {
  screens.forEach((screen) => screen.classList.toggle('is-active', screen.dataset.screenPanel === name));
  navButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.screen === name));
  history.replaceState(null, '', `#${name}`);
  document.title = `AxoBoard — ${name[0].toUpperCase()}${name.slice(1)}`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

navButtons.forEach((button) => button.addEventListener('click', () => showScreen(button.dataset.screen)));

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    modeButtons.forEach((item) => item.classList.toggle('is-active', item === button));
    builderScreen.classList.toggle('view-mode', button.dataset.mode === 'view');
    showToast(
      button.dataset.mode === 'view' ? 'Preview mode' : 'Edit mode',
      button.dataset.mode === 'view' ? 'Builder controls are hidden.' : 'Card controls are available.'
    );
  });
});

function selectCard(card) {
  document.querySelectorAll('.dashboard-card').forEach((item) => item.classList.toggle('is-selected', item === card));
  const name = card.dataset.cardName || 'Untitled card';
  titleInput.value = name;
}

document.querySelectorAll('.dashboard-card').forEach((card) => {
  card.addEventListener('click', () => selectCard(card));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectCard(card);
    }
  });
});

titleInput.addEventListener('input', () => {
  const selected = document.querySelector('.dashboard-card.is-selected');
  if (!selected) return;
  selected.dataset.cardName = titleInput.value || 'Untitled card';
  const eyebrow = selected.querySelector('.card-eyebrow span');
  if (eyebrow) eyebrow.textContent = (titleInput.value || 'Untitled card').toUpperCase();
});

function createPlaceholderCard(type) {
  const card = document.createElement('article');
  card.className = 'dashboard-card metric-card is-selected';
  card.tabIndex = 0;
  card.dataset.cardName = `New ${type}`;
  card.innerHTML = `
    <div class="drag-handle">⠿</div>
    <button class="card-menu" type="button" aria-label="Card menu">•••</button>
    <div class="card-eyebrow"><span>NEW ${type.toUpperCase()}</span><i class="status-dot"></i></div>
    <strong class="metric-value">—</strong>
    <div class="metric-change neutral">Configure data <span>in the inspector</span></div>
    <div class="goal-track"><span style="width:12%"></span></div>
    <footer><span>No source selected</span><button type="button">Definition</button></footer>`;
  document.querySelectorAll('.dashboard-card').forEach((item) => item.classList.remove('is-selected'));
  dashboardGrid.insertBefore(card, document.querySelector('.add-zone'));
  card.addEventListener('click', () => selectCard(card));
  titleInput.value = card.dataset.cardName;
  card.focus();
  showToast(`${type} card added`, 'Choose a certified dataset and metric to continue.');
}

document.querySelectorAll('[data-card-type]').forEach((button) => {
  button.addEventListener('click', () => createPlaceholderCard(button.dataset.cardType));
});

document.querySelector('#canvasAddButton').addEventListener('click', () => {
  const palette = document.querySelector('.card-palette');
  palette.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('Choose a card type', 'The card library is open on the left.');
});

document.querySelector('#publishButton').addEventListener('click', (event) => {
  event.currentTarget.textContent = 'Published';
  document.querySelector('.draft-badge').textContent = 'Live';
  showToast('Dashboard published', 'Version 12 is now live for viewers.');
  window.setTimeout(() => { event.currentTarget.textContent = 'Publish v13'; }, 1800);
});

document.querySelectorAll('.filter-row button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter-row button').forEach((item) => item.classList.toggle('is-active', item === button));
  });
});

const initialScreen = location.hash.slice(1);
if (screens.some((screen) => screen.dataset.screenPanel === initialScreen)) showScreen(initialScreen);
