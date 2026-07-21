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
  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const containTab = (event: KeyboardEvent) => {
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
  };

  node.addEventListener('keydown', containTab);
  if (!node.open) node.showModal();

  return {
    destroy() {
      node.removeEventListener('keydown', containTab);
      if (node.open) node.close();
      queueMicrotask(() => {
        if (invoker?.isConnected) invoker.focus();
      });
    },
  };
}
