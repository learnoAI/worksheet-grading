'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { analyticsAPI, School, Class, StudentAnalytics } from '@/lib/api/analyticsAPI';
import { userAPI } from '@/lib/api/user';
import { toast } from 'sonner';
import { Download, Filter, X, ArrowUp, ArrowDown, ChevronsUpDown, Archive, ArchiveRestore, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

type SortField = 'name' | 'tokenNumber' | 'school' | 'class' | 'totalWorksheets' | 'repetitionRate' | 'absentPercentage' | 'firstWorksheetDate' | 'lastWorksheetDate';
type SortDirection = 'asc' | 'desc';

// Custom debounce hook for better performance
function useDebounce<T>(value: T, delay: number): T {
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
}

export default function StudentAnalyticsPage() {
    // Filter state
    const [schools, setSchools] = useState<School[]>([]);
    const [classes, setClasses] = useState<Class[]>([]);    const [selectedSchoolId, setSelectedSchoolId] = useState<string>('all');
    const [selectedClassId, setSelectedClassId] = useState<string>('all');
    const [searchName, setSearchName] = useState<string>('');
    
    // Date filter state - Default to last 30 days
    const [startDate, setStartDate] = useState<string>(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );
    const [endDate, setEndDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [enableDateFilter, setEnableDateFilter] = useState<boolean>(false);
      // Additional filter states
    const [minWorksheets, setMinWorksheets] = useState<string>('');
    const [maxAbsentRate, setMaxAbsentRate] = useState<string>('');
    const [minRepetitionRate, setMinRepetitionRate] = useState<string>('');
    const [showArchived, setShowArchived] = useState<string>('active');
    const [isDownloading, setIsDownloading] = useState<boolean>(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
      // Sorting state - Default to token number sorting for better efficiency
    const [sortField, setSortField] = useState<SortField>('tokenNumber');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
      // Data state
    const [students, setStudents] = useState<StudentAnalytics[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    
    // Pagination state
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [itemsPerPage, setItemsPerPage] = useState<number>(20);

    // Debounce search term for better performance
    const debouncedSearchName = useDebounce(searchName, 300);
    const debouncedMinWorksheets = useDebounce(minWorksheets, 300);
    const debouncedMaxAbsentRate = useDebounce(maxAbsentRate, 300);
    const debouncedMinRepetitionRate = useDebounce(minRepetitionRate, 300);
    
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
                    // Reset class selection when school changes
                    setSelectedClassId('all');
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
      // Load students based on filters
    useEffect(() => {
        const loadStudentAnalytics = async () => {
            setIsLoading(true);
            try {
                const data = await analyticsAPI.getStudentAnalytics({
                    schoolId: selectedSchoolId !== 'all' ? selectedSchoolId : undefined,
                    classId: selectedClassId !== 'all' ? selectedClassId : undefined,
                    startDate: enableDateFilter ? startDate : undefined,
                    endDate: enableDateFilter ? endDate : undefined
                });
                setStudents(data);
            } catch (error) {
                console.error('Error loading student analytics:', error);
                toast.error('Failed to load student analytics');
            } finally {
                setIsLoading(false);
            }
        };
        
        loadStudentAnalytics();    }, [selectedSchoolId, selectedClassId, enableDateFilter, startDate, endDate]);    // Optimized token parser - memoized to avoid recreating the function
    const parseToken = useCallback((token: string | null) => {
        if (!token) return { type: 'string' as const, original: '' };
        
        // Check if it matches YearSNumber format (e.g., 24S138)
        const yearSMatch = token.match(/^(\d+)S(\d+)$/);
        if (yearSMatch) {
            const year = parseInt(yearSMatch[1]);
            const number = parseInt(yearSMatch[2]);
            return { type: 'yearS' as const, year, number, original: token };
        }
        
        // Check if it's a pure number
        const pureNumber = parseInt(token);
        if (!isNaN(pureNumber) && token === pureNumber.toString()) {
            return { type: 'number' as const, number: pureNumber, original: token };
        }
        
        // Fallback to string sorting for other formats
        return { type: 'string' as const, original: token };
    }, []);

    // Optimized sorting function - memoized to avoid recreation
    const sortStudents = useCallback((studentsToSort: StudentAnalytics[], field: SortField, direction: SortDirection) => {
        return [...studentsToSort].sort((a, b) => {
            let aValue: any = a[field];
            let bValue: any = b[field];

            let result = 0;

            // Handle different data types
            if (field === 'tokenNumber') {
                // Custom token number sorting (optimized)
                const aParsed = parseToken(aValue);
                const bParsed = parseToken(bValue);
                
                // Sort by type first: numbers, then yearS format, then strings
                const typeOrder = { number: 0, yearS: 1, string: 2 };
                const aTypeOrder = typeOrder[aParsed.type] || 2;
                const bTypeOrder = typeOrder[bParsed.type] || 2;
                
                if (aTypeOrder !== bTypeOrder) {
                    result = aTypeOrder - bTypeOrder;
                } else if (aParsed.type === 'number' && bParsed.type === 'number') {
                    result = aParsed.number - bParsed.number;
                } else if (aParsed.type === 'yearS' && bParsed.type === 'yearS') {
                    if (aParsed.year !== bParsed.year) {
                        result = aParsed.year - bParsed.year;
                    } else {
                        result = aParsed.number - bParsed.number;
                    }
                } else {
                    result = aParsed.original.localeCompare(bParsed.original);
                }
            } else if (field === 'firstWorksheetDate' || field === 'lastWorksheetDate') {
                // Date sorting
                if (!aValue && !bValue) result = 0;
                else if (!aValue) result = 1; // null dates go to end
                else if (!bValue) result = -1;
                else {
                    const aDate = new Date(aValue);
                    const bDate = new Date(bValue);
                    result = aDate.getTime() - bDate.getTime();
                }
            } else if (typeof aValue === 'number' && typeof bValue === 'number') {
                // Number sorting
                result = aValue - bValue;
            } else {
                // String sorting
                const aStr = (aValue || '').toString().toLowerCase();
                const bStr = (bValue || '').toString().toLowerCase();
                result = aStr.localeCompare(bStr);
            }

            // Apply sort direction
            return direction === 'desc' ? -result : result;
        });
    }, [parseToken]);    // Memoized filtered and sorted students - only recalculates when dependencies change
    const filteredStudents = useMemo(() => {
        let filtered = [...students];
        
        // Filter by archive status
        if (showArchived === 'active') {
            filtered = filtered.filter(student => !student.isArchived);
        } else if (showArchived === 'archived') {
            filtered = filtered.filter(student => student.isArchived);
        }
        
        // Name/token search using debounced value
        if (debouncedSearchName.trim() !== '') {
            const searchLower = debouncedSearchName.toLowerCase();
            filtered = filtered.filter(student => 
                student.name.toLowerCase().includes(searchLower) ||
                student.username.toLowerCase().includes(searchLower) ||
                (student.tokenNumber && student.tokenNumber.toLowerCase().includes(searchLower))
            );
        }
        
        // Minimum worksheets filter
        if (debouncedMinWorksheets) {
            const minWorksheetsNum = parseInt(debouncedMinWorksheets);
            if (!isNaN(minWorksheetsNum)) {
                filtered = filtered.filter(student => student.totalWorksheets >= minWorksheetsNum);
            }
        }
        
        // Maximum absent rate filter
        if (debouncedMaxAbsentRate) {
            const maxAbsentRateNum = parseFloat(debouncedMaxAbsentRate);
            if (!isNaN(maxAbsentRateNum)) {
                filtered = filtered.filter(student => student.absentPercentage <= maxAbsentRateNum);
            }
        }
        
        // Minimum repetition rate filter
        if (debouncedMinRepetitionRate) {
            const minRepetitionRateNum = parseFloat(debouncedMinRepetitionRate);
            if (!isNaN(minRepetitionRateNum)) {
                filtered = filtered.filter(student => student.repetitionRate >= minRepetitionRateNum);
            }
        }

        // Apply sorting
        return sortStudents(filtered, sortField, sortDirection);
    }, [
        students, 
        showArchived,
        debouncedSearchName, 
        debouncedMinWorksheets, 
        debouncedMaxAbsentRate, 
        debouncedMinRepetitionRate, 
        sortField, 
        sortDirection,
        sortStudents
    ]);

    // Memoized pagination calculations
    const totalPages = useMemo(() => Math.ceil(filteredStudents.length / itemsPerPage), [filteredStudents.length, itemsPerPage]);
    const startIndex = useMemo(() => (currentPage - 1) * itemsPerPage, [currentPage, itemsPerPage]);
    const endIndex = useMemo(() => startIndex + itemsPerPage, [startIndex, itemsPerPage]);
    const paginatedStudents = useMemo(() => filteredStudents.slice(startIndex, endIndex), [filteredStudents, startIndex, endIndex]);
    
    // Reset to first page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [selectedSchoolId, selectedClassId, debouncedSearchName, debouncedMinWorksheets, debouncedMaxAbsentRate, debouncedMinRepetitionRate, showArchived, sortField, sortDirection, enableDateFilter, startDate, endDate]);// Handle sorting - memoized for performance
    const handleSort = useCallback((field: SortField) => {
        if (sortField === field) {
            // Toggle direction if same field
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            // Set new field and default to ascending
            setSortField(field);
            setSortDirection('asc');
        }
    }, [sortField, sortDirection]);

    // Render sort button - memoized to prevent unnecessary re-renders
    const renderSortButton = useCallback((field: SortField, title: string) => {
        const isActive = sortField === field;
        const Icon = isActive 
            ? (sortDirection === 'asc' ? ArrowUp : ArrowDown)
            : ChevronsUpDown;
            
        return (
            <button
                onClick={() => handleSort(field)}
                className="flex items-center gap-1 hover:bg-gray-100 p-1 rounded transition-colors"
                title={`Sort by ${title}`}
                key={field}
            >
                <span>{title}</span>
                <Icon className={`h-4 w-4 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
            </button>
        );
    }, [sortField, sortDirection, handleSort]);    // Handle download - memoized for performance
    const handleDownload = useCallback(async () => {
        setIsDownloading(true);
        try {
            await analyticsAPI.downloadStudentAnalytics({
                schoolId: selectedSchoolId !== 'all' ? selectedSchoolId : undefined,
                classId: selectedClassId !== 'all' ? selectedClassId : undefined,
                startDate: enableDateFilter ? startDate : undefined,
                endDate: enableDateFilter ? endDate : undefined
            });
            toast.success('Analytics data downloaded successfully');
        } catch (error) {
            console.error('Error downloading analytics:', error);
            toast.error('Failed to download analytics data');
        } finally {
            setIsDownloading(false);
        }
    }, [selectedSchoolId, selectedClassId, enableDateFilter, startDate, endDate]);

    // Date range preset functions
    const setDateRange = useCallback((days: number) => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - days);
        
        setStartDate(start.toISOString().split('T')[0]);
        setEndDate(end.toISOString().split('T')[0]);
        setEnableDateFilter(true);
    }, []);

    const setThisWeek = useCallback(() => {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const diff = now.getDate() - dayOfWeek; // Start of this week (Sunday)
        
        const startOfWeek = new Date(now.setDate(diff));
        const endOfWeek = new Date();
        
        setStartDate(startOfWeek.toISOString().split('T')[0]);
        setEndDate(endOfWeek.toISOString().split('T')[0]);
        setEnableDateFilter(true);
    }, []);

    const setLastWeek = useCallback(() => {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const diff = now.getDate() - dayOfWeek - 7; // Start of last week
        
        const startOfLastWeek = new Date(now.setDate(diff));
        const endOfLastWeek = new Date(now.setDate(diff + 6));
        
        setStartDate(startOfLastWeek.toISOString().split('T')[0]);
        setEndDate(endOfLastWeek.toISOString().split('T')[0]);
        setEnableDateFilter(true);
    }, []);

    // Clear all filters - memoized and set token sorting as default
    const clearAllFilters = useCallback(() => {
        setSelectedSchoolId('all');
        setSelectedClassId('all');
        setSearchName('');
        setMinWorksheets('');
        setMaxAbsentRate('');
        setMinRepetitionRate('');
        setShowArchived('active');
        setEnableDateFilter(false);
        setStartDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
        setEndDate(new Date().toISOString().split('T')[0]);
        setSortField('tokenNumber'); // Default to token number sorting
        setSortDirection('asc');
        setCurrentPage(1); // Reset pagination
    }, []);

    // Pagination handlers
    const handlePageChange = useCallback((page: number) => {
        setCurrentPage(page);
    }, []);

    const handleItemsPerPageChange = useCallback((value: string) => {
        setItemsPerPage(parseInt(value));
        setCurrentPage(1); // Reset to first page
    }, []);// Handle student class removal - memoized for performance
    const handleRemoveFromClass = useCallback(async (studentId: string, classId: string) => {
        if (!classId || classId === 'all') return;
        
        try {
            await analyticsAPI.removeStudentFromClass(studentId, classId);
            toast.success('Student removed from class successfully');
              // Refresh student data
            const updatedData = await analyticsAPI.getStudentAnalytics({
                schoolId: selectedSchoolId !== 'all' ? selectedSchoolId : undefined,
                classId: selectedClassId !== 'all' ? selectedClassId : undefined,
                startDate: enableDateFilter ? startDate : undefined,
                endDate: enableDateFilter ? endDate : undefined
            });
            setStudents(updatedData);
        } catch (error) {
            console.error('Error removing student from class:', error);
            toast.error('Failed to remove student from class');
        }
    }, [selectedSchoolId, selectedClassId, enableDateFilter, startDate, endDate]);

    // Handle student archiving - memoized for performance
    const handleArchiveStudent = useCallback(async (studentId: string) => {
        try {
            setActionLoading(studentId);
            await userAPI.archiveStudent(studentId);
            toast.success('Student archived successfully');
            
            // Refresh student data
            const updatedData = await analyticsAPI.getStudentAnalytics({
                schoolId: selectedSchoolId !== 'all' ? selectedSchoolId : undefined,
                classId: selectedClassId !== 'all' ? selectedClassId : undefined,
                startDate: enableDateFilter ? startDate : undefined,
                endDate: enableDateFilter ? endDate : undefined
            });
            setStudents(updatedData);
        } catch (error: any) {
            console.error('Error archiving student:', error);
            toast.error(error.message || 'Failed to archive student');
        } finally {
            setActionLoading(null);
        }
    }, [selectedSchoolId, selectedClassId, enableDateFilter, startDate, endDate]);

    // Handle student unarchiving - memoized for performance
    const handleUnarchiveStudent = useCallback(async (studentId: string) => {
        try {
            setActionLoading(studentId);
            await userAPI.unarchiveStudent(studentId);
            toast.success('Student unarchived successfully');
            
            // Refresh student data
            const updatedData = await analyticsAPI.getStudentAnalytics({
                schoolId: selectedSchoolId !== 'all' ? selectedSchoolId : undefined,
                classId: selectedClassId !== 'all' ? selectedClassId : undefined,
                startDate: enableDateFilter ? startDate : undefined,
                endDate: enableDateFilter ? endDate : undefined
            });
            setStudents(updatedData);
        } catch (error: any) {
            console.error('Error unarchiving student:', error);
            toast.error(error.message || 'Failed to unarchive student');
        } finally {
            setActionLoading(null);
        }
    }, [selectedSchoolId, selectedClassId, enableDateFilter, startDate, endDate]);
    
    // Memoized date formatter to avoid recreation
    const formatDate = useCallback((dateString: string | null) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString();
    }, []);
    
    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Student Analytics</h1>
              {/* Filters */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                        <span>Filters</span>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={clearAllFilters}
                                className="flex items-center gap-2"
                            >
                                <X className="h-4 w-4" />
                                Clear Filters
                            </Button>
                            <Button
                                onClick={handleDownload}
                                disabled={isDownloading}
                                className="flex items-center gap-2"
                                size="sm"
                            >
                                <Download className="h-4 w-4" />
                                {isDownloading ? 'Downloading...' : 'Download CSV'}
                            </Button>
                        </div>
                    </CardTitle>
                    <CardDescription>Filter student data by school, class, and performance metrics</CardDescription>
                </CardHeader>                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                        <div>
                            <label className="block text-sm font-medium mb-1">School</label>
                            <Select
                                value={selectedSchoolId}
                                onValueChange={(value) => setSelectedSchoolId(value)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a school" />
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
                            <label className="block text-sm font-medium mb-1">Class</label>
                            <Select
                                value={selectedClassId}
                                onValueChange={(value) => setSelectedClassId(value)}
                                disabled={!selectedSchoolId || selectedSchoolId === 'all' || classes.length === 0}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={!selectedSchoolId || selectedSchoolId === 'all' ? "Select a school first" : "Select a class"} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Classes</SelectItem>
                                    {classes.map(classItem => (
                                        <SelectItem key={classItem.id} value={classItem.id}>
                                            {classItem.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium mb-1">Status</label>
                            <Select value={showArchived} onValueChange={setShowArchived}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">Active Students</SelectItem>
                                    <SelectItem value="archived">Archived Students</SelectItem>
                                    <SelectItem value="all">All Students</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium mb-1">Search by Name or Token</label>
                            <Input
                                placeholder="Search students..."
                                value={searchName}
                                onChange={(e) => setSearchName(e.target.value)}
                                className="flex items-center"
                            />
                        </div>
                    </div>
                    
                    <div className="pt-4">
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="enableDateFilter"
                                    checked={enableDateFilter}
                                    onChange={(e) => setEnableDateFilter(e.target.checked)}
                                    className="rounded"
                                />
                                <label htmlFor="enableDateFilter" className="text-sm font-medium">
                                    Filter by date range (analyze worksheets within specific period)
                                </label>
                            </div>
                            
                            {enableDateFilter && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Start Date</label>
                                        <Input
                                            type="date"
                                            value={startDate}
                                            onChange={(e) => setStartDate(e.target.value)}
                                            max={endDate}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">End Date</label>
                                        <Input
                                            type="date"
                                            value={endDate}
                                            onChange={(e) => setEndDate(e.target.value)}
                                            min={startDate}
                                            max={new Date().toISOString().split('T')[0]}
                                        />
                                    </div>
                                </div>
                            )}

                            {enableDateFilter && (
                                <div className="space-y-2">
                                    <p className="text-sm font-medium">Quick Date Ranges:</p>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={setLastWeek}
                                            className="text-xs"
                                        >
                                            Last Week
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setDateRange(7)}
                                            className="text-xs"
                                        >
                                            Last 7 Days
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setDateRange(30)}
                                            className="text-xs"
                                        >
                                            Last 30 Days
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setDateRange(90)}
                                            className="text-xs"
                                        >
                                            Last 3 Months
                                        </Button>
                                    </div>
                                </div>
                            )}
                            
                            {enableDateFilter}
                        </div>
                    </div>
                    
                    <div className="pt-4">
                        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                            <Filter className="h-4 w-4" />
                            Advanced Filters
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Min. Total Worksheets</label>
                                <Input
                                    type="number"
                                    placeholder="e.g., 5"
                                    value={minWorksheets}
                                    onChange={(e) => setMinWorksheets(e.target.value)}
                                    min="0"
                                />
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium mb-1">Max. Absent Rate (%)</label>
                                <Input
                                    type="number"
                                    placeholder="e.g., 20"
                                    value={maxAbsentRate}
                                    onChange={(e) => setMaxAbsentRate(e.target.value)}
                                    min="0"
                                    max="100"
                                    step="0.1"
                                />
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium mb-1">Min. Repetition Rate (%)</label>
                                <Input
                                    type="number"
                                    placeholder="e.g., 10"
                                    value={minRepetitionRate}
                                    onChange={(e) => setMinRepetitionRate(e.target.value)}
                                    min="0"
                                    max="100"
                                    step="0.1"
                                />
                            </div>
                        </div>
                    </div>
                </CardContent>            </Card>

            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">
                            {students.filter(s => !s.isArchived).length}
                        </div>
                        <p className="text-sm text-muted-foreground">Active Students</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">
                            {students.filter(s => s.isArchived).length}
                        </div>
                        <p className="text-sm text-muted-foreground">Archived Students</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{filteredStudents.length}</div>
                        <p className="text-sm text-muted-foreground">Filtered Results</p>
                    </CardContent>
                </Card>
            </div>

            {/* Pagination Controls */}
            {filteredStudents.length > 0 && (
                <Card>
                    <CardContent className="p-4">
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">Items per page:</span>
                                <Select value={itemsPerPage.toString()} onValueChange={handleItemsPerPageChange}>
                                    <SelectTrigger className="w-20">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="10">10</SelectItem>
                                        <SelectItem value="20">20</SelectItem>
                                        <SelectItem value="50">50</SelectItem>
                                        <SelectItem value="100">100</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">
                                    Showing {startIndex + 1} to {Math.min(endIndex, filteredStudents.length)} of {filteredStudents.length} results
                                </span>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handlePageChange(currentPage - 1)}
                                    disabled={currentPage === 1}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                    Previous
                                </Button>
                                
                                <div className="flex items-center gap-1">
                                    {/* Show page numbers */}
                                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                        let pageNum;
                                        if (totalPages <= 5) {
                                            pageNum = i + 1;
                                        } else if (currentPage <= 3) {
                                            pageNum = i + 1;
                                        } else if (currentPage >= totalPages - 2) {
                                            pageNum = totalPages - 4 + i;
                                        } else {
                                            pageNum = currentPage - 2 + i;
                                        }
                                        
                                        return (
                                            <Button
                                                key={pageNum}
                                                variant={currentPage === pageNum ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => handlePageChange(pageNum)}
                                                className="w-8 h-8 p-0"
                                            >
                                                {pageNum}
                                            </Button>
                                        );
                                    })}
                                </div>
                                
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handlePageChange(currentPage + 1)}
                                    disabled={currentPage === totalPages}
                                >
                                    Next
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
              {/* Student Analytics Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                        <span>Student Performance Analytics</span>
                        <span className="text-sm font-normal text-muted-foreground">
                            Page {currentPage} of {totalPages} ({filteredStudents.length} total)
                        </span>
                    </CardTitle>
                    <CardDescription>Detailed analytics for each student</CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <p>Loading student analytics...</p>
                        </div>
                    ) : filteredStudents.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            No students found for the selected filters
                        </div>                    ) : (
                        <>
                            {/* Desktop Table View */}
                            <div className="hidden md:block w-full overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[150px] min-w-[120px]">
                                                <div className="flex items-center gap-1">
                                                    {renderSortButton('name', 'Name')}
                                                </div>
                                            </TableHead>
                                            <TableHead className="w-[100px] min-w-[80px]">
                                                <div className="flex items-center gap-1">
                                                    {renderSortButton('tokenNumber', 'Token #')}
                                                </div>
                                            </TableHead>
                                            <TableHead className="w-[150px] min-w-[120px]">
                                                <div className="flex items-center gap-1">
                                                    {renderSortButton('school', 'School')}
                                                </div>
                                            </TableHead>
                                            <TableHead className="w-[100px] min-w-[80px]">
                                                <div className="flex items-center gap-1">
                                                    {renderSortButton('class', 'Class')}
                                                </div>
                                            </TableHead>
                                            <TableHead className="w-[80px] min-w-[60px] hidden lg:table-cell">
                                                <div className="flex items-center gap-1">
                                                    {renderSortButton('totalWorksheets', 'Total Worksheets')}
                                                </div>
                                            </TableHead>
                                            <TableHead className="w-[90px] min-w-[70px] hidden lg:table-cell">
                                                <div className="flex items-center gap-1">
                                                    {renderSortButton('repetitionRate', 'Repetition Rate')}
                                                </div>
                                            </TableHead>
                                            <TableHead className="w-[90px] min-w-[70px] hidden xl:table-cell">
                                                <div className="flex items-center gap-1">
                                                    {renderSortButton('absentPercentage', 'Absent %')}
                                                </div>
                                            </TableHead>
                                            <TableHead className="w-[100px] min-w-[80px] hidden xl:table-cell">
                                                <div className="flex items-center gap-1">
                                                    {renderSortButton('lastWorksheetDate', 'Last Worksheet')}
                                                </div>
                                            </TableHead>
                                            <TableHead className="w-[80px] min-w-[60px]">
                                                <span className="truncate">Status</span>
                                            </TableHead>
                                            <TableHead className="w-[120px] min-w-[100px]">
                                                <span className="truncate">Actions</span>
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {paginatedStudents.map(student => (
                                            <TableRow key={student.id}>
                                                <TableCell className="font-medium">
                                                    <div className="truncate max-w-[140px]" title={student.name}>
                                                        {student.name}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="truncate max-w-[90px]" title={student.tokenNumber || 'N/A'}>
                                                        {student.tokenNumber || 'N/A'}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="truncate max-w-[140px]" title={student.school}>
                                                        {student.school}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="truncate max-w-[90px]" title={student.class}>
                                                        {student.class}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="hidden lg:table-cell text-center">
                                                    {student.totalWorksheets}
                                                </TableCell>
                                                <TableCell className="hidden lg:table-cell text-center">
                                                    {student.repetitionRate.toFixed(1)}%
                                                </TableCell>
                                                <TableCell className="hidden xl:table-cell text-center">
                                                    {student.absentPercentage.toFixed(1)}%
                                                </TableCell>
                                                <TableCell className="hidden xl:table-cell">
                                                    <div className="truncate max-w-[90px]" title={formatDate(student.lastWorksheetDate)}>
                                                        {formatDate(student.lastWorksheetDate)}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge 
                                                        variant={student.isArchived ? "secondary" : "default"}
                                                        className={`text-xs ${student.isArchived ? "bg-gray-100 text-gray-800" : ""}`}
                                                    >
                                                        {student.isArchived ? 'Archived' : 'Active'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1 min-w-[100px]">
                                                        {student.isArchived ? (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => handleUnarchiveStudent(student.id)}
                                                                disabled={actionLoading === student.id}
                                                                className="h-7 px-2 text-xs"
                                                            >
                                                                <ArchiveRestore className="h-3 w-3 mr-1" />
                                                                {actionLoading === student.id ? 'Unarchiving...' : 'Unarchive'}
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => handleArchiveStudent(student.id)}
                                                                disabled={actionLoading === student.id}
                                                                className="h-7 px-2 text-xs"
                                                            >
                                                                <Archive className="h-3 w-3 mr-1" />
                                                                {actionLoading === student.id ? 'Archiving...' : 'Archive'}
                                                            </Button>
                                                        )}
                                                        {selectedClassId && selectedClassId !== 'all' && (
                                                            <Button
                                                                size="sm"
                                                                variant="default"
                                                                onClick={() => handleRemoveFromClass(student.id, selectedClassId)}
                                                                className="h-7 px-2 text-xs"
                                                            >
                                                                Remove
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Mobile Card View */}
                            <div className="md:hidden space-y-4">
                                {paginatedStudents.map(student => (
                                    <Card key={student.id} className="p-4">
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="flex-1">
                                                <h3 className="font-semibold text-sm">{student.name}</h3>
                                                <p className="text-xs text-muted-foreground">Token: {student.tokenNumber || 'N/A'}</p>
                                                <p className="text-xs text-muted-foreground">{student.class} • {student.school}</p>
                                            </div>
                                            <Badge 
                                                variant={student.isArchived ? "secondary" : "default"}
                                                className={`text-xs ${student.isArchived ? "bg-gray-100 text-gray-800" : ""}`}
                                            >
                                                {student.isArchived ? 'Archived' : 'Active'}
                                            </Badge>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                                            <div>
                                                <span className="text-muted-foreground">Total:</span>
                                                <span className="ml-1 font-medium">{student.totalWorksheets}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Rep. Rate:</span>
                                                <span className="ml-1 font-medium">{student.repetitionRate.toFixed(1)}%</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Absent %:</span>
                                                <span className="ml-1 font-medium">{student.absentPercentage.toFixed(1)}%</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Last Activity:</span>
                                                <span className="ml-1 font-medium">{formatDate(student.lastWorksheetDate)}</span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex gap-2">
                                            {student.isArchived ? (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleUnarchiveStudent(student.id)}
                                                    disabled={actionLoading === student.id}
                                                    className="flex-1 h-8 text-xs"
                                                >
                                                    <ArchiveRestore className="h-3 w-3 mr-1" />
                                                    {actionLoading === student.id ? 'Unarchiving...' : 'Unarchive'}
                                                </Button>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleArchiveStudent(student.id)}
                                                    disabled={actionLoading === student.id}
                                                    className="flex-1 h-8 text-xs"
                                                >
                                                    <Archive className="h-3 w-3 mr-1" />
                                                    {actionLoading === student.id ? 'Archiving...' : 'Archive'}
                                                </Button>
                                            )}
                                            {selectedClassId && selectedClassId !== 'all' && (
                                                <Button
                                                    size="sm"
                                                    variant="default"
                                                    onClick={() => handleRemoveFromClass(student.id, selectedClassId)}
                                                    className="flex-1 h-8 text-xs"
                                                >
                                                    Remove
                                                </Button>
                                            )}
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        </>
                    
                    )}
                </CardContent>
            </Card>
        </div>
    );
}