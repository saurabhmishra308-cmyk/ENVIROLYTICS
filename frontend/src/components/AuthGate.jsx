import React, { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";

/**
 * AuthGate listens for the `envirolytics:auth-expired` event that the axios
 * interceptor fires when a token-invalid 401 is received. It performs a single,
 * controlled redirect to "/" so the user is never stuck on a half-rendered
 * authenticated page after their session dies.
 *
 * Sits inside <BrowserRouter> so useNavigate is available; it does not render
 * any UI of its own.
 */
const AuthGate = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handler = () => {
      // Avoid bouncing the user when they're already on the login screen
      if (location.pathname === "/" || location.pathname === "/policies") return;
      try {
        toast.warning("Session expired. Please sign in again.");
      } catch {
        // toast may not be mounted yet; ignore
      }
      navigate("/", { replace: true });
    };
    window.addEventListener("envirolytics:auth-expired", handler);
    return () => window.removeEventListener("envirolytics:auth-expired", handler);
  }, [navigate, location.pathname]);

  return children;
};

export default AuthGate;
