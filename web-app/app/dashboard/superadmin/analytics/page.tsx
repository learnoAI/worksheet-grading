'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { analyticsAPI, OverallAnalytics } from '@/lib/api/analytics';
import { toast } from 'sonner';

export default function AnalyticsDashboardPage() {
    // Date range state
    const [startDate, setStartDate] = useState<string>(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );
    const [endDate, setEndDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    
    // Analytics data state
    const [analytics, setAnalytics] = useState<OverallAnalytics | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    
    // Fetch analytics data on initial load and when date range changes
    useEffect(() => {
        fetchAnalytics();
    }, []);
    
    const fetchAnalytics = async () => {
        setIsLoading(true);
        try {
            const data = await analyticsAPI.getOverallAnalytics(startDate, endDate);
            setAnalytics(data);
        } catch (error) {
            console.error('Error fetching analytics:', error);
            toast.error('Failed to fetch analytics data');
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        fetchAnalytics();
    };
    
    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Overall Analytics</h1>
            
            {/* Date Range Filter */}
            <Card>
                <CardHeader>
                    <CardTitle>Date Range</CardTitle>
                    <CardDescription>Select a date range for analytics</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="startDate">Start Date</Label>
                            <Input
                                id="startDate"
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="max-w-[200px]"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="endDate">End Date</Label>
                            <Input
                                id="endDate"
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="max-w-[200px]"
                                required
                            />
                        </div>
                        <div className="flex items-end">
                            <Button type="submit" disabled={isLoading}>
                                {isLoading ? 'Loading...' : 'Apply Filter'}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
            
            {/* Analytics Cards */}
            {isLoading ? (
                <div className="flex items-center justify-center h-64">
                    <p>Loading analytics data...</p>
                </div>
            ) : analytics ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
                    {/* Total Worksheets & Completion Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Worksheet Statistics</CardTitle>
                            <CardDescription>Overall worksheet completion metrics</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Total Worksheets</span>
                                    <span className="font-medium text-lg">{analytics.totalWorksheets}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Total Graded</span>
                                    <span className="font-medium text-lg">{analytics.totalGraded}</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    
                    {/* Absence Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Student Absences</CardTitle>
                            <CardDescription>Student absence metrics</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Total Absences</span>
                                    <span className="font-medium text-lg">{analytics.totalAbsent}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Absence Rate</span>
                                    <span className="font-medium text-lg">
                                        {analytics.absentPercentage.toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    
                    {/* Repetition Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Worksheet Repetition</CardTitle>
                            <CardDescription>Tracking worksheet repetition</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Total Repeated</span>
                                    <span className="font-medium text-lg">{analytics.totalRepeated}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Repetition Rate</span>
                                    <span className="font-medium text-lg">
                                        {analytics.repetitionRate.toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    
                    {/* Performance Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Performance Metrics</CardTitle>
                            <CardDescription>Student performance analytics</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">High Scores (≥80%)</span>
                                    <span className="font-medium text-lg">{analytics.highScoreCount}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">High Score Rate</span>
                                    <span className="font-medium text-lg">
                                        {analytics.highScorePercentage.toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            ) : (
                <div className="flex items-center justify-center h-64">
                    <p>No analytics data available for the selected date range</p>
                </div>
            )}
        </div>
    );
}