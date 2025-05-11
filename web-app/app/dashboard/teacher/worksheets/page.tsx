'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { worksheetAPI } from '@/lib/api';
import { Worksheet } from '@/lib/api';

export default function WorksheetsPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [worksheets, setWorksheets] = useState<Worksheet[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [selectedDate, setSelectedDate] = useState<string>('');

    useEffect(() => {
        const fetchWorksheets = async () => {
            setIsLoading(true);
            try {
                // For simplicity, we're just fetching worksheets from a single class
                // In a real app, you'd fetch based on user role and permissions
                const worksheetsData = await worksheetAPI.getWorksheetsByClass('1025d255-a661-4a56-9876-7eac665c6ee1');
                setWorksheets(worksheetsData);
            } catch (error) {
                console.error('Error fetching worksheets:', error);
            } finally {
                setIsLoading(false);
            }
        };

        if (user) {
            fetchWorksheets();
        }
    }, [user]);

    const handleUploadClick = () => {
        const basePath = user?.role === 'TEACHER' ? '/dashboard/teacher' : '/dashboard/superadmin';
        router.push(`${basePath}/worksheets/upload`);
    };

    const handleViewWorksheet = (id: string) => {
        const basePath = user?.role === 'TEACHER' ? '/dashboard/teacher' : '/dashboard/superadmin';
        router.push(`${basePath}/worksheets/${id}`);
    };

    // Add filter handlers
    const handleClassFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedClass(e.target.value);
        // Implement actual filtering logic here
    };

    const handleDateFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedDate(e.target.value);
        // Implement actual filtering logic here
    };

    if (isLoading) {
        return <div>Loading worksheets...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Worksheets</h1>
                <Button onClick={handleUploadClick}>Upload Worksheet</Button>
            </div>

            {/* Filters */}
            <Card>
                <CardHeader>
                    <CardTitle>Filters</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="w-full md:w-auto">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
                            <select
                                className="w-full rounded-md border border-gray-300 p-2 text-sm"
                                value={selectedClass}
                                onChange={handleClassFilterChange}
                            >
                                <option value="">All Classes</option>
                                <option value="1025d255-a661-4a56-9876-7eac665c6ee1">Math 101</option>
                                <option value="ac8a86ea-6f20-4f74-bf6a-791768947829">Science 101</option>
                            </select>
                        </div>
                        <div className="w-full md:w-auto">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                            <select
                                className="w-full rounded-md border border-gray-300 p-2 text-sm"
                                value={selectedDate}
                                onChange={handleDateFilterChange}
                            >
                                <option value="">All Dates</option>
                                <option value="today">Today</option>
                                <option value="week">This Week</option>
                                <option value="month">This Month</option>
                            </select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Worksheets List */}
            <div className="bg-white shadow rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Class
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Status
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Grade
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Submitted By
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Date
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {worksheets.length > 0 ? (
                                worksheets.map((worksheet) => (
                                    <tr key={worksheet.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">
                                                {worksheet.class?.name || 'Unknown Class'}
                                            </div>
                                            {worksheet.images && (
                                                <div className="text-xs text-gray-500">
                                                    {worksheet.images.length} page{worksheet.images.length !== 1 ? 's' : ''}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span
                                                className={`px-2 py-1 text-xs rounded-full ${worksheet.status === 'COMPLETED'
                                                    ? 'bg-green-100 text-green-800'
                                                    : worksheet.status === 'PENDING'
                                                        ? 'bg-yellow-100 text-yellow-800'
                                                        : worksheet.status === 'PROCESSING'
                                                            ? 'bg-blue-100 text-blue-800'
                                                            : 'bg-red-100 text-red-800'
                                                    }`}
                                            >
                                                {worksheet.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">
                                                {worksheet.grade ? `${worksheet.grade}/10` : '-'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">
                                                {worksheet.submittedBy?.username || 'Unknown'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">
                                                {new Date(worksheet.createdAt).toLocaleDateString()}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleViewWorksheet(worksheet.id)}
                                            >
                                                View
                                            </Button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                                        No worksheets found
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
} 