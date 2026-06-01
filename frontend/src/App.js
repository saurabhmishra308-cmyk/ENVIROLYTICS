import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
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
import Maintenance from "./pages/Maintenance";
import Sidebar from "./components/Sidebar";

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
            <Route path="/register" element={<Register />} />
            <Route path="/policies" element={<Policies />} />
            
            {/* Dashboard routes with sidebar */}
            <Route path="/dashboard" element={<DashboardLayout><EnhancedDashboard /></DashboardLayout>} />
            <Route path="/analysis" element={<DashboardLayout><Analysis /></DashboardLayout>} />
            <Route path="/reports" element={<DashboardLayout><Reports /></DashboardLayout>} />
            <Route path="/graph-report" element={<DashboardLayout><GraphReport /></DashboardLayout>} />
            <Route path="/site" element={<DashboardLayout><Site /></DashboardLayout>} />
            <Route path="/user" element={<DashboardLayout><User /></DashboardLayout>} />
            <Route path="/zone" element={<DashboardLayout><Zone /></DashboardLayout>} />
            <Route path="/maintenance" element={<DashboardLayout><Maintenance /></DashboardLayout>} />
            
            {/* Detailed monitoring pages */}
            <Route path="/flowmeter" element={<Flowmeter />} />
            <Route path="/water-level-recorder" element={<WaterLevelRecorder />} />
          </Routes>
        </BrowserRouter>
      </div>
    </ThemeProvider>
  );
}

export default App;
