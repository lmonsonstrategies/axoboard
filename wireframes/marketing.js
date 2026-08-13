document.documentElement.classList.add('js');
const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('.site-nav');

menuToggle?.addEventListener('click', () => {
  const expanded = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!expanded));
  siteNav?.classList.toggle('is-open', !expanded);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || menuToggle?.getAttribute('aria-expanded') !== 'true') return;
  menuToggle.setAttribute('aria-expanded', 'false');
  siteNav?.classList.remove('is-open');
  menuToggle.focus();
});

document.querySelectorAll('[data-scroll]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const target = document.getElementById(link.dataset.scroll);
    if (!target) return;
    event.preventDefault();
    history.pushState({}, '', link.getAttribute('href'));
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    menuToggle?.setAttribute('aria-expanded', 'false');
    siteNav?.classList.remove('is-open');
  });
});

const routeTarget = { '/features': 'features', '/integrations': 'integrations', '/pricing': 'pricing', '/faq': 'faq' }[location.pathname];
if (routeTarget) requestAnimationFrame(() => document.getElementById(routeTarget)?.scrollIntoView());

const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 }) : null;

document.querySelectorAll('.reveal').forEach((element) => revealObserver ? revealObserver.observe(element) : element.classList.add('is-visible'));
document.querySelectorAll('[data-year]').forEach((element) => { element.textContent = String(new Date().getFullYear()); });

document.querySelectorAll('details').forEach((details) => {
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    document.querySelectorAll('details[open]').forEach((other) => { if (other !== details) other.open = false; });
  });
});

const integrationMarquee = document.querySelector('[data-integration-marquee]');
const tickerControl = document.querySelector('.ticker-control');
let tickerPaused = false;

function setTickerPaused(paused) {
  tickerPaused = paused;
  integrationMarquee?.classList.toggle('is-paused', paused);
  tickerControl?.setAttribute('aria-pressed', String(paused));
  tickerControl?.setAttribute('aria-label', `${paused ? 'Play' : 'Pause'} integration animation`);
  const hiddenLabel = tickerControl?.querySelector('.sr-only');
  const icon = tickerControl?.querySelector('[aria-hidden="true"]');
  if (hiddenLabel) hiddenLabel.textContent = `${paused ? 'Play' : 'Pause'} integration animation`;
  if (icon) icon.textContent = paused ? '▶' : 'Ⅱ';
}

tickerControl?.addEventListener('click', () => setTickerPaused(!tickerPaused));

if (integrationMarquee && 'IntersectionObserver' in window) {
  const tickerObserver = new IntersectionObserver(([entry]) => {
    integrationMarquee.classList.toggle('is-offscreen', !entry.isIntersecting);
  }, { threshold: 0.05 });
  tickerObserver.observe(integrationMarquee);
}

const mobileConversionCta = document.querySelector('.mobile-conversion-cta');
const heroConversionCta = document.querySelector('.hero-actions');
const pricingSection = document.querySelector('#pricing');
let heroConversionVisible = true;
let pricingVisible = false;

function updateMobileConversionCta() {
  mobileConversionCta?.classList.toggle('is-visible', !heroConversionVisible && !pricingVisible);
}

if (mobileConversionCta && heroConversionCta && 'IntersectionObserver' in window) {
  const conversionObserver = new IntersectionObserver(([entry]) => {
    heroConversionVisible = entry.isIntersecting;
    updateMobileConversionCta();
  }, { threshold: 0.1 });
  conversionObserver.observe(heroConversionCta);

  if (pricingSection) {
    const pricingObserver = new IntersectionObserver(([entry]) => {
      pricingVisible = entry.isIntersecting;
      updateMobileConversionCta();
    }, { threshold: 0.01 });
    pricingObserver.observe(pricingSection);
  }
}

fetch('/api/auth/session', { credentials: 'same-origin' }).then((response) => response.ok ? response.json() : null).then((session) => {
  if (!session?.authenticated) return;
  document.querySelectorAll('a[href="/login"]').forEach((link) => {
    link.textContent = session.canAccessApp ? 'Open workspace' : 'Complete purchase';
    link.href = session.canAccessApp ? '/app' : '/pricing?access=subscription_required';
  });
}).catch(() => {});
