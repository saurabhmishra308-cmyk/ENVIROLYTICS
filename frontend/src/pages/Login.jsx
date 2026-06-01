import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { mockLogin, isAuthenticated } from '../mockData';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { FileText } from 'lucide-react';

const Login = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/dashboard');
    }
  }, [navigate]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError('Please fill in all fields');
      return;
    }

    const result = mockLogin(username, password);
    
    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f5f5f5' }}>
      <div className="w-full max-w-md">
        <div className="rounded-lg shadow-2xl p-8" style={{ backgroundColor: '#1a2332' }}>
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="mb-4">
              <h1 className="text-white font-bold text-2xl tracking-wide" style={{ color: '#4a9fd8' }}>ENVIROLYTICS</h1>
              <p className="text-white text-[10px] tracking-wider font-light" style={{ opacity: 0.8 }}>SUSTAINABILITY PRIVATE LIMITED</p>
            </div>
          </div>

          {/* Title */}
          <h2 className="text-white text-center text-lg mb-6">Sign in to your account!</h2>

          {/* Error Message */}
          {error && (
            <div className="bg-red-500 text-white text-sm px-4 py-2 rounded mb-4 text-center">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <Label htmlFor="username" className="text-white text-sm mb-2 block">
                Username
              </Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white border-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-sm"
                placeholder=""
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
              />
            </div>

            <div className="flex justify-center mb-4">
              <Button
                type="submit"
                className="px-8 py-2 rounded-sm text-white font-medium hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#f5a623' }}
              >
                Sign Me In
              </Button>
            </div>
          </form>

          {/* Policies Link */}
          <div className="text-center mb-4">
            <Link
              to="/policies"
              className="text-white text-sm inline-flex items-center gap-1 hover:underline"
            >
              <FileText size={14} />
              Policies
            </Link>
          </div>

          {/* Sign Up Link */}
          <div className="text-center text-white text-sm mb-6">
            Don't have an account?{' '}
            <Link to="/register" className="underline hover:text-gray-300">
              Sign up
            </Link>
          </div>

          {/* Version */}
          <div className="text-center text-gray-400 text-xs">
            version 1.0
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
