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

// Removed TreeSvg — replaced with mountains & waterfall in the scene

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
      {/* Sky / sun + animated god-rays */}
      <div className="env-sun-rays" aria-hidden />
      <div className="env-sun" aria-hidden />

      {/* Rainbow appears after the storm */}
      <div className="env-rainbow" aria-hidden />

      {/* Clouds (air) — varied size/speed */}
      <div className="env-cloud" style={{ '--top': '8%',  '--dur': '55s', '--delay': '-5s',  '--w': '210px', '--h': '64px' }} aria-hidden />
      <div className="env-cloud" style={{ '--top': '18%', '--dur': '70s', '--delay': '-30s', '--w': '170px', '--h': '54px' }} aria-hidden />
      <div className="env-cloud" style={{ '--top': '28%', '--dur': '60s', '--delay': '-15s', '--w': '230px', '--h': '72px' }} aria-hidden />
      <div className="env-cloud" style={{ '--top': '5%',  '--dur': '85s', '--delay': '-50s', '--w': '150px', '--h': '46px' }} aria-hidden />

      {/* Birds — V-shape silhouettes flying across */}
      <div className="env-bird b1" aria-hidden />
      <div className="env-bird b2" aria-hidden />
      <div className="env-bird b3" aria-hidden />
      <div className="env-bird b4" aria-hidden />

      {/* Butterflies — zigzag flight near the meadow */}
      <div className="env-butterfly bf1" aria-hidden />
      <div className="env-butterfly bf2" aria-hidden />
      <div className="env-butterfly bf3" aria-hidden />

      {/* Floating leaves */}
      <div className="env-leaf l1" aria-hidden />
      <div className="env-leaf l2" aria-hidden />
      <div className="env-leaf l3" aria-hidden />
      <div className="env-leaf l4" aria-hidden />
      <div className="env-leaf l5" aria-hidden />

      {/* Fireflies — show during the dim/storm phase */}
      <div className="env-firefly f1" aria-hidden />
      <div className="env-firefly f2" aria-hidden />
      <div className="env-firefly f3" aria-hidden />
      <div className="env-firefly f4" aria-hidden />
      <div className="env-firefly f5" aria-hidden />

      {/* Air sparkles / pollen */}
      <div className="env-particle x1" aria-hidden />
      <div className="env-particle x2" aria-hidden />
      <div className="env-particle x3" aria-hidden />
      <div className="env-particle x4" aria-hidden />
      <div className="env-particle x5" aria-hidden />
      <div className="env-particle x6" aria-hidden />

      {/* Rainfall — fades in/out on the 24 s storyline cycle */}
      <div className="env-rain" aria-hidden>
        <div className="env-drop d1" /><div className="env-drop d2" /><div className="env-drop d3" />
        <div className="env-drop d4" /><div className="env-drop d5" /><div className="env-drop d6" />
        <div className="env-drop d7" /><div className="env-drop d8" /><div className="env-drop d9" />
        <div className="env-drop d10" /><div className="env-drop d11" /><div className="env-drop d12" />
        <div className="env-drop d13" /><div className="env-drop d14" /><div className="env-drop d15" />
        <div className="env-drop d16" /><div className="env-drop d17" /><div className="env-drop d18" />
        <div className="env-drop d19" /><div className="env-drop d20" /><div className="env-drop d21" />
        <div className="env-drop d22" /><div className="env-drop d23" /><div className="env-drop d24" />
        <div className="env-drop d25" /><div className="env-drop d26" /><div className="env-drop d27" />
        <div className="env-drop d28" /><div className="env-drop d29" /><div className="env-drop d30" />
        <div className="env-drop d31" /><div className="env-drop d32" />
      </div>

      {/* Mountain range with snow caps — far horizon, behind clouds-water */}
      <svg className="env-mountains" viewBox="0 0 1600 320" preserveAspectRatio="none" aria-hidden xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="mtnFar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#7c93b3" />
            <stop offset="100%" stopColor="#4d6184" />
          </linearGradient>
          <linearGradient id="mtnMid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#5d7a9f" />
            <stop offset="100%" stopColor="#36486a" />
          </linearGradient>
          <linearGradient id="mtnNear" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#48648d" />
            <stop offset="100%" stopColor="#283c5d" />
          </linearGradient>
        </defs>
        {/* far range */}
        <path d="M0 250 L120 160 L200 200 L320 110 L420 180 L560 130 L680 200 L820 90 L960 180 L1080 140 L1220 200 L1340 120 L1460 190 L1600 150 L1600 320 L0 320 Z" fill="url(#mtnFar)" opacity="0.85" />
        {/* mid range */}
        <path d="M0 270 L100 220 L210 260 L340 170 L460 240 L600 200 L740 260 L880 160 L1020 240 L1160 210 L1290 260 L1410 200 L1520 250 L1600 220 L1600 320 L0 320 Z" fill="url(#mtnMid)" />
        {/* near big mountain with snow cap & waterfall source */}
        <path d="M540 320 L640 230 L720 130 L780 70 L840 130 L920 230 L1020 320 Z" fill="url(#mtnNear)" />
        {/* snow cap on the tall mountain */}
        <path d="M740 130 L780 70 L820 120 L800 130 L788 120 L770 130 L755 122 Z" fill="#f6fbff" />
        <path d="M740 130 L755 122 L770 130 L780 124 L788 132 L800 128 L820 120 L815 134 L800 142 L785 138 L772 144 L760 138 L748 142 Z" fill="#dfeaf6" opacity="0.6" />
        {/* second smaller snow cap */}
        <path d="M640 230 L660 215 L680 222 L700 210 L720 228 Z" fill="#eef4fb" />
      </svg>

      {/* Waterfall — cascading down from the tall mountain */}
      <div className="env-waterfall" aria-hidden>
        <span className="env-fall-stream s1" />
        <span className="env-fall-stream s2" />
        <span className="env-fall-stream s3" />
        <span className="env-fall-mist" />
      </div>

      {/* River — connects waterfall to foreground water */}
      <div className="env-river" aria-hidden />

      {/* Storm darkening overlay (under the rain but above the sky) */}
      <div className="env-storm-overlay" aria-hidden />
      {/* Occasional lightning flash */}
      <div className="env-lightning" aria-hidden />

      {/* Ground band: soil → grass → many plants → wind farm → water */}
      <div className="env-soil" aria-hidden />
      <div className="env-grass" aria-hidden />
      <div className="env-grass-back" aria-hidden />

      {/* Wind farm — 3 turbines of varying size, prominent against the meadow */}
      <div className="env-windmill wm1" aria-hidden>
        <div className="env-wm-tower" />
        <div className="env-wm-blades"><span /><span /><span /></div>
      </div>
      <div className="env-windmill wm2" aria-hidden>
        <div className="env-wm-tower" />
        <div className="env-wm-blades"><span /><span /><span /></div>
      </div>
      <div className="env-windmill wm3" aria-hidden>
        <div className="env-wm-tower" />
        <div className="env-wm-blades"><span /><span /><span /></div>
      </div>

      {/* Solar panels — additional eco touch */}
      <div className="env-solar" aria-hidden>
        <span /><span /><span />
      </div>

      {/* Plants — many more, growing slightly bigger after rain (no trees) */}
      <div className="env-plant p1" aria-hidden><PlantSvg /></div>
      <div className="env-plant p2" aria-hidden><PlantSvg /></div>
      <div className="env-plant p3" aria-hidden><PlantSvg /></div>
      <div className="env-plant p4" aria-hidden><PlantSvg /></div>
      <div className="env-plant p5" aria-hidden><PlantSvg /></div>
      <div className="env-plant p6" aria-hidden><PlantSvg /></div>
      <div className="env-plant p7" aria-hidden><PlantSvg /></div>
      <div className="env-plant p8" aria-hidden><PlantSvg /></div>

      <div className="env-water" aria-hidden>
        <div className="env-water-band"    />
        <div className="env-water-band w2" />
      </div>
      {/* Horizontal flowing water on top of the wave band */}
      <div className="env-water-flow" aria-hidden />

      {/* Expanding water ripples */}
      <div className="env-ripple r1" aria-hidden />
      <div className="env-ripple r2" aria-hidden />
      <div className="env-ripple r3" aria-hidden />
      <div className="env-ripple r4" aria-hidden />
      <div className="env-ripple r5" aria-hidden />
      <div className="env-ripple r6" aria-hidden />

      {/* Fish that leap from the water on the cycle */}
      <div className="env-fish fi1" aria-hidden />
      <div className="env-fish fi2" aria-hidden />
      <div className="env-fish fi3" aria-hidden />

      {/* Foreground login card */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div
            className="env-login-card"
            data-testid="login-card"
          >
            <div className="text-center mb-8 relative z-[1]">
              <div className="mb-4">
                <h1 className="env-brand text-2xl" style={{ color: '#4a9fd8' }}>ENVIROLYTICS</h1>
                <p className="env-brand-sub text-white text-[10px] font-light mt-1" style={{ opacity: 0.7 }}>SUSTAINABILITY  ·  PRIVATE  ·  LIMITED</p>
              </div>
            </div>

            <h2 className="text-white text-center text-lg mb-6 font-medium relative z-[1] tracking-normal">Sign in to your account</h2>

            {error && (
              <div className="bg-red-500/95 text-white text-sm px-4 py-2 rounded mb-4 text-center relative z-[1] shadow-lg" data-testid="login-error">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="relative z-[1]">
              <div className="mb-4">
                <Label htmlFor="email" className="text-white/90 text-xs uppercase tracking-wider mb-2 block font-semibold">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-md"
                  placeholder="admin@envirolytics.com"
                  data-testid="login-email-input"
                  autoComplete="email"
                />
              </div>

              <div className="mb-6">
                <Label htmlFor="password" className="text-white/90 text-xs uppercase tracking-wider mb-2 block font-semibold">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-md"
                  placeholder="••••••••"
                  data-testid="login-password-input"
                  autoComplete="current-password"
                />
              </div>

              <div className="flex justify-center mb-4">
                <Button
                  type="submit"
                  disabled={submitting}
                  className="env-submit text-white disabled:opacity-60"
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

            <div className="text-center mb-3 relative z-[1]">
              <Link to="/policies" className="text-white/85 text-sm inline-flex items-center gap-1 hover:text-white hover:underline transition-colors">
                <FileText size={14} /> Policies
              </Link>
            </div>

            <div className="text-center text-gray-400/80 text-[11px] tracking-wider relative z-[1]">VERSION 1.0  ·  SECURE LOGIN</div>
          </div>
          <p className="mt-4 text-center text-[11px] text-gray-700/70 tracking-wide font-medium">
            Real-time monitoring for soil  ·  water  ·  air  ·  biodiversity
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
