/**
 * jsdom ships `HTMLDialogElement` but implements none of its behaviour:
 * `showModal` and `close` simply do not exist, so a component that opens a
 * dialog throws on render instead of showing one. This teaches it the part the
 * tests depend on — the element is in the document and reachable when open —
 * and nothing more.
 *
 * Deliberately not a substitute for the real thing: the top layer, the
 * backdrop, the focus move and Escape are all still missing here, so a test
 * written against this shim can assert *what* a dialog says and what its
 * buttons do, never that it behaves like a modal. That part is the browser's.
 * src/ui/ConfirmDialog.tsx
 */
export function installDialogShim(): void {
  const proto = globalThis.HTMLDialogElement?.prototype
  if (!proto || typeof proto.showModal === 'function') return

  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true
  }
  proto.show = function show(this: HTMLDialogElement) {
    this.open = true
  }
  proto.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (!this.open) return
    this.open = false
    if (returnValue !== undefined) this.returnValue = returnValue
    this.dispatchEvent(new Event('close'))
  }
}
