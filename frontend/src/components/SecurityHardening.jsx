import { useEffect } from 'react';

/**
 * SecurityHardening — mount once near the root of the tree.
 *
 * What it does (best-effort content protection):
 *  • Disables the right-click menu everywhere
 *  • Disables text selection on body (form fields still selectable so admins
 *    can correct typos while typing credentials / IMEIs / coords)
 *  • Blocks copy / cut / drag from any non-input element
 *  • Blocks paste OUTSIDE of form inputs (paste inside inputs still works so
 *    admins can paste MQTT topics, hardware IDs etc. into the registration
 *    forms — otherwise the app becomes unusable)
 *  • Swallows common DevTools + save shortcuts (F12, Ctrl/Cmd+Shift+I/J/C,
 *    Ctrl/Cmd+S, Ctrl/Cmd+P, Ctrl/Cmd+U)
 *  • Intercepts the PrintScreen key: shows a full-page black overlay for
 *    ~800 ms and clears the OS clipboard, so any screenshot captured during
 *    the window shows a blank page. This is a *deterrent*, not a real
 *    guarantee — OS-level screen capture cannot be blocked from a web page.
 *
 * The component renders nothing; it only wires document-level listeners and
 * injects a `<style>` block.
 */
export default function SecurityHardening() {
  useEffect(() => {
    // ────────── CSS: disable selection globally, allow it in form inputs ──────────
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-security-hardening', 'true');
    styleEl.textContent = `
      html, body {
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
      }
      /* Keep inputs / textareas / contenteditable usable — otherwise admins
         can't correct typos while typing credentials or IMEIs. */
      input, textarea, select, [contenteditable="true"], [contenteditable=""] {
        -webkit-user-select: text !important;
        user-select: text !important;
        -webkit-touch-callout: default !important;
      }
      /* Screenshot deterrent overlay */
      body.__print_shield__::before {
        content: '';
        position: fixed;
        inset: 0;
        background: #000;
        z-index: 2147483647;
        pointer-events: none;
      }
    `;
    document.head.appendChild(styleEl);

    // ────────── helpers ──────────
    const inInput = (target) => {
      if (!target) return false;
      const tag = (target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      // contenteditable descendants
      let el = target;
      while (el) {
        if (el.isContentEditable) return true;
        el = el.parentElement;
      }
      return false;
    };

    // ────────── right-click ──────────
    const onContextMenu = (e) => {
      e.preventDefault();
      return false;
    };

    // ────────── selection + copy + cut + drag ──────────
    const cancel = (e) => {
      if (inInput(e.target)) return; // let admins fix typos
      e.preventDefault();
      return false;
    };
    const onPaste = (e) => {
      // Allow paste ONLY inside form inputs so admins can paste MQTT topics,
      // IMEIs, coordinates, etc. Everything else is blocked.
      if (inInput(e.target)) return;
      e.preventDefault();
    };

    // ────────── PrintScreen — blur overlay + clear clipboard ──────────
    const onKeyDown = (e) => {
      // PrintScreen (fires on keyup in many browsers but keydown works on
      // Windows Firefox / Edge; we bind both).
      if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
        try { navigator.clipboard?.writeText('')?.catch(() => {}); } catch { /* ignore */ }
        document.body.classList.add('__print_shield__');
        setTimeout(() => document.body.classList.remove('__print_shield__'), 800);
        return;
      }

      // DevTools + save shortcuts
      const mod = e.ctrlKey || e.metaKey; // Cmd on macOS, Ctrl elsewhere
      const isF12 = e.key === 'F12';
      const isDevKey = mod && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key);
      const isViewSrc = mod && ['U', 'u'].includes(e.key);
      const isSave    = mod && ['S', 's'].includes(e.key);
      const isPrint   = mod && ['P', 'p'].includes(e.key);
      // Ctrl+A on non-input surfaces (would select whole page)
      const isSelectAll = mod && ['A', 'a'].includes(e.key) && !inInput(e.target);
      if (isF12 || isDevKey || isViewSrc || isSave || isPrint || isSelectAll) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };
    const onKeyUp = (e) => {
      if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
        try { navigator.clipboard?.writeText('')?.catch(() => {}); } catch { /* ignore */ }
        document.body.classList.add('__print_shield__');
        setTimeout(() => document.body.classList.remove('__print_shield__'), 800);
      }
    };

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('selectstart', cancel);
    document.addEventListener('copy', cancel);
    document.addEventListener('cut', cancel);
    document.addEventListener('dragstart', cancel);
    document.addEventListener('paste', onPaste);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);

    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('selectstart', cancel);
      document.removeEventListener('copy', cancel);
      document.removeEventListener('cut', cancel);
      document.removeEventListener('dragstart', cancel);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
      styleEl.remove();
    };
  }, []);

  return null;
}
