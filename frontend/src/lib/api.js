// Centralized axios instance with auth interceptor
import axios from "axios";

const API_BASE = process.env.REACT_APP_BACKEND_URL || "";

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

// Endpoints whose 401 should never auto-logout the user.
// These are user-action failures (wrong current password etc), not token problems.
const AUTH_SAFE_ENDPOINTS = [
  "/api/auth/login",
  "/api/auth/change-password",
  "/api/auth/admin/change-user-password",
];

// Reasons that ARE valid token problems and should trigger logout
function isTokenInvalidError(err) {
  const detail = err?.response?.data?.detail;
  if (typeof detail !== "string") return false;
  const d = detail.toLowerCase();
  return (
    d.includes("not authenticated") ||
    d.includes("invalid or expired token") ||
    d.includes("user not found") ||
    d.includes("could not validate")
  );
}

api.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem("envirolytics_token");
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (e) {
    // localStorage may be disabled (Safari private mode, iframe sandbox) — proceed without token
    if (typeof console !== "undefined") console.warn("[api] localStorage unavailable in request interceptor:", e?.message);
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err?.config?.url || "";
    const status = err?.response?.status;
    const isAuthSafe = AUTH_SAFE_ENDPOINTS.some((p) => url.includes(p));

    // Only auto-logout when the 401 clearly indicates an invalid/expired token,
    // and the call isn't a user-action endpoint that returns 401 for business reasons
    // (e.g. /api/auth/change-password returning 401 for wrong current password).
    if (status === 401 && !isAuthSafe && isTokenInvalidError(err)) {
      try {
        const hadToken = !!localStorage.getItem("envirolytics_token");
        localStorage.removeItem("envirolytics_token");
        localStorage.removeItem("envirolytics_user");
        if (hadToken && typeof window !== "undefined") {
          // Notify the app (AuthGate listens) so it can redirect to login cleanly.
          window.dispatchEvent(new CustomEvent("envirolytics:auth-expired"));
        }
      } catch (e) {
        if (typeof console !== "undefined") console.warn("[api] localStorage unavailable during 401 cleanup:", e?.message);
      }
    }
    return Promise.reject(err);
  }
);

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default api;
