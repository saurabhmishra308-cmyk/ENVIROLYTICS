import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Download, FileText, Calendar } from 'lucide-react';

const Reports = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('monthly');

  const reports = [
    { id: 1, name: 'Monthly Flow Report', date: '2026-05-31', type: 'Flow Data', size: '2.4 MB' },
    { id: 2, name: 'Water Quality Analysis', date: '2026-05-31', type: 'Quality', size: '1.8 MB' },
    { id: 3, name: 'Compliance Report', date: '2026-05-31', type: 'Compliance', size: '3.2 MB' },
    { id: 4, name: 'Equipment Status', date: '2026-05-30', type: 'Maintenance', size: '1.1 MB' },
    { id: 5, name: 'Energy Consumption', date: '2026-05-29', type: 'Energy', size: '2.0 MB' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-600 mt-1">Download and view system reports</p>
        </div>
        <Button style={{ backgroundColor: '#4a9fd8' }}>
          <FileText className="mr-2 h-4 w-4" />
          Generate New Report
        </Button>
      </div>

      {/* Period Selection */}
      <div className="flex gap-2">
        {['daily', 'weekly', 'monthly', 'yearly'].map((period) => (
          <Button
            key={period}
            variant={selectedPeriod === period ? 'default' : 'outline'}
            onClick={() => setSelectedPeriod(period)}
            style={{ 
              backgroundColor: selectedPeriod === period ? '#4a9fd8' : 'transparent',
              color: selectedPeriod === period ? 'white' : '#4a9fd8'
            }}
          >
            {period.charAt(0).toUpperCase() + period.slice(1)}
          </Button>
        ))}
      </div>

      {/* Reports Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.map((report) => (
          <Card key={report.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <FileText className="h-8 w-8" style={{ color: '#4a9fd8' }} />
                <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">
                  {report.type}
                </span>
              </div>
              <CardTitle className="text-lg mt-2">{report.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center text-sm text-gray-600">
                  <Calendar className="h-4 w-4 mr-2" />
                  {report.date}
                </div>
                <div className="flex items-center justify-between mt-4">
                  <span className="text-xs text-gray-500">{report.size}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" style={{ borderColor: '#4a9fd8', color: '#4a9fd8' }}>
                      <Download className="h-4 w-4 mr-1" />
                      CSV
                    </Button>
                    <Button size="sm" style={{ backgroundColor: '#4a9fd8' }}>
                      <Download className="h-4 w-4 mr-1" />
                      PDF
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Report Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <p className="text-3xl font-bold text-blue-600">24</p>
              <p className="text-sm text-gray-600">Reports Generated</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <p className="text-3xl font-bold text-green-600">156</p>
              <p className="text-sm text-gray-600">Total Downloads</p>
            </div>
            <div className="text-center p-4 bg-amber-50 rounded-lg">
              <p className="text-3xl font-bold text-amber-600">12.4 MB</p>
              <p className="text-sm text-gray-600">Total Size</p>
            </div>
            <div className="text-center p-4 bg-purple-50 rounded-lg">
              <p className="text-3xl font-bold text-purple-600">98%</p>
              <p className="text-sm text-gray-600">Compliance Rate</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Reports;
