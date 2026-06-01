// Mock authentication module
// SECURITY WARNING: This is for DEMO/DEVELOPMENT ONLY!
// 
// For production, implement:
// 1. Backend authentication server
// 2. Secure HTTP-only cookies for tokens
// 3. Password hashing (bcrypt/argon2)
// 4. CSRF protection
// 5. Rate limiting
// 6. 2FA/MFA

// NEVER hardcode credentials in production code
// Use environment variables or secure vaults
export const mockUsers = [
  {
    id: 'user_1',
    username: process.env.REACT_APP_DEMO_USER || 'demo',
    password: process.env.REACT_APP_DEMO_PASS || 'demo123',
    email: 'demo@envirolytics.com',
    fullName: 'Demo User'
  },
  {
    id: 'user_2',
    username: 'admin',
    password: 'admin123', // Demo only - use secure backend auth in production
    email: 'admin@envirolytics.com',
    fullName: 'Admin User'
  }
];

// SECURITY: localStorage is vulnerable to XSS attacks
// In production:
// - Use secure, HTTP-only cookies
// - Store tokens server-side
// - Implement token refresh mechanisms
// - Never store passwords
export const mockLogin = (username, password) => {
  const user = mockUsers.find(
    u => u.username === username && u.password === password
  );
  
  if (user) {
    const token = btoa(JSON.stringify({ id: user.id, username: user.username }));
    
    // INSECURE: Only for demo purposes
    try {
      localStorage.setItem('asterflow_token', token);
      localStorage.setItem('asterflow_user', JSON.stringify({
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName
      }));
    } catch (error) {
      // Handle quota exceeded or storage errors
      return { success: false, message: 'Storage error' };
    }
    
    return { success: true, user };
  }
  
  return { success: false, message: 'Invalid username or password' };
};

export const mockRegister = (userData) => {
  const existingUser = mockUsers.find(u => u.username === userData.username);
  
  if (existingUser) {
    return { success: false, message: 'Username already exists' };
  }
  
  const newUser = {
    id: `user_${Date.now()}`, // Better unique ID
    ...userData
  };
  
  mockUsers.push(newUser);
  
  const token = btoa(JSON.stringify({ id: newUser.id, username: newUser.username }));
  
  // INSECURE: Only for demo purposes
  try {
    localStorage.setItem('asterflow_token', token);
    localStorage.setItem('asterflow_user', JSON.stringify({
      id: newUser.id,
      username: newUser.username,
      email: newUser.email,
      fullName: newUser.fullName
    }));
  } catch (error) {
    return { success: false, message: 'Storage error' };
  }
  
  return { success: true, user: newUser };
};

export const mockLogout = () => {
  try {
    localStorage.removeItem('asterflow_token');
    localStorage.removeItem('asterflow_user');
  } catch (error) {
    // Silently fail if storage is unavailable
  }
};

export const isAuthenticated = () => {
  try {
    return localStorage.getItem('asterflow_token') !== null;
  } catch {
    return false;
  }
};

export const getCurrentUser = () => {
  try {
    const userStr = localStorage.getItem('asterflow_user');
    return userStr ? JSON.parse(userStr) : null;
  } catch {
    return null;
  }
};
