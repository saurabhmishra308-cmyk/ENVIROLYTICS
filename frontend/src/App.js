import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Policies from "./pages/Policies";
import EnhancedDashboard from "./pages/EnhancedDashboard";
import Flowmeter from "./pages/Flowmeter";
import WaterLevelRecorder from "./pages/WaterLevelRecorder";

function App() {
  return (
    <ThemeProvider>
      <div className="App">
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/policies" element={<Policies />} />
            <Route path="/dashboard" element={<EnhancedDashboard />} />
            <Route path="/flowmeter" element={<Flowmeter />} />
            <Route path="/water-level-recorder" element={<WaterLevelRecorder />} />
          </Routes>
        </BrowserRouter>
      </div>
    </ThemeProvider>
  );
}

export default App;
