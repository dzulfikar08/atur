/**
 * Controller for the #boot splash in index.html.
 *
 * During boot the full-screen loading state is owned by several components in
 * turn (Suspense fallback, auth check, workspace redirect). Each holds the one
 * splash element open instead of rendering its own spinner, so its animations
 * never restart and the label just advances. The splash fades out once nothing
 * holds it.
 */

const LEAVE_MS = 180;

// index.html paints the splash before any component exists; that implicit hold
// is dropped by releaseInitialBootHold() after React's first commit.
let holds = 1;
let initialHoldReleased = false;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function show(node: HTMLElement) {
  clearTimeout(hideTimer);
  hideTimer = undefined;
  if (node.hidden) {
    node.hidden = false;
    // Replay the enter animation: a splash re-shown after boot (e.g. sign-out
    // to a cold login chunk) should wait a beat instead of popping in.
    node.classList.remove("boot");
    void node.offsetWidth;
    node.classList.add("boot");
  }
  node.classList.remove("boot--leaving");
}

function scheduleHide() {
  // Deferred: one loader unmounting and the next mounting land in the same
  // commit, and the splash must not blink between them.
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    const node = document.getElementById("boot");
    if (!node || holds > 0) return;
    node.classList.add("boot--leaving");
    hideTimer = setTimeout(() => {
      if (holds === 0) node.hidden = true;
    }, LEAVE_MS);
  }, 0);
}

function release() {
  holds = Math.max(0, holds - 1);
  if (holds === 0) scheduleHide();
}

/** Keep the splash on screen with `label` until the returned release runs. */
export function holdBootSplash(label: string): () => void {
  const node = document.getElementById("boot");
  if (!node) return () => {};
  holds++;
  show(node);
  const labelNode = node.querySelector("#boot-label");
  if (labelNode) labelNode.textContent = label;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
  };
}

/** Drop the hold index.html starts with. Idempotent. */
export function releaseInitialBootHold(): void {
  if (initialHoldReleased) return;
  initialHoldReleased = true;
  release();
}
