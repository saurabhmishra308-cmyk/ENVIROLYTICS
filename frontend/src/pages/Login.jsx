import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { loginWithEmail, isAuthenticated } from '../mockData';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { FileText, Loader2 } from 'lucide-react';
import '../styles/login-scene.css';

// Compact potted-plant SVG used 4 times across the scene
const PlantSvg = () => (
  <svg viewBox="0 0 70 100" xmlns="http://www.w3.org/2000/svg" width="70" height="100" aria-hidden>
    <path d="M18 80 L52 80 L48 100 L22 100 Z" fill="#7c5a36" />
    <rect x="16" y="76" width="38" height="6" rx="2" fill="#5d4225" />
    <path d="M35 78 C 35 65, 35 50, 35 35" stroke="#3d7a2a" strokeWidth="3" fill="none" strokeLinecap="round" />
    <ellipse cx="22" cy="55" rx="14" ry="6" fill="#5fa14a" transform="rotate(-30 22 55)" />
    <ellipse cx="48" cy="50" rx="14" ry="6" fill="#6cb24a" transform="rotate(30 48 50)" />
    <ellipse cx="20" cy="40" rx="12" ry="5" fill="#7ab050" transform="rotate(-25 20 40)" />
    <ellipse cx="50" cy="35" rx="12" ry="5" fill="#4f8b3f" transform="rotate(28 50 35)" />
    <ellipse cx="35" cy="25" rx="9" ry="11" fill="#5fa14a" />
  </svg>
);

const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/dashboard');
    }
    // `isAuthenticated` is a stable import (module-level function), safe to omit.
    // `navigate` is stable per react-router. Effect only needs to run once on mount.
  }, [navigate]);

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }
    setSubmitting(true);
    const result = await loginWithEmail(email.trim().toLowerCase(), password);
    setSubmitting(false);
    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.message);
    }
  };

  return (
    <div className="env-scene" data-testid="login-scene">
      {/* Sky / sun */}
      <div className="env-sun" aria-hidden />

      {/* Clouds (air) */}
      <div className="env-cloud" style={{ '--top': '8%',  '--dur': '55s', '--delay': '-5s'  }} aria-hidden />
      <div className="env-cloud" style={{ '--top': '18%', '--dur': '70s', '--delay': '-30s' }} aria-hidden />
      <div className="env-cloud" style={{ '--top': '28%', '--dur': '60s', '--delay': '-15s' }} aria-hidden />

      {/* Floating leaves */}
      <div className="env-leaf l1" aria-hidden />
      <div className="env-leaf l2" aria-hidden />
      <div className="env-leaf l3" aria-hidden />
      <div className="env-leaf l4" aria-hidden />
      <div className="env-leaf l5" aria-hidden />

      {/* Air sparkles / pollen */}
      <div className="env-particle x1" aria-hidden />
      <div className="env-particle x2" aria-hidden />
      <div className="env-particle x3" aria-hidden />
      <div className="env-particle x4" aria-hidden />
      <div className="env-particle x5" aria-hidden />
      <div className="env-particle x6" aria-hidden />

      {/* Ground band: soil → grass → plants → water */}
      <div className="env-soil" aria-hidden />
      <div className="env-grass" aria-hidden />
      <div className="env-plant p1" aria-hidden><PlantSvg /></div>
      <div className="env-plant p2" aria-hidden><PlantSvg /></div>
      <div className="env-plant p3" aria-hidden><PlantSvg /></div>
      <div className="env-plant p4" aria-hidden><PlantSvg /></div>
      <div className="env-water" aria-hidden>
        <div className="env-water-band"    />
        <div className="env-water-band w2" />
      </div>

      {/* Foreground login card */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div
            className="rounded-2xl shadow-2xl p-8 backdrop-blur-sm"
            style={{ backgroundColor: 'rgba(26, 35, 50, 0.92)' }}
            data-testid="login-card"
          >
            <div className="text-center mb-8">
              <div className="mb-4">
                <h1 className="text-white font-bold text-2xl tracking-wide" style={{ color: '#4a9fd8' }}>ENVIROLYTICS</h1>
                <p className="text-white text-[10px] tracking-wider font-light" style={{ opacity: 0.8 }}>SUSTAINABILITY PRIVATE LIMITED</p>
              </div>
            </div>

            <h2 className="text-white text-center text-lg mb-6">Sign in to your account!</h2>

            {error && (
              <div className="bg-red-500 text-white text-sm px-4 py-2 rounded mb-4 text-center" data-testid="login-error">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <Label htmlFor="email" className="text-white text-sm mb-2 block">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white border-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-sm"
                  placeholder="admin@envirolytics.com"
                  data-testid="login-email-input"
                  autoComplete="email"
                />
              </div>

              <div className="mb-6">
                <Label htmlFor="password" className="text-white text-sm mb-2 block">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white border-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-sm"
                  placeholder=""
                  data-testid="login-password-input"
                  autoComplete="current-password"
                />
              </div>

              <div className="flex justify-center mb-4">
                <Button
                  type="submit"
                  disabled={submitting}
                  className="px-8 py-2 rounded-sm text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
                  style={{ backgroundColor: '#f5a623' }}
                  data-testid="login-submit-button"
                >
                  {submitting ? (
                    <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Signing in…</span>
                  ) : (
                    'Sign Me In'
                  )}
                </Button>
              </div>
            </form>

            <div className="text-center mb-4">
              <Link to="/policies" className="text-white text-sm inline-flex items-center gap-1 hover:underline">
                <FileText size={14} /> Policies
              </Link>
            </div>

            <div className="text-center text-gray-400 text-xs">version 1.0</div>
          </div>
          <p className="mt-4 text-center text-[11px] text-gray-600 tracking-wide">
            Real-time monitoring for soil · water · air · biodiversity
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
