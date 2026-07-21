import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";
import Login from "./pages/Login";
import Policies from "./pages/Policies";
import EnhancedDashboard from "./pages/EnhancedDashboard";
import Flowmeter from "./pages/Flowmeter";
import WaterLevelRecorder from "./pages/WaterLevelRecorder";
import WaterQualityDetail from "./pages/WaterQualityDetail";
import InstrumentDetail from "./pages/InstrumentDetail";
import Analysis from "./pages/Analysis";
import Reports from "./pages/Reports";
import GraphReport from "./pages/GraphReport";
import Site from "./pages/Site";
import User from "./pages/User";
import Certificates from "./pages/Certificates";
import AuditLog from "./pages/AuditLog";
import Instruments from "./pages/Instruments";
import Sidebar from "./components/Sidebar";
import ErrorBoundary from "./components/ErrorBoundary";
import AuthGate from "./components/AuthGate";
import { Toaster } from "./components/ui/sonner";
import { getCurrentUser, isAuthenticated } from "./mockData";

const DashboardLayout = ({ children }) => (
  <div className="flex min-h-screen">
    <Sidebar />
    <div className="flex-1 bg-gray-50 overflow-x-hidden">{children}</div>
  </div>
);

// Permission gate: admins + clients pass through; sub-users need the named permission.
const PermissionRoute = ({ permission, children }) => {
  if (!isAuthenticated()) return <Navigate to="/" replace />;
  const user = getCurrentUser();
  const role = user?.role;
  // Admins have full access; clients have full access; sub-users gated by explicit permissions.
  const allowed = role === 'admin' || role === 'client' || !!user?.permissions?.[permission];
  // If this is the dashboard route itself, fall back to "/" to avoid redirect loop
  if (!allowed) return <Navigate to={permission === 'dashboard' ? '/' : '/dashboard'} replace />;
  return children;
};

// Simple auth-only gate for routes that don't need a permission key
const RequireAuth = ({ children }) => {
  if (!isAuthenticated()) return <Navigate to="/" replace />;
  return children;
};

function App() {
  return (
    <ThemeProvider>
      <div className="App">
        <BrowserRouter>
          <AuthGate>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Login />} />
                <Route path="/policies" element={<Policies />} />

                <Route path="/dashboard" element={<PermissionRoute permission="dashboard"><DashboardLayout><EnhancedDashboard /></DashboardLayout></PermissionRoute>} />
                <Route path="/analysis" element={<PermissionRoute permission="analysis"><DashboardLayout><Analysis /></DashboardLayout></PermissionRoute>} />
                <Route path="/reports" element={<PermissionRoute permission="reports"><DashboardLayout><Reports /></DashboardLayout></PermissionRoute>} />
                <Route path="/graph-report" element={<PermissionRoute permission="reports"><DashboardLayout><GraphReport /></DashboardLayout></PermissionRoute>} />
                <Route path="/site" element={<RequireAuth><DashboardLayout><Site /></DashboardLayout></RequireAuth>} />
                <Route path="/user" element={<RequireAuth><DashboardLayout><User /></DashboardLayout></RequireAuth>} />
                <Route path="/certificates" element={<PermissionRoute permission="certificates"><DashboardLayout><Certificates /></DashboardLayout></PermissionRoute>} />
                <Route path="/maintenance" element={<PermissionRoute permission="certificates"><DashboardLayout><Certificates /></DashboardLayout></PermissionRoute>} />
                <Route path="/audit-log" element={<PermissionRoute permission="audit"><DashboardLayout><AuditLog /></DashboardLayout></PermissionRoute>} />
                <Route path="/instruments" element={<RequireAuth><DashboardLayout><Instruments /></DashboardLayout></RequireAuth>} />

                <Route path="/flowmeter" element={<RequireAuth><Flowmeter /></RequireAuth>} />
                <Route path="/water-level-recorder" element={<RequireAuth><WaterLevelRecorder /></RequireAuth>} />
                <Route path="/water-quality/:hardwareId" element={<RequireAuth><WaterQualityDetail /></RequireAuth>} />
                <Route path="/dwlr" element={<RequireAuth><InstrumentDetail type="dwlr" /></RequireAuth>} />
                <Route path="/ph" element={<RequireAuth><InstrumentDetail type="ph" /></RequireAuth>} />
                <Route path="/tds" element={<RequireAuth><InstrumentDetail type="tds" /></RequireAuth>} />
                <Route path="/conductivity" element={<RequireAuth><InstrumentDetail type="conductivity" /></RequireAuth>} />

                {/* Catch-all: send unknown paths to login (keeps session intact via storage) */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ErrorBoundary>
          </AuthGate>
          <Toaster richColors position="top-right" />
        </BrowserRouter>
      </div>
    </ThemeProvider>
  );
}

export default App;
