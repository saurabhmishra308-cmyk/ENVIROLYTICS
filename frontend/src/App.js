import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";
import Login from "./pages/Login";
import Policies from "./pages/Policies";
import EnhancedDashboard from "./pages/EnhancedDashboard";
import Flowmeter from "./pages/Flowmeter";
import WaterLevelRecorder from "./pages/WaterLevelRecorder";
import InstrumentDetail from "./pages/InstrumentDetail";
import Analysis from "./pages/Analysis";
import Reports from "./pages/Reports";
import GraphReport from "./pages/GraphReport";
import Site from "./pages/Site";
import User from "./pages/User";
import Certificates from "./pages/Certificates";
import AuditLog from "./pages/AuditLog";
import CustomerProfile from "./pages/CustomerProfile";
import Instruments from "./pages/Instruments";
import Cameras from "./pages/Cameras";
import WaterQuality from "./pages/WaterQuality";
import Sidebar from "./components/Sidebar";
import ErrorBoundary from "./components/ErrorBoundary";
import AuthGate from "./components/AuthGate";
import SecurityHardening from "./components/SecurityHardening";
import { Toaster } from "./components/ui/sonner";
import { getCurrentUser, isAuthenticated, isAdmin } from "./mockData";
import { useViewPermissions } from "./hooks/useViewPermissions";

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

// Admin-set view-permission gate. Admins always pass. Clients whose admin
// has disabled a page get bounced to /dashboard so a typed URL doesn't
// leak the hidden page. `loading` short-circuits so we don't flash a
// redirect while permissions are being fetched.
const ViewGate = ({ permission, children }) => {
  const { can, loading } = useViewPermissions();
  if (!isAuthenticated()) return <Navigate to="/" replace />;
  if (isAdmin()) return children;
  if (loading) return null;
  if (!can(permission)) return <Navigate to="/dashboard" replace />;
  return children;
};

function App() {
  return (
    <ThemeProvider>
      <div className="App">
        <SecurityHardening />
        <BrowserRouter>
          <AuthGate>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Login />} />
                <Route path="/policies" element={<Policies />} />

                <Route path="/dashboard" element={<PermissionRoute permission="dashboard"><ViewGate permission="dashboard"><DashboardLayout><EnhancedDashboard /></DashboardLayout></ViewGate></PermissionRoute>} />
                <Route path="/analysis" element={<PermissionRoute permission="analysis"><ViewGate permission="analysis"><DashboardLayout><Analysis /></DashboardLayout></ViewGate></PermissionRoute>} />
                <Route path="/reports" element={<PermissionRoute permission="reports"><ViewGate permission="reports"><DashboardLayout><Reports /></DashboardLayout></ViewGate></PermissionRoute>} />
                <Route path="/graph-report" element={<PermissionRoute permission="reports"><ViewGate permission="graph_report"><DashboardLayout><GraphReport /></DashboardLayout></ViewGate></PermissionRoute>} />
                <Route path="/site" element={<ViewGate permission="site"><DashboardLayout><Site /></DashboardLayout></ViewGate>} />
                <Route path="/user" element={<RequireAuth><DashboardLayout><User /></DashboardLayout></RequireAuth>} />
                <Route path="/certificates" element={<PermissionRoute permission="certificates"><ViewGate permission="certificates"><DashboardLayout><Certificates /></DashboardLayout></ViewGate></PermissionRoute>} />
                <Route path="/maintenance" element={<PermissionRoute permission="certificates"><ViewGate permission="certificates"><DashboardLayout><Certificates /></DashboardLayout></ViewGate></PermissionRoute>} />
                <Route path="/audit-log" element={<PermissionRoute permission="audit"><ViewGate permission="audit_log"><DashboardLayout><AuditLog /></DashboardLayout></ViewGate></PermissionRoute>} />
                <Route path="/customer-profile" element={<ViewGate permission="customer_profile"><DashboardLayout><CustomerProfile /></DashboardLayout></ViewGate>} />
                <Route path="/instruments" element={<RequireAuth><DashboardLayout><Instruments /></DashboardLayout></RequireAuth>} />
                <Route path="/cameras" element={<RequireAuth><DashboardLayout><Cameras /></DashboardLayout></RequireAuth>} />
                <Route path="/water-quality" element={<ViewGate permission="water_quality"><DashboardLayout><WaterQuality /></DashboardLayout></ViewGate>} />

                <Route path="/flowmeter" element={<ViewGate permission="flowmeter"><Flowmeter /></ViewGate>} />
                <Route path="/water-level-recorder" element={<ViewGate permission="dwlr"><WaterLevelRecorder /></ViewGate>} />
                <Route path="/dwlr" element={<ViewGate permission="dwlr"><InstrumentDetail type="dwlr" /></ViewGate>} />
                <Route path="/ph" element={<ViewGate permission="ph"><InstrumentDetail type="ph" /></ViewGate>} />
                <Route path="/tds" element={<ViewGate permission="tds"><InstrumentDetail type="tds" /></ViewGate>} />
                <Route path="/conductivity" element={<ViewGate permission="conductivity"><InstrumentDetail type="conductivity" /></ViewGate>} />

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
