// Centralized axios instance with auth interceptor
import axios from "axios";

const API_BASE = process.env.REACT_APP_BACKEND_URL || "";

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem("envirolytics_token");
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // localStorage unavailable; skip
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Auto-logout on 401 (except for login endpoint itself)
    const isLoginCall = err?.config?.url?.includes("/api/auth/login");
    if (err?.response?.status === 401 && !isLoginCall) {
      try {
        localStorage.removeItem("envirolytics_token");
        localStorage.removeItem("envirolytics_user");
      } catch {
        // ignore
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
