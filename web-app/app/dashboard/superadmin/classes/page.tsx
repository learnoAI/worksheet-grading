'use client';

import { useState, useEffect, useCallback, useMemo, lazy, Suspense, memo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { classAPI } from '@/lib/api/class';
import { analyticsAPI } from '@/lib/api/analytics';
import { userAPI } from '@/lib/api/user';
import { Class, UserRole } from '@/lib/api/types';
import type { School as AnalyticsSchool } from '@/lib/api/analytics';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { 
    Dialog, 
    DialogContent
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { 
    Archive, 
    ArchiveRestore, 
    Filter, 
    RefreshCw, 
    Users, 
    UserPlus, 
    Upload,
    Download,
    GraduationCap,
    Loader2,
    Search,
    ChevronLeft,
    ChevronRight
} from 'lucide-react';

// Lazy load heavy components
const CreateUserForm = lazy(() => import('@/components/CreateUserForm').then(module => ({ default: module.CreateUserForm })));
const StudentManagementModal = lazy(() => import('@/components/StudentManagementModal').then(module => ({ default: module.StudentManagementModal })));
const TeacherManagementModal = lazy(() => import('@/components/TeacherManagementModal').then(module => ({ default: module.TeacherManagementModal })));

// Custom hooks for better performance
const useDebounce = <T,>(value: T, delay: number): T => {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
};

// Cache for API calls to reduce redundant requests
const apiCache = new Map<string, { data: any; timestamp: number; ttl: number }>();

const getCachedData = <T,>(key: string, fetchFn: () => Promise<T>, ttl: number = 300000): Promise<T> => {
    const cached = apiCache.get(key);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < cached.ttl) {
        return Promise.resolve(cached.data);
    }
    
    return fetchFn().then(data => {
        apiCache.set(key, { data, timestamp: now, ttl });
        return data;
    });
};

interface ClassWithSchool extends Omit<Class, 'school'> {
    school: AnalyticsSchool;
    studentCount?: number;
    teacherCount?: number;
}

interface CsvStudent {
    name: string;
    tokenNumber: string;
    className: string;
    schoolName: string;
}

// Pagination constants
const ITEMS_PER_PAGE = 20;
const BATCH_SIZE = 5; // For loading counts

// Optimized loading components
const PageLoader = memo(() => (
    <div className="flex justify-center items-center h-96">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading classes...</span>
    </div>
));

const ComponentLoader = memo(() => (
    <div className="flex justify-center items-center h-20">
        <Loader2 className="h-4 w-4 animate-spin" />
    </div>
));


// Memoized count display component
const CountButton = memo(({ 
    count, 
    isLoading, 
    icon: Icon, 
    onClick, 
    disabled 
}: { 
    count: number; 
    isLoading: boolean; 
    icon: any; 
    onClick: () => void; 
    disabled: boolean; 
}) => (
    <Button
        variant="outline"
        size="sm"
        onClick={onClick}
        className="flex items-center gap-1"
        disabled={disabled || isLoading}
    >
        {isLoading ? (
            <>
                <Loader2 className="h-3 w-3 animate-spin" />
                ...
            </>
        ) : (
            <>
                <Icon className="h-3 w-3" />
                {count}
            </>
        )}
    </Button>
));

// Optimized pagination component
const PaginationControls = memo(({ 
    currentPage, 
    totalPages, 
    onPageChange, 
    hasNextPage, 
    hasPrevPage,
    isLoading = false
}: {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    isLoading?: boolean;
}) => {
    // Generate page numbers to show
    const getPageNumbers = () => {
        const pages: number[] = [];
        const maxVisible = 5;
        
        let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let end = Math.min(totalPages, start + maxVisible - 1);
        
        // Adjust start if we're near the end
        if (end - start + 1 < maxVisible) {
            start = Math.max(1, end - maxVisible + 1);
        }
        
        for (let i = start; i <= end; i++) {
            pages.push(i);
        }
        
        return pages;
    };

    if (totalPages <= 1) return null;

    return (
        <div className="flex items-center justify-between px-2 py-4">
            <div className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
            </div>
            <div className="flex items-center space-x-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={!hasPrevPage || isLoading}
                >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                </Button>
                
                {getPageNumbers().map((page) => (
                    <Button
                        key={page}
                        variant={page === currentPage ? "default" : "outline"}
                        size="sm"
                        onClick={() => onPageChange(page)}
                        disabled={isLoading}
                    >
                        {page}
                    </Button>
                ))}
                
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={!hasNextPage || isLoading}
                >
                    Next
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
});

export default function ClassesPage() {
    const { user, isLoading } = useAuth();
    const router = useRouter();
    
    // Core data state
    const [classes, setClasses] = useState<ClassWithSchool[]>([]);
    const [schools, setSchools] = useState<AnalyticsSchool[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [countsLoading, setCountsLoading] = useState<Set<string>>(new Set());
    
    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    
    // Filters with debouncing
    const [selectedSchool, setSelectedSchool] = useState<string>('all');
    const [showArchived, setShowArchived] = useState<string>('active');
    const [searchTerm, setSearchTerm] = useState<string>('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    
    // CSV Upload state
    const [showCsvUpload, setShowCsvUpload] = useState(false);
    const [csvData, setCsvData] = useState('');
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [uploadingCsv, setUploadingCsv] = useState(false);
    
    // Create user state
    const [showCreateUser, setShowCreateUser] = useState(false);
    
    // Management modals state
    const [selectedClassForStudents, setSelectedClassForStudents] = useState<ClassWithSchool | null>(null);
    const [selectedClassForTeachers, setSelectedClassForTeachers] = useState<ClassWithSchool | null>(null);

    // Memoized filtered classes for better performance
    const filteredClasses = useMemo(() => {
        let filtered = [...classes];
        
        // Filter by search term
        if (debouncedSearchTerm) {
            const searchLower = debouncedSearchTerm.toLowerCase();
            filtered = filtered.filter(cls => 
                cls.name.toLowerCase().includes(searchLower) ||
                cls.school.name.toLowerCase().includes(searchLower)
            );
        }
        
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
        
        return filtered;
    }, [classes, selectedSchool, showArchived, debouncedSearchTerm]);

    // Paginated classes
    const paginatedClasses = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredClasses.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredClasses, currentPage]);

    // Pagination info
    const totalPages = Math.ceil(filteredClasses.length / ITEMS_PER_PAGE);
    const hasNextPage = currentPage < totalPages;
    const hasPrevPage = currentPage > 1;

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [selectedSchool, showArchived, debouncedSearchTerm]);

    // Memoized summary stats
    const summaryStats = useMemo(() => {
        const activeClasses = classes.filter(c => !c.isArchived).length;
        const archivedClasses = classes.filter(c => c.isArchived).length;
        const totalClasses = classes.length;
        const filteredResults = filteredClasses.length;
        
        return {
            activeClasses,
            archivedClasses,
            totalClasses,
            filteredResults
        };
    }, [classes, filteredClasses]);

    useEffect(() => {
        // Redirect if not logged in or not a superadmin
        if (!isLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('You do not have permission to access this page');
            router.push('/dashboard');
        } else if (!isLoading && user?.role === UserRole.SUPERADMIN) {
            loadInitialData();
        }
    }, [user, isLoading, router]);

    const loadInitialData = useCallback(async () => {
        try {
            setLoading(true);
            
            // Use caching for frequently accessed data
            const [schoolsData, classesData] = await Promise.all([
                getCachedData('schools', () => analyticsAPI.getAllSchools(), 600000), // Cache for 10 minutes
                getCachedData('classes', () => classAPI.getAllClasses(true), 300000) // Cache for 5 minutes
            ]);
            
            setSchools(schoolsData);
            
            // Transform classes data to include school information
            const classesWithSchool: ClassWithSchool[] = classesData.map((cls) => {
                const school = schoolsData.find(s => s.id === cls.schoolId);
                
                return {
                    ...cls,
                    school: school || { id: cls.schoolId, name: 'Unknown School' },
                    // Initialize with 0, will be loaded asynchronously
                    studentCount: 0,
                    teacherCount: 0
                };
            });
            
            setClasses(classesWithSchool);
            
            // Load counts for visible classes asynchronously (only for current page)
            loadVisibleClassCounts(classesWithSchool);
        } catch (error) {
            console.error('Error loading data:', error);
            toast.error('Failed to load classes data');
        } finally {
            setLoading(false);
        }
    }, []);

    // Load class counts only for visible classes to improve performance
    const loadVisibleClassCounts = useCallback(async (allClasses: ClassWithSchool[]) => {
        // Get currently visible classes based on pagination and filters
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        const visibleClasses = allClasses.slice(startIndex, startIndex + ITEMS_PER_PAGE);
        
        // Load counts in smaller batches for better performance
        const batchSize = 3;
        for (let i = 0; i < visibleClasses.length; i += batchSize) {
            const batch = visibleClasses.slice(i, i + batchSize);
            
            await Promise.all(batch.map(async (cls) => {
                const cacheKey = `class_counts_${cls.id}`;
                setCountsLoading(prev => new Set(prev).add(cls.id));
                
                try {
                    // Use caching for class counts
                    const [students, teachers] = await Promise.all([
                        getCachedData(`${cacheKey}_students`, () => classAPI.getClassStudentsWithDetails(cls.id), 180000), // 3 minutes cache
                        getCachedData(`${cacheKey}_teachers`, () => classAPI.getClassTeachers(cls.id), 180000) // 3 minutes cache
                    ]);
                    
                    setClasses(prev => prev.map(c => 
                        c.id === cls.id 
                            ? { ...c, studentCount: students.length, teacherCount: teachers.length }
                            : c
                    ));
                } catch (error) {
                    console.error(`Error loading counts for class ${cls.id}:`, error);
                } finally {
                    setCountsLoading(prev => {
                        const newSet = new Set(prev);
                        newSet.delete(cls.id);
                        return newSet;
                    });
                }
            }));
            
            // Small delay between batches to be gentle on the server
            if (i + batchSize < visibleClasses.length) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
    }, [currentPage]);

    // Load counts when page or filters change
    useEffect(() => {
        if (classes.length > 0 && !loading) {
            loadVisibleClassCounts(classes);
        }
    }, [currentPage, selectedSchool, showArchived, classes.length, loading, loadVisibleClassCounts]);

    const handleArchiveClass = useCallback(async (classId: string) => {
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
    }, []);

    const handleUnarchiveClass = useCallback(async (classId: string) => {
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
    }, []);

    const handleRefresh = useCallback(() => {
        // Clear cache on refresh to get fresh data
        apiCache.clear();
        loadInitialData();
    }, [loadInitialData]);

    const handleCsvFileUpload = useCallback((file: File) => {
        if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
            toast.error('Please select a valid CSV file');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            setCsvData(content);
            setCsvFile(file);
        };
        reader.onerror = () => {
            toast.error('Error reading CSV file');
        };
        reader.readAsText(file);
    }, []);

    const handleCsvUpload = useCallback(async () => {
        if (!csvFile || !csvData.trim()) {
            toast.error('Please upload a CSV file first');
            return;
        }

        try {
            setUploadingCsv(true);
            
            // Parse CSV data
            const lines = csvData.split('\n').filter(line => line.trim());
            if (lines.length < 2) {
                toast.error('CSV file must contain at least a header row and one data row');
                return;
            }

            const headers = lines[0].split(',').map(h => h.trim());
            
            if (headers.length < 4 || !headers.includes('name') || !headers.includes('tokenNumber') || 
                !headers.includes('className') || !headers.includes('schoolName')) {
                toast.error('CSV must have columns: name, tokenNumber, className, schoolName');
                return;
            }

            const students: CsvStudent[] = [];
            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',').map(v => v.trim());
                if (values.length >= 4 && values.some(v => v)) { // Ensure at least one non-empty value
                    const student: CsvStudent = {
                        name: values[headers.indexOf('name')],
                        tokenNumber: values[headers.indexOf('tokenNumber')],
                        className: values[headers.indexOf('className')],
                        schoolName: values[headers.indexOf('schoolName')]
                    };
                    
                    // Validate required fields
                    if (student.name && student.tokenNumber && student.className && student.schoolName) {
                        students.push(student);
                    }
                }
            }

            if (students.length === 0) {
                toast.error('No valid student records found in CSV');
                return;
            }

            const result = await userAPI.uploadStudentsCsv(students);
            
            toast.success(`CSV processed successfully: ${result.results.created} students created, ${result.results.updated} students updated`);
            if (result.results.errors && result.results.errors.length > 0) {
                console.warn('CSV processing errors:', result.results.errors);
                toast.warning(`${result.results.errors.length} records had errors - check console for details`);
            }
            
            setShowCsvUpload(false);
            setCsvData('');
            setCsvFile(null);
            handleRefresh(); // Refresh data
        } catch (error: any) {
            console.error('Error uploading CSV:', error);
            toast.error(error.message || 'Failed to upload CSV');
        } finally {
            setUploadingCsv(false);
        }
    }, [csvFile, csvData, handleRefresh]);

    const handleDownloadCsvTemplate = useCallback(() => {
        const csvContent = `name,tokenNumber,className,schoolName
John Doe,TN001,Class 1A,Greenwood Elementary School
Jane Smith,TN002,Class 1A,Greenwood Elementary School
Michael Johnson,TN003,Class 1B,Greenwood Elementary School
Emily Brown,TN004,Class 1A,Greenwood Elementary School
David Wilson,TN005,Class 2A,Riverside Middle School
Sarah Davis,TN006,Class 2A,Riverside Middle School
Robert Miller,TN007,Class 2B,Riverside Middle School
Lisa Anderson,TN008,Class 3A,Oakwood High School
William Taylor,TN009,Class 3A,Oakwood High School
Jennifer Thomas,TN010,Class 3B,Oakwood High School`;
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', 'student_template.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        toast.success('CSV template with sample data downloaded successfully');
    }, []);

    const handleCreateUserSuccess = useCallback(() => {
        setShowCreateUser(false);
        handleRefresh(); // Refresh data
    }, [handleRefresh]);

    const handleStudentsUpdated = useCallback(() => {
        handleRefresh(); // Refresh data to update student counts
    }, [handleRefresh]);

    const handleTeachersUpdated = useCallback(() => {
        handleRefresh(); // Refresh data to update teacher counts
    }, [handleRefresh]);

    if (isLoading || loading) {
        return <PageLoader />;
    }

    if (!user || user.role !== UserRole.SUPERADMIN) {
        return null;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                <h1 className="text-2xl font-bold">Classes Management</h1>
                <div className="flex flex-col sm:flex-row gap-2">
                    <Button 
                        onClick={() => setShowCreateUser(true)}
                        size="sm"
                        className="flex items-center gap-2 w-full sm:w-auto"
                    >
                        <UserPlus className="h-4 w-4" />
                        Add User
                    </Button>
                    <Button 
                        onClick={handleRefresh}
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-2 w-full sm:w-auto"
                    >
                        <RefreshCw className="h-4 w-4" />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Filter className="h-4 w-4" />
                        Filters & Actions
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {/* Filter Controls */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Search</label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    <Input
                                        placeholder="Search classes or schools..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="pl-10"
                                    />
                                </div>
                            </div>
                            
                            <div>
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
                            
                            <div>
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

                        {/* Action Buttons */}
                        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
                            <Button
                                onClick={() => setShowCsvUpload(!showCsvUpload)}
                                variant="outline"
                                size="sm"
                                className="flex items-center justify-center gap-2 w-full sm:w-auto"
                            >
                                <Upload className="h-4 w-4" />
                                {showCsvUpload ? 'Hide CSV Upload' : 'Upload CSV'}
                            </Button>
                            <Button
                                onClick={handleDownloadCsvTemplate}
                                variant="outline"
                                size="sm"
                                className="flex items-center justify-center gap-2 w-full sm:w-auto"
                            >
                                <Download className="h-4 w-4" />
                                Download Template
                            </Button>
                        </div>
                    </div>

                    {/* CSV Upload Section */}
                    {showCsvUpload && (
                        <div className="border-t pt-4 space-y-4">
                            <div>
                                <Label className="text-base font-semibold">Upload Student CSV</Label>
                                <p className="text-sm text-gray-500 mt-1">
                                    Format: name,tokenNumber,className,schoolName (header row required)
                                </p>
                            </div>
                            
                            {/* File Upload Option */}
                            <div className="space-y-4">
                                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
                                    <div className="space-y-4">
                                        <div className="mx-auto w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center">
                                            <Upload className="h-6 w-6 text-blue-600" />
                                        </div>
                                        <div>
                                            <Label htmlFor="csvFile" className="cursor-pointer">
                                                <div className="text-sm font-medium text-gray-900 mb-1">
                                                    Click to upload CSV file
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    Supports CSV files up to 10MB
                                                </div>
                                            </Label>
                                            <input
                                                id="csvFile"
                                                type="file"
                                                accept=".csv,text/csv"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) {
                                                        handleCsvFileUpload(file);
                                                    }
                                                }}
                                                className="hidden"
                                            />
                                        </div>
                                        {csvFile && (
                                            <div className="flex items-center justify-center gap-2 text-green-700 bg-green-50 px-3 py-2 rounded-md">
                                                <span className="text-sm font-medium">✓ {csvFile.name}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex flex-col sm:flex-row gap-3">
                                <Button
                                    onClick={handleCsvUpload}
                                    disabled={uploadingCsv || !csvFile}
                                    className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700"
                                >
                                    {uploadingCsv ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="h-4 w-4 mr-2" />
                                            Upload & Process CSV
                                        </>
                                    )}
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setShowCsvUpload(false);
                                        setCsvData('');
                                        setCsvFile(null);
                                    }}
                                    className="w-full sm:w-auto"
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{summaryStats.activeClasses}</div>
                        <p className="text-sm text-muted-foreground">Active Classes</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{summaryStats.archivedClasses}</div>
                        <p className="text-sm text-muted-foreground">Archived Classes</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{summaryStats.totalClasses}</div>
                        <p className="text-sm text-muted-foreground">Total Classes</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{summaryStats.filteredResults}</div>
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
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="py-3 px-4 text-left">Class Name</th>
                                            <th className="py-3 px-4 text-left">School</th>
                                            <th className="py-3 px-4 text-left">Students</th>
                                            <th className="py-3 px-4 text-left">Teachers</th>
                                            <th className="py-3 px-4 text-left">Status</th>
                                            <th className="py-3 px-4 text-left">Created</th>
                                            <th className="py-3 px-4 text-left">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paginatedClasses.map((cls) => (
                                            <tr key={cls.id} className="border-b hover:bg-gray-50">
                                                <td className="py-3 px-4 font-medium">{cls.name}</td>
                                                <td className="py-3 px-4">{cls.school.name}</td>
                                                <td className="py-3 px-4">
                                                    <CountButton
                                                        count={cls.studentCount || 0}
                                                        isLoading={countsLoading.has(cls.id)}
                                                        icon={Users}
                                                        onClick={() => setSelectedClassForStudents(cls)}
                                                        disabled={false}
                                                    />
                                                </td>
                                                <td className="py-3 px-4">
                                                    <CountButton
                                                        count={cls.teacherCount || 0}
                                                        isLoading={countsLoading.has(cls.id)}
                                                        icon={GraduationCap}
                                                        onClick={() => setSelectedClassForTeachers(cls)}
                                                        disabled={false}
                                                    />
                                                </td>
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
                            
                            {/* Pagination */}
                            <PaginationControls
                                currentPage={currentPage}
                                totalPages={totalPages}
                                onPageChange={setCurrentPage}
                                hasNextPage={hasNextPage}
                                hasPrevPage={hasPrevPage}
                                isLoading={loading}
                            />
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Modals */}
            {showCreateUser && (
                <Dialog open={showCreateUser} onOpenChange={setShowCreateUser}>
                    <DialogContent className="max-w-2xl">
                        <Suspense fallback={<ComponentLoader />}>
                            <CreateUserForm
                                onClose={() => setShowCreateUser(false)}
                                onSuccess={handleCreateUserSuccess}
                                allowedRoles={[UserRole.TEACHER, UserRole.STUDENT]}
                            />
                        </Suspense>
                    </DialogContent>
                </Dialog>
            )}

            {selectedClassForStudents && (
                <Suspense fallback={<ComponentLoader />}>
                    <StudentManagementModal
                        isOpen={!!selectedClassForStudents}
                        onClose={() => setSelectedClassForStudents(null)}
                        classId={selectedClassForStudents.id}
                        className={selectedClassForStudents.name}
                        schoolId={selectedClassForStudents.schoolId}
                        onStudentsUpdated={handleStudentsUpdated}
                    />
                </Suspense>
            )}

            {selectedClassForTeachers && (
                <Suspense fallback={<ComponentLoader />}>
                    <TeacherManagementModal
                        isOpen={!!selectedClassForTeachers}
                        onClose={() => setSelectedClassForTeachers(null)}
                        classId={selectedClassForTeachers.id}
                        className={selectedClassForTeachers.name}
                        schoolId={selectedClassForTeachers.schoolId}
                        onTeachersUpdated={handleTeachersUpdated}
                    />
                </Suspense>
            )}
        </div>
    );
}
