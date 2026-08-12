import hljs from 'highlight.js/lib/common';

const COPY_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

function languageOf(code: HTMLElement): string {
  const m = code.className.match(/(?:^|\s)language-([\w+-]+)/);
  return m?.[1] ?? '';
}

function addCopyButton(pre: HTMLPreElement): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.contentEditable = 'false';
  btn.setAttribute('data-copy-btn', 'true');
  btn.setAttribute('aria-label', 'Copy code to clipboard');
  btn.innerHTML = COPY_SVG;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const code = pre.querySelector('code');
    const text = code ? (code.textContent ?? '') : '';
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add('copied');
      btn.innerHTML = CHECK_SVG;
      window.setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = COPY_SVG;
      }, 1400);
    } catch {
      /* clipboard unavailable */
    }
  });
  pre.appendChild(btn);
}

function addLangLabel(pre: HTMLPreElement, lang: string): void {
  if (!lang) return;
  const lbl = document.createElement('span');
  lbl.className = 'md-code-lang';
  lbl.contentEditable = 'false';
  lbl.textContent = lang;
  pre.appendChild(lbl);
}

/**
 * Enhance `<pre><code>` blocks inside `root`:
 *  - run highlight.js syntax highlighting (unless already highlighted)
 *  - add a language badge (top-left)
 *  - add a copy-to-clipboard button (top-right)
 *
 * Pass `{ highlight: false }` when blocks are already highlighted at render
 * time (e.g. Tiptap CodeBlockLowlight inside the live editor).
 *
 * Idempotent: safe to call repeatedly on the same root.
 */
export function enhanceCodeBlocks(
  root: HTMLElement | null | undefined,
  opts: { highlight?: boolean } = {},
): void {
  if (!root) return;
  const { highlight = true } = opts;
  const pres = root.querySelectorAll<HTMLPreElement>('pre');
  pres.forEach((pre) => {
    const code = pre.querySelector<HTMLElement>('code');
    if (!code) return;

    if (highlight) {
      const already =
        code.dataset.highlighted === 'yes' ||
        !!code.querySelector('[class*="hljs-"]') ||
        /\bhljs\b/.test(code.className);
      if (!already && code.textContent && code.textContent.trim()) {
        try {
          hljs.highlightElement(code);
        } catch {
          /* ignore unknown / unparseable language */
        }
      }
    }

    if (!pre.querySelector('[data-copy-btn]')) addCopyButton(pre);
    if (!pre.querySelector('.md-code-lang')) addLangLabel(pre, languageOf(code));
  });
}
