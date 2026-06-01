// Mock data for Asterflow clone

export const mockUsers = [
  {
    id: 1,
    username: 'demo',
    password: 'demo123',
    email: 'demo@asterflow.com',
    fullName: 'Demo User'
  },
  {
    id: 2,
    username: 'admin',
    password: 'admin123',
    email: 'admin@asterflow.com',
    fullName: 'Admin User'
  }
];

// Mock authentication functions
export const mockLogin = (username, password) => {
  const user = mockUsers.find(
    u => u.username === username && u.password === password
  );
  
  if (user) {
    const token = btoa(JSON.stringify({ id: user.id, username: user.username }));
    localStorage.setItem('asterflow_token', token);
    localStorage.setItem('asterflow_user', JSON.stringify({
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName
    }));
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
    id: mockUsers.length + 1,
    ...userData
  };
  
  mockUsers.push(newUser);
  
  const token = btoa(JSON.stringify({ id: newUser.id, username: newUser.username }));
  localStorage.setItem('asterflow_token', token);
  localStorage.setItem('asterflow_user', JSON.stringify({
    id: newUser.id,
    username: newUser.username,
    email: newUser.email,
    fullName: newUser.fullName
  }));
  
  return { success: true, user: newUser };
};

export const mockLogout = () => {
  localStorage.removeItem('asterflow_token');
  localStorage.removeItem('asterflow_user');
};

export const isAuthenticated = () => {
  return localStorage.getItem('asterflow_token') !== null;
};

export const getCurrentUser = () => {
  const userStr = localStorage.getItem('asterflow_user');
  return userStr ? JSON.parse(userStr) : null;
};
