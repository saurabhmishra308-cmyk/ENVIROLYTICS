// Backend-backed auth module.
// Exports keep the same names as the previous mock module so existing
// pages continue to work without changes.
import api from "./lib/api";

const TOKEN_KEY = "envirolytics_token";
const USER_KEY = "envirolytics_user";

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.warn('[storage] read blocked:', e?.message);
    return null;
  }
}

function safeSet(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.warn('[storage] write blocked:', e?.message);
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.warn('[storage] remove blocked:', e?.message);
  }
}

export function getCurrentUser() {
  const raw = safeGet(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return !!safeGet(TOKEN_KEY);
}

export function getToken() {
  return safeGet(TOKEN_KEY);
}

// Backend login (email + password)
export async function loginWithEmail(email, password) {
  try {
    const { data } = await api.post("/api/auth/login", { email, password });
    safeSet(TOKEN_KEY, data.access_token);
    safeSet(
      USER_KEY,
      JSON.stringify({
        ...data.user,
        // Provide a `fullName` alias for legacy pages
        fullName: data.user.full_name,
        username: data.user.email,
      })
    );
    return { success: true, user: data.user };
  } catch (e) {
    const msg =
      e?.response?.data?.detail || e?.message || "Login failed";
    return { success: false, message: typeof msg === "string" ? msg : "Login failed" };
  }
}

// Legacy synchronous wrapper kept for backward-compat where pages call mockLogin.
// It is now deprecated — use loginWithEmail instead. Returns a Promise.
export function mockLogin(username, password) {
  return loginWithEmail(username, password);
}

export function mockLogout() {
  safeRemove(TOKEN_KEY);
  safeRemove(USER_KEY);
}

// Refresh user info from backend
export async function refreshCurrentUser() {
  if (!isAuthenticated()) return null;
  try {
    const { data } = await api.get("/api/auth/me");
    safeSet(
      USER_KEY,
      JSON.stringify({
        ...data,
        fullName: data.full_name,
        username: data.email,
      })
    );
    return data;
  } catch {
    return null;
  }
}

export function isAdmin() {
  const u = getCurrentUser();
  return u?.role === "admin";
}
