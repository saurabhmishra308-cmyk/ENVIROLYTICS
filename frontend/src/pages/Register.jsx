import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { mockRegister, isAuthenticated } from '../mockData';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { FileText } from 'lucide-react';

const Register = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    email: '',
    fullName: ''
  });
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/dashboard');
    }
  }, [navigate]);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!formData.username || !formData.password || !formData.email || !formData.fullName) {
      setError('Please fill in all fields');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    const result = mockRegister({
      username: formData.username,
      password: formData.password,
      email: formData.email,
      fullName: formData.fullName
    });
    
    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-8" style={{ backgroundColor: '#f5f5f5' }}>
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
          <h2 className="text-white text-center text-lg mb-6">Create your account!</h2>

          {/* Error Message */}
          {error && (
            <div className="bg-red-500 text-white text-sm px-4 py-2 rounded mb-4 text-center">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <Label htmlFor="fullName" className="text-white text-sm mb-2 block">
                Full Name
              </Label>
              <Input
                id="fullName"
                name="fullName"
                type="text"
                value={formData.fullName}
                onChange={handleChange}
                className="w-full bg-white border-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-sm"
              />
            </div>

            <div className="mb-4">
              <Label htmlFor="email" className="text-white text-sm mb-2 block">
                Email
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                className="w-full bg-white border-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-sm"
              />
            </div>

            <div className="mb-4">
              <Label htmlFor="username" className="text-white text-sm mb-2 block">
                Username
              </Label>
              <Input
                id="username"
                name="username"
                type="text"
                value={formData.username}
                onChange={handleChange}
                className="w-full bg-white border-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-sm"
              />
            </div>

            <div className="mb-4">
              <Label htmlFor="password" className="text-white text-sm mb-2 block">
                Password
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                className="w-full bg-white border-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-sm"
              />
            </div>

            <div className="mb-6">
              <Label htmlFor="confirmPassword" className="text-white text-sm mb-2 block">
                Confirm Password
              </Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange}
                className="w-full bg-white border-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-sm"
              />
            </div>

            <div className="flex justify-center mb-4">
              <Button
                type="submit"
                className="px-8 py-2 rounded-sm text-white font-medium hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#f5a623' }}
              >
                Sign Up
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

          {/* Sign In Link */}
          <div className="text-center text-white text-sm mb-6">
            Already have an account?{' '}
            <Link to="/" className="underline hover:text-gray-300">
              Sign in
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

export default Register;
