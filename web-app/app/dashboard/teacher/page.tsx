'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { worksheetAPI, notificationAPI } from '@/lib/api';
import { Worksheet, Notification } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function TeacherDashboardPage() {
    const { user } = useAuth();
    const [worksheets, setWorksheets] = useState<Worksheet[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchDashboardData = async () => {
            setIsLoading(true);
            try {
                // Fetch notifications
                const notificationsData = await notificationAPI.getNotifications();
                setNotifications(notificationsData.slice(0, 5)); // Show only 5 most recent

                // Fetch worksheets for teacher's classes
                const worksheetsData = await worksheetAPI.getWorksheetsByClass('1025d255-a661-4a56-9876-7eac665c6ee1');
                setWorksheets(worksheetsData.slice(0, 5)); // Show only 5 most recent
            } catch (error) {
                console.error('Error fetching dashboard data:', error);
            } finally {
                setIsLoading(false);
            }
        };

        if (user) {
            fetchDashboardData();
        }
    }, [user]);

    if (isLoading) {
        return <div>Loading dashboard data...</div>;
    }

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Teacher Dashboard</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Stats Card */}
                <Card>
                    <CardHeader>
                        <CardTitle>Overview</CardTitle>
                        <CardDescription>Your activity summary</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Total Worksheets:</span>
                                <span className="font-medium">{worksheets.length}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Pending:</span>
                                <span className="font-medium">
                                    {worksheets.filter(w => w.status === 'PENDING').length}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Completed:</span>
                                <span className="font-medium">
                                    {worksheets.filter(w => w.status === 'COMPLETED').length}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Unread Notifications:</span>
                                <span className="font-medium">
                                    {notifications.filter(n => n.status === 'UNREAD').length}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Recent Worksheets */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>Recent Worksheets</CardTitle>
                        <CardDescription>Your recently uploaded worksheets</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {worksheets.length > 0 ? (
                            <div className="space-y-4">
                                {worksheets.map(worksheet => (
                                    <div key={worksheet.id} className="flex items-center justify-between border-b pb-2">
                                        <div>
                                            <div className="font-medium">
                                                {worksheet.class?.name || 'Unknown Class'}
                                            </div>
                                            <div className="text-sm text-muted-foreground">
                                                {new Date(worksheet.createdAt).toLocaleDateString()}
                                            </div>
                                        </div>
                                        <div className="flex items-center">
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
                                            {worksheet.grade && (
                                                <span className="ml-2 font-medium">
                                                    Grade: {worksheet.grade}/10
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-4 text-muted-foreground">
                                No worksheets found
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Recent Notifications */}
            <Card>
                <CardHeader>
                    <CardTitle>Recent Notifications</CardTitle>
                    <CardDescription>Your latest updates</CardDescription>
                </CardHeader>
                <CardContent>
                    {notifications.length > 0 ? (
                        <div className="space-y-4">
                            {notifications.map(notification => (
                                <div
                                    key={notification.id}
                                    className={`p-3 rounded-lg ${notification.status === 'UNREAD'
                                        ? 'bg-blue-50'
                                        : 'bg-gray-50'
                                        }`}
                                >
                                    <div className="flex justify-between">
                                        <div className="font-medium">
                                            {notification.message}
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                            {new Date(notification.createdAt).toLocaleDateString()}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-4 text-muted-foreground">
                            No notifications found
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
} 