import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { loginWithEmail, isAuthenticated } from '../mockData';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { FileText, Loader2 } from 'lucide-react';

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
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f5f5f5' }}>
      <div className="w-full max-w-md">
        <div className="rounded-lg shadow-2xl p-8" style={{ backgroundColor: '#1a2332' }} data-testid="login-card">
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
              <Label htmlFor="email" className="text-white text-sm mb-2 block">
                Email
              </Label>
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
              <Label htmlFor="password" className="text-white text-sm mb-2 block">
                Password
              </Label>
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
      </div>
    </div>
  );
};

export default Login;
