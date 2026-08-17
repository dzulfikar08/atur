// The embeddable feedback widget, served verbatim at /widget.js.
//
// Deliberately framework-free (vanilla JS + Shadow DOM) so customers can drop a
// single <script> tag on any site with no build step or styling bleed. This
// module only exports the source STRING — the worker returns it as
// application/javascript (see routes/widget.ts).
//
// The string contains NO template literals and NO ${...} on purpose, so it can
// live inside this outer template literal without escaping headaches.

export const WIDGET_JS = `
(function () {
  if (window.__aturFeedbackWidget) return;
  window.__aturFeedbackWidget = true;

  var s = document.currentScript;
  if (!s) s = document.querySelector('script[data-atur-token]');
  if (!s) return;
  var token = s.getAttribute('data-atur-token');
  if (!token) { console.error('[atur] widget: missing data-atur-token'); return; }
  var posOverride = s.getAttribute('data-atur-position');

  var origin = 'https://app.diatur.com';
  try { origin = new URL(s.src).origin; } catch (e) {}
  var apiBase = origin + '/public/feedback/' + encodeURIComponent(token);
  var portalUrl = origin + '/feedback/' + encodeURIComponent(token) + '?embed=1';

  var pos = posOverride || 'bottom-right';
  var POS = {
    'bottom-right': { bottom: '20px', right: '20px' },
    'bottom-left':  { bottom: '20px', left: '20px' },
    'top-right':    { top: '20px', right: '20px' },
    'top-left':     { top: '20px', left: '20px' }
  };
  var p = POS[pos] || POS['bottom-right'];

  var host = document.createElement('div');
  host.setAttribute('data-atur-widget', '');
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483000; ' +
    'bottom:' + (p.bottom || 'auto') + '; top:' + (p.top || 'auto') + '; ' +
    'right:' + (p.right || 'auto') + '; left:' + (p.left || 'auto') + ';';
  document.body.appendChild(host);

  var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var brandColor = '#6366f1';
  var style = document.createElement('style');
  style.textContent =
    '.bubble{width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;' +
    'box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;' +
    'transition:transform .15s ease,opacity .2s ease;background:' + brandColor + ';}' +
    '.bubble:hover{transform:scale(1.06);}' +
    '.bubble svg{width:26px;height:26px;display:block;}' +
    '.pop{position:absolute;display:none;width:min(380px,92vw);height:min(560px,80vh);' +
    'border:none;border-radius:14px;overflow:hidden;background:#fff;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.3);}' +
    '.pop.open{display:block;}' +
    '.pop iframe{width:100%;height:100%;border:none;}';
  shadow.appendChild(style);

  var bubble = document.createElement('button');
  bubble.className = 'bubble';
  bubble.setAttribute('aria-label', 'Open feedback');
  bubble.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  shadow.appendChild(bubble);

  var pop = document.createElement('div');
  pop.className = 'pop';
  // Anchor the popover above/inside relative to the bubble corner.
  var anchor = { transform: '' };
  if (p.bottom) { pop.style.bottom = '70px'; }
  if (p.top)    { pop.style.top = '70px'; }
  if (p.right)  { pop.style.right = '0'; }
  if (p.left)   { pop.style.left = '0'; }
  shadow.appendChild(pop);

  var iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Feedback');
  iframe.setAttribute('loading', 'lazy');
  iframe.src = portalUrl;
  pop.appendChild(iframe);

  function toggle() {
    var open = pop.classList.toggle('open');
    bubble.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  bubble.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
  document.addEventListener('click', function (e) {
    if (pop.classList.contains('open') && !host.contains(e.target)) pop.classList.remove('open');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') pop.classList.remove('open');
  });

  // Pull brand color + position from the board config (best-effort).
  try {
    fetch(apiBase, { headers: { 'accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.board) return;
        if (data.board.brand_color) {
          brandColor = data.board.brand_color;
          bubble.style.background = brandColor;
        }
      })
      .catch(function () {});
  } catch (e) {}
})();
`;
