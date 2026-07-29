const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Keep Tab traversal inside `node`. A native modal dialog gets this from the top layer, but any
 * overlay that covers the page without being one — the mobile navigation drawer, for instance —
 * has to say so explicitly, or Tab walks through the controls hidden underneath it.
 * Callers wire this to their own `keydown` and decide when it applies.
 */
export function containTab(node: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusable = [...node.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) => !element.hidden,
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) {
    event.preventDefault();
    node.focus();
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Promote a conditionally rendered dialog into the browser's modal top layer.
 * Native modal dialogs make the rest of the page inert. This action also
 * contains explicit keyboard traversal and restores the invoking control;
 * callers remain responsible for handling `cancel`.
 */
export function modal(node: HTMLDialogElement): { destroy(): void } {
  const invoker =
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;

  const containTabInDialog = (event: KeyboardEvent) => containTab(node, event);

  node.addEventListener('keydown', containTabInDialog);
  if (!node.open) node.showModal();

  return {
    destroy() {
      node.removeEventListener('keydown', containTabInDialog);
      if (node.open) node.close();
      queueMicrotask(() => {
        if (invoker?.isConnected) invoker.focus();
      });
    },
  };
}
