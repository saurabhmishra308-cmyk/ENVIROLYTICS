import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isAuthenticated, mockLogout } from "../mockData";

export const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const ACTIVITY_KEY = "envirolytics:last-user-activity";
const TOKEN_KEY = "envirolytics_token";
const ACTIVITY_PUBLISH_INTERVAL_MS = 1000;

const readActivity = () => {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
};

const publishActivity = (timestamp) => {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(timestamp));
  } catch {
    // Storage may be unavailable; the in-memory timer still works.
  }
};

const clearActivity = () => {
  try {
    localStorage.removeItem(ACTIVITY_KEY);
  } catch {
    // Ignore storage failures during logout.
  }
};

/**
 * Global authenticated-session timeout.
 *
 * The timeout is intentionally based ONLY on human interaction and document
 * visibility. API polling, MQTT updates, weather refreshes and other network
 * activity never reset it.
 *
 * Activity is synchronized between tabs through localStorage so one active
 * tab keeps a shared browser session alive while another tab is open in the
 * background. The existing auth-expired event remains the single logout
 * notification path used by AuthGate.
 */
export default function SessionTimeout() {
  const navigate = useNavigate();
  const location = useLocation();

  const timerRef = useRef(null);
  const lastActivityRef = useRef(0);
  const hiddenAtRef = useRef(null);
  const lastPublishedRef = useRef(0);
  const loggingOutRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      return undefined;
    }

    let active = true;

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const forceLogout = (reason) => {
      if (!active || loggingOutRef.current || !isAuthenticated()) return;
      loggingOutRef.current = true;
      clearTimer();
      clearActivity();

      try {
        mockLogout();
      } finally {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("envirolytics:auth-expired", {
              detail: { reason },
            })
          );
        }
      }
    };

    const schedule = () => {
      clearTimer();

      if (!active || !isAuthenticated()) return;

      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = SESSION_TIMEOUT_MS - elapsed;

      if (remaining <= 0) {
        forceLogout("inactivity");
        return;
      }

      timerRef.current = setTimeout(schedule, Math.min(remaining, 30_000));
    };

    const acceptActivity = (timestamp, publish = true) => {
      if (!active || !isAuthenticated()) return;

      const now = Date.now();
      const candidate = Number.isFinite(timestamp) ? timestamp : now;

      if (candidate <= lastActivityRef.current) return;

      lastActivityRef.current = candidate;

      if (
        publish &&
        candidate - lastPublishedRef.current >= ACTIVITY_PUBLISH_INTERVAL_MS
      ) {
        lastPublishedRef.current = candidate;
        publishActivity(candidate);
      }

      schedule();
    };

    const markUserActivity = () => {
      const now = Date.now();

      // Ignore synthetic/high-frequency activity while still allowing normal
      // human interaction to refresh the session.
      if (now - lastActivityRef.current < 250) return;

      acceptActivity(now, true);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        schedule();
        return;
      }

      const hiddenFor = hiddenAtRef.current
        ? Date.now() - hiddenAtRef.current
        : 0;

      hiddenAtRef.current = null;

      if (hiddenFor >= SESSION_TIMEOUT_MS) {
        forceLogout("background");
        return;
      }

      // Do not treat returning to the tab as user activity. The user must
      // actually interact to reset the inactivity timer.
      schedule();
    };

    const onStorage = (event) => {
      if (event.key === TOKEN_KEY && !event.newValue) {
        if (isAuthenticated()) {
          mockLogout();
          window.dispatchEvent(
            new CustomEvent("envirolytics:auth-expired", {
              detail: { reason: "logout-in-another-tab" },
            })
          );
        }
        return;
      }

      if (event.key === ACTIVITY_KEY && event.newValue) {
        const timestamp = Number(event.newValue);
        if (Number.isFinite(timestamp)) {
          acceptActivity(timestamp, false);
        }
      }
    };

    const activityEvents = [
      ["pointerdown", markUserActivity],
      ["keydown", markUserActivity],
      ["touchstart", markUserActivity],
      ["wheel", markUserActivity],
      ["mousemove", markUserActivity],
    ];

    activityEvents.forEach(([event, handler]) => {
      document.addEventListener(event, handler, { passive: true });
    });

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("storage", onStorage);

    schedule();

    return () => {
      active = false;
      clearTimer();

      activityEvents.forEach(([event, handler]) => {
        document.removeEventListener(event, handler);
      });

      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("storage", onStorage);

    };
  }, [location.pathname, navigate]);

  return null;
}
