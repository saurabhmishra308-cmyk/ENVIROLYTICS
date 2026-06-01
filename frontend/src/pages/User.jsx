import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Users as UsersIcon, UserPlus, Shield, User as UserIcon } from 'lucide-react';

const User = () => {
  const users = [
    { id: 1, name: 'Admin User', email: 'admin@envirolytics.in', role: 'Admin', status: 'Active', lastLogin: '2026-06-01 10:30' },
    { id: 2, name: 'John Doe', email: 'john@client.com', role: 'Client', status: 'Active', lastLogin: '2026-06-01 09:15' },
    { id: 3, name: 'Jane Smith', email: 'jane@client.com', role: 'Client', status: 'Active', lastLogin: '2026-05-31 16:45' },
    { id: 4, name: 'Bob Wilson', email: 'bob@client.com', role: 'Client', status: 'Inactive', lastLogin: '2026-05-28 14:20' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-600 mt-1">Manage system users and permissions</p>
        </div>
        <Button style={{ backgroundColor: '#4a9fd8' }}>
          <UserPlus className="mr-2 h-4 w-4" />
          Add New User
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Users</p>
                <p className="text-3xl font-bold">4</p>
              </div>
              <UsersIcon className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Users</p>
                <p className="text-3xl font-bold text-green-600">3</p>
              </div>
              <UserIcon className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Admins</p>
                <p className="text-3xl font-bold text-purple-600">1</p>
              </div>
              <Shield className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Clients</p>
                <p className="text-3xl font-bold text-blue-600">3</p>
              </div>
              <UsersIcon className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-4 font-semibold">Name</th>
                  <th className="text-left p-4 font-semibold">Email</th>
                  <th className="text-left p-4 font-semibold">Role</th>
                  <th className="text-left p-4 font-semibold">Status</th>
                  <th className="text-left p-4 font-semibold">Last Login</th>
                  <th className="text-left p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b hover:bg-gray-50">
                    <td className="p-4 font-medium">{user.name}</td>
                    <td className="p-4 text-gray-600">{user.email}</td>
                    <td className="p-4">
                      <Badge className={user.role === 'Admin' ? 'bg-purple-500' : 'bg-blue-500'}>
                        {user.role}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <Badge className={user.status === 'Active' ? 'bg-green-500' : 'bg-gray-500'}>
                        {user.status}
                      </Badge>
                    </td>
                    <td className="p-4 text-sm text-gray-600">{user.lastLogin}</td>
                    <td className="p-4">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline">Edit</Button>
                        <Button size="sm" variant="outline" className="text-red-600 border-red-600">Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default User;
