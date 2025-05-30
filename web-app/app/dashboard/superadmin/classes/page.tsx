'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { classAPI } from '@/lib/api/class';
import { analyticsAPI } from '@/lib/api/analytics';
import { Class, UserRole } from '@/lib/api/types';
import type { School as AnalyticsSchool } from '@/lib/api/analytics';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, Filter, RefreshCw } from 'lucide-react';

interface ClassWithSchool extends Omit<Class, 'school'> {
    school: AnalyticsSchool;
    studentCount?: number;
    teacherCount?: number;
}

export default function ClassesPage() {
    const { user, isLoading } = useAuth();
    const router = useRouter();
    const [classes, setClasses] = useState<ClassWithSchool[]>([]);
    const [schools, setSchools] = useState<AnalyticsSchool[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    
    // Filters
    const [selectedSchool, setSelectedSchool] = useState<string>('all');
    const [showArchived, setShowArchived] = useState<string>('active'); // 'all', 'active', 'archived'
    
    // Filtered classes
    const [filteredClasses, setFilteredClasses] = useState<ClassWithSchool[]>([]);

    useEffect(() => {
        // Redirect if not logged in or not a superadmin
        if (!isLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('You do not have permission to access this page');
            router.push('/dashboard');
        } else if (!isLoading && user?.role === UserRole.SUPERADMIN) {
            loadInitialData();
        }
    }, [user, isLoading, router]);

    // Filter classes when filters change
    useEffect(() => {
        applyFilters();
    }, [classes, selectedSchool, showArchived]);

    const loadInitialData = async () => {
        try {
            setLoading(true);
            
            // Load schools and classes in parallel
            const [schoolsData, classesData] = await Promise.all([
                analyticsAPI.getAllSchools(),
                classAPI.getAllClasses(true) // Include archived classes
            ]);
            // Set schools and classes in state
            setSchools(schoolsData);
              // Transform classes data to include school information
            const classesWithSchool: ClassWithSchool[] = classesData.map(cls => {
                const school = schoolsData.find(s => s.id === cls.schoolId);
                return {
                    ...cls,
                    school: school || { id: cls.schoolId, name: 'Unknown School' }
                };
            });
            
            setClasses(classesWithSchool);
        } catch (error) {
            console.error('Error loading data:', error);
            toast.error('Failed to load classes data');
        } finally {
            setLoading(false);
        }
    };

    const applyFilters = () => {
        let filtered = [...classes];
        
        // Filter by school
        if (selectedSchool !== 'all') {
            filtered = filtered.filter(cls => cls.schoolId === selectedSchool);
        }
        
        // Filter by archive status
        if (showArchived === 'active') {
            filtered = filtered.filter(cls => !cls.isArchived);
        } else if (showArchived === 'archived') {
            filtered = filtered.filter(cls => cls.isArchived);
        }
        // 'all' shows both active and archived
        
        setFilteredClasses(filtered);
    };

    const handleArchiveClass = async (classId: string) => {
        try {
            setActionLoading(classId);
            const result = await classAPI.archiveClass(classId);
            
            // Update the class in our state
            setClasses(prev => prev.map(cls => 
                cls.id === classId 
                    ? { ...cls, isArchived: true }
                    : cls
            ));
            
            toast.success(result.message || 'Class archived successfully');
        } catch (error: any) {
            console.error('Error archiving class:', error);
            toast.error(error.message || 'Failed to archive class');
        } finally {
            setActionLoading(null);
        }
    };

    const handleUnarchiveClass = async (classId: string) => {
        try {
            setActionLoading(classId);
            const result = await classAPI.unarchiveClass(classId);
            
            // Update the class in our state
            setClasses(prev => prev.map(cls => 
                cls.id === classId 
                    ? { ...cls, isArchived: false }
                    : cls
            ));
            
            toast.success(result.message || 'Class unarchived successfully');
        } catch (error: any) {
            console.error('Error unarchiving class:', error);
            toast.error(error.message || 'Failed to unarchive class');
        } finally {
            setActionLoading(null);
        }
    };

    const handleRefresh = () => {
        loadInitialData();
    };

    if (isLoading || loading) {
        return <div className="flex justify-center items-center h-full">Loading...</div>;
    }

    if (!user || user.role !== UserRole.SUPERADMIN) {
        return null;
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Classes Management</h1>
                <Button 
                    onClick={handleRefresh}
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2"
                >
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                </Button>
            </div>

            {/* Filters */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Filter className="h-4 w-4" />
                        Filters
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1">
                            <label className="block text-sm font-medium mb-2">School</label>
                            <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select school" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Schools</SelectItem>
                                    {schools.map(school => (
                                        <SelectItem key={school.id} value={school.id}>
                                            {school.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        
                        <div className="flex-1">
                            <label className="block text-sm font-medium mb-2">Status</label>
                            <Select value={showArchived} onValueChange={setShowArchived}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">Active Classes</SelectItem>
                                    <SelectItem value="archived">Archived Classes</SelectItem>
                                    <SelectItem value="all">All Classes</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{classes.filter(c => !c.isArchived).length}</div>
                        <p className="text-sm text-muted-foreground">Active Classes</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{classes.filter(c => c.isArchived).length}</div>
                        <p className="text-sm text-muted-foreground">Archived Classes</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{classes.length}</div>
                        <p className="text-sm text-muted-foreground">Total Classes</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{filteredClasses.length}</div>
                        <p className="text-sm text-muted-foreground">Filtered Results</p>
                    </CardContent>
                </Card>
            </div>

            {/* Classes List */}
            <Card>
                <CardHeader>
                    <CardTitle>Classes</CardTitle>
                    <CardDescription>
                        Manage all classes in the system. Archive classes to hide them from active use.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {filteredClasses.length === 0 ? (
                        <div className="text-center py-8">
                            <p className="text-muted-foreground">No classes found matching the current filters.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="border-b">
                                        <th className="py-3 px-4 text-left">Class Name</th>
                                        <th className="py-3 px-4 text-left">School</th>
                                        <th className="py-3 px-4 text-left">Status</th>
                                        <th className="py-3 px-4 text-left">Created</th>
                                        <th className="py-3 px-4 text-left">Updated</th>
                                        <th className="py-3 px-4 text-left">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredClasses.map((cls) => (
                                        <tr key={cls.id} className="border-b hover:bg-gray-50">
                                            <td className="py-3 px-4 font-medium">{cls.name}</td>
                                            <td className="py-3 px-4">{cls.school.name}</td>
                                            <td className="py-3 px-4">
                                                <Badge 
                                                    variant={cls.isArchived ? "secondary" : "default"}
                                                    className={cls.isArchived ? "bg-gray-100 text-gray-800" : ""}
                                                >
                                                    {cls.isArchived ? 'Archived' : 'Active'}
                                                </Badge>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-muted-foreground">
                                                {new Date(cls.createdAt).toLocaleDateString()}
                                            </td>
                                            <td className="py-3 px-4 text-sm text-muted-foreground">
                                                {new Date(cls.updatedAt).toLocaleDateString()}
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex space-x-2">
                                                    {cls.isArchived ? (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleUnarchiveClass(cls.id)}
                                                            disabled={actionLoading === cls.id}
                                                            className="flex items-center gap-1"
                                                        >
                                                            <ArchiveRestore className="h-3 w-3" />
                                                            {actionLoading === cls.id ? 'Unarchiving...' : 'Unarchive'}
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleArchiveClass(cls.id)}
                                                            disabled={actionLoading === cls.id}
                                                            className="flex items-center gap-1"
                                                        >
                                                            <Archive className="h-3 w-3" />
                                                            {actionLoading === cls.id ? 'Archiving...' : 'Archive'}
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
