import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Wrench, AlertCircle, CheckCircle, Clock, Calendar } from 'lucide-react';

const Maintenance = () => {
  const maintenanceRecords = [
    { id: 1, equipment: 'Flowmeter FM-001', type: 'Calibration', status: 'Pending', priority: 'High', date: '2026-06-05', assignedTo: 'Tech Team A' },
    { id: 2, equipment: 'DWLR BW-01', type: 'Inspection', status: 'In Progress', priority: 'Medium', date: '2026-06-03', assignedTo: 'Tech Team B' },
    { id: 3, equipment: 'pH Sensor PS-12', type: 'Replacement', status: 'Completed', priority: 'High', date: '2026-05-28', assignedTo: 'Tech Team A' },
    { id: 4, equipment: 'TDS Meter TM-05', type: 'Cleaning', status: 'Scheduled', priority: 'Low', date: '2026-06-10', assignedTo: 'Tech Team C' },
    { id: 5, equipment: 'Conductivity Meter CM-03', type: 'Calibration', status: 'Completed', priority: 'Medium', date: '2026-05-30', assignedTo: 'Tech Team B' },
  ];

  const getStatusIcon = (status) => {
    switch (status) {
      case 'Completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'In Progress':
        return <Clock className="h-5 w-5 text-blue-500" />;
      case 'Pending':
        return <AlertCircle className="h-5 w-5 text-yellow-500" />;
      default:
        return <Calendar className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusBadge = (status) => {
    const colors = {
      'Completed': 'bg-green-500',
      'In Progress': 'bg-blue-500',
      'Pending': 'bg-yellow-500',
      'Scheduled': 'bg-gray-500'
    };
    return <Badge className={colors[status] || 'bg-gray-500'}>{status}</Badge>;
  };

  const getPriorityBadge = (priority) => {
    const colors = {
      'High': 'bg-red-500',
      'Medium': 'bg-orange-500',
      'Low': 'bg-blue-500'
    };
    return <Badge className={colors[priority]}>{priority}</Badge>;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Maintenance</h1>
          <p className="text-gray-600 mt-1">Equipment maintenance schedule and history</p>
        </div>
        <Button style={{ backgroundColor: '#4a9fd8' }}>
          <Wrench className="mr-2 h-4 w-4" />
          Schedule Maintenance
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Tasks</p>
                <p className="text-3xl font-bold">15</p>
              </div>
              <Wrench className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Pending</p>
                <p className="text-3xl font-bold text-yellow-600">3</p>
              </div>
              <AlertCircle className="h-8 w-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">In Progress</p>
                <p className="text-3xl font-bold text-blue-600">2</p>
              </div>
              <Clock className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Completed</p>
                <p className="text-3xl font-bold text-green-600">10</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Maintenance Table */}
      <Card>
        <CardHeader>
          <CardTitle>Maintenance Records</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-4 font-semibold">Equipment</th>
                  <th className="text-left p-4 font-semibold">Type</th>
                  <th className="text-left p-4 font-semibold">Status</th>
                  <th className="text-left p-4 font-semibold">Priority</th>
                  <th className="text-left p-4 font-semibold">Date</th>
                  <th className="text-left p-4 font-semibold">Assigned To</th>
                  <th className="text-left p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {maintenanceRecords.map((record) => (
                  <tr key={record.id} className="border-b hover:bg-gray-50">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(record.status)}
                        <span className="font-medium">{record.equipment}</span>
                      </div>
                    </td>
                    <td className="p-4 text-gray-600">{record.type}</td>
                    <td className="p-4">{getStatusBadge(record.status)}</td>
                    <td className="p-4">{getPriorityBadge(record.priority)}</td>
                    <td className="p-4 text-sm text-gray-600">{record.date}</td>
                    <td className="p-4 text-sm text-gray-600">{record.assignedTo}</td>
                    <td className="p-4">
                      <Button size="sm" variant="outline">View Details</Button>
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

export default Maintenance;
