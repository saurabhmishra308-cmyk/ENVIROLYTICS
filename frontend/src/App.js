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
import Sidebar from "./components/Sidebar";
import { Toaster } from "./components/ui/sonner";
import { getCurrentUser, isAuthenticated } from "./mockData";

const DashboardLayout = ({ children }) => (
  <div className="flex min-h-screen">
    <Sidebar />
    <div className="flex-1 bg-gray-50 overflow-x-hidden">{children}</div>
  </div>
);

// Permission gate: admins pass through; sub-users need the named permission.
const PermissionRoute = ({ permission, children }) => {
  if (!isAuthenticated()) return <Navigate to="/" replace />;
  const user = getCurrentUser();
  const isAdmin = user?.role === 'admin';
  const allowed = isAdmin || !!user?.permissions?.[permission];
  if (!allowed) return <Navigate to="/dashboard" replace />;
  return children;
};

function App() {
  return (
    <ThemeProvider>
      <div className="App">
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/policies" element={<Policies />} />

            <Route path="/dashboard" element={<PermissionRoute permission="dashboard"><DashboardLayout><EnhancedDashboard /></DashboardLayout></PermissionRoute>} />
            <Route path="/analysis" element={<PermissionRoute permission="analysis"><DashboardLayout><Analysis /></DashboardLayout></PermissionRoute>} />
            <Route path="/reports" element={<PermissionRoute permission="reports"><DashboardLayout><Reports /></DashboardLayout></PermissionRoute>} />
            <Route path="/graph-report" element={<PermissionRoute permission="reports"><DashboardLayout><GraphReport /></DashboardLayout></PermissionRoute>} />
            <Route path="/site" element={<DashboardLayout><Site /></DashboardLayout>} />
            <Route path="/user" element={<DashboardLayout><User /></DashboardLayout>} />
            <Route path="/certificates" element={<PermissionRoute permission="certificates"><DashboardLayout><Certificates /></DashboardLayout></PermissionRoute>} />
            <Route path="/maintenance" element={<PermissionRoute permission="certificates"><DashboardLayout><Certificates /></DashboardLayout></PermissionRoute>} />
            <Route path="/audit-log" element={<PermissionRoute permission="audit"><DashboardLayout><AuditLog /></DashboardLayout></PermissionRoute>} />

            <Route path="/flowmeter" element={<Flowmeter />} />
            <Route path="/water-level-recorder" element={<WaterLevelRecorder />} />
            <Route path="/dwlr" element={<InstrumentDetail type="dwlr" />} />
            <Route path="/ph" element={<InstrumentDetail type="ph" />} />
            <Route path="/tds" element={<InstrumentDetail type="tds" />} />
            <Route path="/conductivity" element={<InstrumentDetail type="conductivity" />} />
          </Routes>
          <Toaster richColors position="top-right" />
        </BrowserRouter>
      </div>
    </ThemeProvider>
  );
}

export default App;
