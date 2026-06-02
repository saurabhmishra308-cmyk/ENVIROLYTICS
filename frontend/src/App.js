import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";
import Login from "./pages/Login";
import Policies from "./pages/Policies";
import EnhancedDashboard from "./pages/EnhancedDashboard";
import Flowmeter from "./pages/Flowmeter";
import WaterLevelRecorder from "./pages/WaterLevelRecorder";
import Analysis from "./pages/Analysis";
import Reports from "./pages/Reports";
import GraphReport from "./pages/GraphReport";
import Site from "./pages/Site";
import User from "./pages/User";
import Zone from "./pages/Zone";
import Certificates from "./pages/Certificates";
import Sidebar from "./components/Sidebar";
import { Toaster } from "./components/ui/sonner";

// Layout component with sidebar
const DashboardLayout = ({ children }) => {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 bg-gray-50 overflow-x-hidden">
        {children}
      </div>
    </div>
  );
};

function App() {
  return (
    <ThemeProvider>
      <div className="App">
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/policies" element={<Policies />} />
            
            {/* Dashboard routes with sidebar */}
            <Route path="/dashboard" element={<DashboardLayout><EnhancedDashboard /></DashboardLayout>} />
            <Route path="/analysis" element={<DashboardLayout><Analysis /></DashboardLayout>} />
            <Route path="/reports" element={<DashboardLayout><Reports /></DashboardLayout>} />
            <Route path="/graph-report" element={<DashboardLayout><GraphReport /></DashboardLayout>} />
            <Route path="/site" element={<DashboardLayout><Site /></DashboardLayout>} />
            <Route path="/user" element={<DashboardLayout><User /></DashboardLayout>} />
            <Route path="/zone" element={<DashboardLayout><Zone /></DashboardLayout>} />
            <Route path="/maintenance" element={<DashboardLayout><Certificates /></DashboardLayout>} />
            <Route path="/certificates" element={<DashboardLayout><Certificates /></DashboardLayout>} />
            
            {/* Detailed monitoring pages */}
            <Route path="/flowmeter" element={<Flowmeter />} />
            <Route path="/water-level-recorder" element={<WaterLevelRecorder />} />
          </Routes>
          <Toaster richColors position="top-right" />
        </BrowserRouter>
      </div>
    </ThemeProvider>
  );
}

export default App;
