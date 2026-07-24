import { useEffect } from 'react';
import { isAdmin } from '../mockData';

/**
 * SecurityHardening — mount once near the root of the tree.
 *
 * Content-protection for CLIENT users only. Admins get an unrestricted
 * browser (right-click / selection / copy / paste / DevTools / PrintScreen
 * all work normally) so support & QA can operate without friction. Every
 * event handler re-reads `isAdmin()` at call time so a login / logout
 * flips the behaviour instantly without a page reload.
 *
 * For non-admin users the hardening blocks (best-effort):
 *  • Right-click menu
 *  • Text selection outside form fields
 *  • Copy / cut / drag from any non-input element
 *  • Paste outside form inputs (paste in inputs still works so clients can
 *    paste MQTT topics, hardware IDs, etc. into search / support forms)
 *  • DevTools + save shortcuts (F12, Ctrl/Cmd+Shift+I/J/C, Ctrl/Cmd+U/S/P)
 *  • Ctrl+A on non-input surfaces
 *
 * PrintScreen: an ~800 ms black overlay + clipboard-clear (deterrent only —
 * OS-level screen capture can never be prevented from a web page).
 *
 * Renders nothing; only wires document listeners and injects CSS.
 */
export default function SecurityHardening() {
  useEffect(() => {
    // ────────── CSS: apply select-none only when body has __client_lock__ ──────────
    // We toggle the body class on every tick based on isAdmin() so admins
    // never get the selection lock, even without a page reload.
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-security-hardening', 'true');
    styleEl.textContent = `
      body.__client_lock__ {
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
      }
      body.__client_lock__ input,
      body.__client_lock__ textarea,
      body.__client_lock__ select,
      body.__client_lock__ [contenteditable="true"],
      body.__client_lock__ [contenteditable=""] {
        -webkit-user-select: text !important;
        user-select: text !important;
        -webkit-touch-callout: default !important;
      }
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

    // Reconcile the body class with the current role every 1s (also on
    // storage events for cross-tab logins/logouts).
    const reconcileClass = () => {
      let admin = false;
      try { admin = isAdmin(); } catch (_e) { admin = false; }
      if (admin) document.body.classList.remove('__client_lock__');
      else document.body.classList.add('__client_lock__');
    };
    reconcileClass();
    const reconcileTimer = setInterval(reconcileClass, 1000);
    window.addEventListener('storage', reconcileClass);

    // ────────── helpers ──────────
    const inInput = (target) => {
      if (!target) return false;
      const tag = (target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      let el = target;
      while (el) {
        if (el.isContentEditable) return true;
        el = el.parentElement;
      }
      return false;
    };
    const admin = () => {
      try { return isAdmin(); } catch (_e) { return false; }
    };
    const clearClip = () => {
      try {
        const p = navigator.clipboard && navigator.clipboard.writeText('');
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_e) { /* ignore */ }
    };

    // ────────── right-click ──────────
    const onContextMenu = (e) => {
      if (admin()) return;             // admins get the browser menu
      e.preventDefault();
      return false;
    };

    // ────────── selection + copy + cut + drag ──────────
    const cancel = (e) => {
      if (admin()) return;
      if (inInput(e.target)) return;   // let clients fix typos in inputs
      e.preventDefault();
      return false;
    };
    const onPaste = (e) => {
      if (admin()) return;
      if (inInput(e.target)) return;   // paste allowed in forms
      e.preventDefault();
    };

    // ────────── PrintScreen + DevTools shortcuts ──────────
    const onKeyDown = (e) => {
      if (admin()) return;             // admins get everything

      if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
        clearClip();
        document.body.classList.add('__print_shield__');
        setTimeout(() => document.body.classList.remove('__print_shield__'), 800);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const isF12 = e.key === 'F12';
      const isDevKey = mod && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key);
      const isViewSrc = mod && ['U', 'u'].includes(e.key);
      const isSave    = mod && ['S', 's'].includes(e.key);
      const isPrint   = mod && ['P', 'p'].includes(e.key);
      const isSelectAll = mod && ['A', 'a'].includes(e.key) && !inInput(e.target);
      if (isF12 || isDevKey || isViewSrc || isSave || isPrint || isSelectAll) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };
    const onKeyUp = (e) => {
      if (admin()) return;
      if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
        clearClip();
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
      clearInterval(reconcileTimer);
      window.removeEventListener('storage', reconcileClass);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('selectstart', cancel);
      document.removeEventListener('copy', cancel);
      document.removeEventListener('cut', cancel);
      document.removeEventListener('dragstart', cancel);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
      document.body.classList.remove('__client_lock__');
      styleEl.remove();
    };
  }, []);

  return null;
}
