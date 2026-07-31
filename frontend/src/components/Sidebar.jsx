import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { isAdmin } from '../mockData';
import api from '../lib/api';
import { 
  LayoutDashboard, 
  BarChart3, 
  FileText, 
  TrendingUp,
  MapPin,
  Users,
  Award,
  History,
  Cpu,
  Droplets,
  Building2,
  ChevronRight
} from 'lucide-react';

const Sidebar = () => {
  const location = useLocation();
  const { isDarkMode } = useTheme();
  const admin = isAdmin();
  const [wqAllowed, setWqAllowed] = useState(admin);

  // Ask the backend if the current user has water-quality permission.
  // Admins always pass. Clients only see the tab when explicitly granted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/water-quality/me/permission');
        if (!cancelled) setWqAllowed(!!data?.view_water_quality);
      } catch (e) {
        if (!cancelled) setWqAllowed(admin);
      }
    })();
    return () => { cancelled = true; };
  }, [admin]);

  const baseMenu = [
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/analysis', icon: BarChart3, label: 'Analysis' },
    { path: '/reports', icon: FileText, label: 'Reports' },
    { path: '/graph-report', icon: TrendingUp, label: 'Graph Report' },
    { path: '/site', icon: MapPin, label: 'Site' },
    { path: '/user', icon: Users, label: 'User' },
    { path: '/certificates', icon: Award, label: 'Certificate & Photos' },
    { path: '/audit-log', icon: History, label: 'Instrument Report' },
    { path: '/customer-profile', icon: Building2, label: 'Customer Profile' },
  ];
  if (wqAllowed) {
    baseMenu.push({ path: '/water-quality', icon: Droplets, label: 'Water Quality' });
  }
  const menuItems = admin
    ? [...baseMenu, { path: '/instruments', icon: Cpu, label: 'Instruments' }]
    : baseMenu;

  const isActive = (path) => location.pathname === path;

  return (
    <div 
      className="w-64 min-h-screen flex flex-col"
      style={{ backgroundColor: isDarkMode ? '#2d3748' : '#4a5568' }}
    >
      {/* Logo Section */}
      <div className="p-6 border-b border-gray-600">
        <div className="flex items-center gap-2">
          <div className="text-2xl font-bold text-lime-400">═</div>
          <div>
            <h1 className="text-white font-bold text-lg">ENVIROLYTICS</h1>
            <p className="text-gray-400 text-xs">MONITORING</p>
          </div>
        </div>
      </div>

      {/* Menu Items */}
      <nav className="flex-1 py-4">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          
          return (
            <Link
              key={item.path}
              to={item.path}
              data-testid={`sidebar-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              className={`flex items-center justify-between px-6 py-3 transition-all ${
                active
                  ? 'bg-gray-700 border-l-4 border-lime-400 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5" />
                <span className="font-medium">{item.label}</span>
              </div>
              <ChevronRight className="h-4 w-4" />
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-600 text-center">
        <p className="text-xs text-gray-400">© Envirolytics Sustainability</p>
      </div>
    </div>
  );
};

export default Sidebar;
