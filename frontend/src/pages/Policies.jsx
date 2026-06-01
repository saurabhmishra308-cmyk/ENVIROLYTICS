import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/button';

const Policies = () => {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#e8e8e8' }}>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="bg-white rounded-lg shadow-lg p-8">
          {/* Header */}
          <div className="mb-6">
            <Link to="/">
              <Button variant="ghost" className="mb-4 -ml-4">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Login
              </Button>
            </Link>
            <div className="text-center">
              <h1 className="text-3xl font-bold mb-2" style={{ color: '#5c5c5c' }}>ASTER TECHNOLOGIES</h1>
              <h2 className="text-2xl font-semibold mb-4" style={{ color: '#a5b744' }}>Policies & Terms</h2>
            </div>
          </div>

          {/* Policies Content */}
          <div className="space-y-6 text-gray-700">
            <section>
              <h3 className="text-xl font-semibold mb-3" style={{ color: '#5c5c5c' }}>Privacy Policy</h3>
              <p className="mb-2">
                At Aster Technologies, we are committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Flow Monitor service.
              </p>
              <p>
                We collect information that you provide directly to us, including personal information such as your name, email address, and account credentials. We use this information to provide, maintain, and improve our services.
              </p>
            </section>

            <section>
              <h3 className="text-xl font-semibold mb-3" style={{ color: '#5c5c5c' }}>Data Collection</h3>
              <ul className="list-disc list-inside space-y-2">
                <li>Account information (username, email, password)</li>
                <li>Usage data and analytics</li>
                <li>Device and browser information</li>
                <li>Log files and cookies</li>
              </ul>
            </section>

            <section>
              <h3 className="text-xl font-semibold mb-3" style={{ color: '#5c5c5c' }}>Terms of Service</h3>
              <p className="mb-2">
                By accessing and using the Embark Flow Monitor service, you accept and agree to be bound by the terms and provision of this agreement.
              </p>
              <p className="mb-2">
                You are responsible for maintaining the confidentiality of your account and password. You agree to accept responsibility for all activities that occur under your account.
              </p>
            </section>

            <section>
              <h3 className="text-xl font-semibold mb-3" style={{ color: '#5c5c5c' }}>User Responsibilities</h3>
              <ul className="list-disc list-inside space-y-2">
                <li>Maintain the security of your account credentials</li>
                <li>Use the service in compliance with applicable laws</li>
                <li>Not attempt to gain unauthorized access to any systems</li>
                <li>Not use the service for any illegal or unauthorized purpose</li>
              </ul>
            </section>

            <section>
              <h3 className="text-xl font-semibold mb-3" style={{ color: '#5c5c5c' }}>Data Security</h3>
              <p>
                We implement appropriate technical and organizational security measures to protect your personal information. However, no method of transmission over the Internet or electronic storage is 100% secure.
              </p>
            </section>

            <section>
              <h3 className="text-xl font-semibold mb-3" style={{ color: '#5c5c5c' }}>Contact Information</h3>
              <p>
                If you have any questions about these Policies, please contact us at:
              </p>
              <p className="mt-2">
                <strong>Aster Technologies</strong><br />
                Email: support@asterflow.com<br />
                Website: www.asterflow.com
              </p>
            </section>

            <div className="mt-8 pt-6 border-t border-gray-300 text-sm text-gray-600 text-center">
              Last Updated: January 2025 | Version 1.0
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Policies;
