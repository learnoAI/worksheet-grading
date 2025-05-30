'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { analyticsAPI, OverallAnalytics, School, Class } from '@/lib/api/analytics';
import { toast } from 'sonner';
import { Download } from 'lucide-react';

export default function AnalyticsDashboardPage() {
    // Date range state
    const [startDate, setStartDate] = useState<string>(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );
    const [endDate, setEndDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    
    // Filter state for download
    const [schools, setSchools] = useState<School[]>([]);
    const [classes, setClasses] = useState<Class[]>([]);
    const [selectedSchoolId, setSelectedSchoolId] = useState<string>('all');
    const [selectedClassId, setSelectedClassId] = useState<string>('all');
    const [isDownloading, setIsDownloading] = useState<boolean>(false);
    
    // Analytics data state
    const [analytics, setAnalytics] = useState<OverallAnalytics | null>(null);
    const [isLoading, setIsLoading] = useState(true);
      // Fetch analytics data on initial load and when date range changes
    useEffect(() => {
        fetchAnalytics();
    }, []);

    // Load schools on initial render
    useEffect(() => {
        const loadSchools = async () => {
            try {
                const schoolsData = await analyticsAPI.getAllSchools();
                setSchools(schoolsData);
            } catch (error) {
                console.error('Error loading schools:', error);
                toast.error('Failed to load schools');
            }
        };
        
        loadSchools();
    }, []);
    
    // Load classes when a school is selected
    useEffect(() => {
        if (selectedSchoolId && selectedSchoolId !== 'all') {
            const loadClasses = async () => {
                try {
                    const classesData = await analyticsAPI.getClassesBySchool(selectedSchoolId);
                    setClasses(classesData);
                    setSelectedClassId('all'); // Reset class selection
                } catch (error) {
                    console.error('Error loading classes:', error);
                    toast.error('Failed to load classes');
                }
            };
            
            loadClasses();
        } else {
            setClasses([]);
            setSelectedClassId('all');
        }
    }, [selectedSchoolId]);
    
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

    // Handle download
    const handleDownload = async () => {
        setIsDownloading(true);
        try {
            await analyticsAPI.downloadStudentAnalytics({
                schoolId: selectedSchoolId !== 'all' ? selectedSchoolId : undefined,
                classId: selectedClassId !== 'all' ? selectedClassId : undefined
            });
            toast.success('Analytics data downloaded successfully');
        } catch (error) {
            console.error('Error downloading analytics:', error);
            toast.error('Failed to download analytics data');
        } finally {
            setIsDownloading(false);
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
                    </form>                </CardContent>
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
            <Card>
                <CardHeader>
                    <CardTitle>Download Student Analytics</CardTitle>
                    <CardDescription>Filter and download detailed student analytics data</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="school">School</Label>
                            <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
                                <SelectTrigger className="max-w-[250px]">
                                    <SelectValue placeholder="Select school" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Schools</SelectItem>
                                    {schools.map((school) => (
                                        <SelectItem key={school.id} value={school.id}>
                                            {school.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        
                        <div className="space-y-2">
                            <Label htmlFor="class">Class</Label>
                            <Select 
                                value={selectedClassId} 
                                onValueChange={setSelectedClassId}
                                disabled={selectedSchoolId === 'all'}
                            >
                                <SelectTrigger className="max-w-[250px]">
                                    <SelectValue placeholder="Select class" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Classes</SelectItem>
                                    {classes.map((cls) => (
                                        <SelectItem key={cls.id} value={cls.id}>
                                            {cls.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        
                        <div className="flex items-end">
                            <Button onClick={handleDownload} disabled={isDownloading}>
                                <Download className="mr-2 h-4 w-4" />
                                {isDownloading ? 'Downloading...' : 'Download CSV'}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}