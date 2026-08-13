const currentView = location.pathname === '/signup' ? 'signup' : 'login';
document.title = currentView === 'signup' ? 'Start your free trial — AxoBoard' : 'Log in — AxoBoard';
document.body.dataset.auth = currentView;
document.querySelectorAll('[data-year]').forEach((element) => { element.textContent = String(new Date().getFullYear()); });

document.querySelectorAll('[data-toggle-password]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = button.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Hide' : 'Show';
    button.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} password`);
  });
});

function showAlert(form, message) {
  const alert = form.querySelector('.form-alert');
  alert.textContent = message;
  alert.hidden = !message;
  if (message) alert.focus?.();
}

function setLoading(form, loading) {
  const submit = form.querySelector('button[type="submit"]');
  if (!submit) return;
  submit.disabled = loading;
  submit.classList.toggle('is-loading', loading);
}

function validFields(container) {
  const fields = [...container.querySelectorAll('input, select')];
  for (const field of fields) {
    if (field.name === 'password') {
      const validPassword = field.value.length >= 10 && /[A-Za-z]/.test(field.value) && /\d/.test(field.value);
      field.setCustomValidity(validPassword ? '' : 'Use at least 10 characters with a letter and number.');
    }
    if (!field.reportValidity()) return false;
  }
  return true;
}

const signupForm = document.getElementById('signupForm');
let signupStep = 1;

function setSignupStep(step) {
  signupStep = step;
  signupForm?.querySelectorAll('.signup-step').forEach((panel) => panel.classList.toggle('is-active', Number(panel.dataset.step) === step));
  document.querySelectorAll('[data-progress]').forEach((item) => {
    const itemStep = Number(item.dataset.progress);
    item.classList.toggle('is-active', itemStep === step);
    item.classList.toggle('is-complete', itemStep < step);
  });
  if (step === 3) document.querySelector('[data-workspace-preview]').textContent = signupForm.elements.workspaceName.value || 'New workspace';
  signupForm?.querySelector('.signup-step.is-active input, .signup-step.is-active select')?.focus();
  showAlert(signupForm, '');
}

signupForm?.querySelectorAll('[data-next-step]').forEach((button) => {
  button.addEventListener('click', () => {
    const panel = signupForm.querySelector(`[data-step="${signupStep}"]`);
    if (validFields(panel)) setSignupStep(Number(button.dataset.nextStep));
  });
});
signupForm?.querySelectorAll('[data-previous-step]').forEach((button) => button.addEventListener('click', () => setSignupStep(Number(button.dataset.previousStep))));

signupForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!validFields(signupForm.querySelector('[data-step="3"]'))) return;
  setLoading(signupForm, true);
  showAlert(signupForm, '');
  const data = new FormData(signupForm);
  const payload = Object.fromEntries(data.entries());
  payload.acceptTerms = data.get('acceptTerms') === 'on';
  try {
    const response = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not create your workspace.');
    location.assign(result.redirect || '/app');
  } catch (error) {
    showAlert(signupForm, error.message);
    setLoading(signupForm, false);
  }
});

const loginForm = document.getElementById('loginForm');
loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!validFields(loginForm)) return;
  setLoading(loginForm, true);
  showAlert(loginForm, '');
  try {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(Object.fromEntries(new FormData(loginForm).entries())) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not log in.');
    location.assign(result.redirect || '/app');
  } catch (error) {
    showAlert(loginForm, error.message);
    setLoading(loginForm, false);
  }
});

document.querySelector('[data-forgot]')?.addEventListener('click', () => showAlert(loginForm, 'Password reset is not available in this release. Contact support@axoboard.io for account recovery.'));

fetch('/api/auth/session', { credentials: 'same-origin' }).then((response) => response.ok ? response.json() : null).then((session) => {
  if (session?.authenticated) location.replace('/app');
}).catch(() => {});
