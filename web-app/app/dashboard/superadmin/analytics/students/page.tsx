'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { analyticsAPI, School, Class, StudentAnalytics } from '@/lib/api/analyticsAPI';
import { toast } from 'sonner';
import { Download, Filter, X } from 'lucide-react';

export default function StudentAnalyticsPage() {
    // Filter state
    const [schools, setSchools] = useState<School[]>([]);
    const [classes, setClasses] = useState<Class[]>([]);    const [selectedSchoolId, setSelectedSchoolId] = useState<string>('all');
    const [selectedClassId, setSelectedClassId] = useState<string>('all');
    const [searchName, setSearchName] = useState<string>('');
    
    // Additional filter states
    const [minWorksheets, setMinWorksheets] = useState<string>('');
    const [maxAbsentRate, setMaxAbsentRate] = useState<string>('');
    const [minRepetitionRate, setMinRepetitionRate] = useState<string>('');
    const [isDownloading, setIsDownloading] = useState<boolean>(false);
    
    // Data state
    const [students, setStudents] = useState<StudentAnalytics[]>([]);
    const [filteredStudents, setFilteredStudents] = useState<StudentAnalytics[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    
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
                    classId: selectedClassId !== 'all' ? selectedClassId : undefined
                });
                setStudents(data);
            } catch (error) {
                console.error('Error loading student analytics:', error);
                toast.error('Failed to load student analytics');
            } finally {
                setIsLoading(false);
            }
        };
        
        loadStudentAnalytics();
    }, [selectedSchoolId, selectedClassId]);
      // Filter students by name and additional criteria when any filter changes
    useEffect(() => {
        let filtered = [...students];
        
        // Name/token search
        if (searchName.trim() !== '') {
            const searchLower = searchName.toLowerCase();
            filtered = filtered.filter(student => 
                student.name.toLowerCase().includes(searchLower) ||
                student.username.toLowerCase().includes(searchLower) ||
                (student.tokenNumber && student.tokenNumber.toLowerCase().includes(searchLower))
            );
        }
        
        // Minimum worksheets filter
        if (minWorksheets) {
            const minWorksheetsNum = parseInt(minWorksheets);
            if (!isNaN(minWorksheetsNum)) {
                filtered = filtered.filter(student => student.totalWorksheets >= minWorksheetsNum);
            }
        }
        
        // Maximum absent rate filter
        if (maxAbsentRate) {
            const maxAbsentRateNum = parseFloat(maxAbsentRate);
            if (!isNaN(maxAbsentRateNum)) {
                filtered = filtered.filter(student => student.absentPercentage <= maxAbsentRateNum);
            }
        }
        
        // Minimum repetition rate filter
        if (minRepetitionRate) {
            const minRepetitionRateNum = parseFloat(minRepetitionRate);
            if (!isNaN(minRepetitionRateNum)) {
                filtered = filtered.filter(student => student.repetitionRate >= minRepetitionRateNum);
            }
        }
        
        setFilteredStudents(filtered);
    }, [searchName, students, minWorksheets, maxAbsentRate, minRepetitionRate]);
    
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

    // Clear all filters
    const clearAllFilters = () => {
        setSelectedSchoolId('all');
        setSelectedClassId('all');
        setSearchName('');
        setMinWorksheets('');
        setMaxAbsentRate('');
        setMinRepetitionRate('');
    };

    // Handle student class removal
    const handleRemoveFromClass = async (studentId: string, classId: string) => {
        if (!classId || classId === 'all') return;
        
        try {
            await analyticsAPI.removeStudentFromClass(studentId, classId);
            toast.success('Student removed from class successfully');
              // Refresh student data
            const updatedData = await analyticsAPI.getStudentAnalytics({
                schoolId: selectedSchoolId !== 'all' ? selectedSchoolId : undefined,
                classId: selectedClassId !== 'all' ? selectedClassId : undefined
            });
            setStudents(updatedData);
        } catch (error) {
            console.error('Error removing student from class:', error);
            toast.error('Failed to remove student from class');
        }
    };
    
    const formatDate = (dateString: string | null) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString();
    };
    
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
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
                            <label className="block text-sm font-medium mb-1">Search by Name or Token</label>
                            <Input
                                placeholder="Search students..."
                                value={searchName}
                                onChange={(e) => setSearchName(e.target.value)}
                                className="flex items-center"
                            />
                        </div>
                    </div>
                    
                    {/* Enhanced Filters */}
                    <div className="border-t pt-4">
                        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                            <Filter className="h-4 w-4" />
                            Advanced Filters
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Min. Worksheets</label>
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
                </CardContent>
            </Card>
              {/* Student Analytics Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                        <span>Student Performance Analytics</span>
                        <span className="text-sm font-normal text-muted-foreground">
                            Showing {filteredStudents.length} of {students.length} students
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
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse">                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left py-3 px-4 font-medium">Name</th>
                                        <th className="text-left py-3 px-4 font-medium">Token #</th>
                                        <th className="text-left py-3 px-4 font-medium">School</th>
                                        <th className="text-left py-3 px-4 font-medium">Class</th>
                                        <th className="text-left py-3 px-4 font-medium">Total Worksheets</th>
                                        <th className="text-left py-3 px-4 font-medium">Repetition Rate</th>
                                        <th className="text-left py-3 px-4 font-medium">Absent %</th>
                                        <th className="text-left py-3 px-4 font-medium">First Worksheet</th>
                                        <th className="text-left py-3 px-4 font-medium">Last Worksheet</th>
                                        <th className="text-left py-3 px-4 font-medium">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredStudents.map(student => (
                                        <tr key={student.id} className="border-b hover:bg-gray-50">
                                            <td className="py-3 px-4">{student.name}</td>
                                            <td className="py-3 px-4">{student.tokenNumber || 'N/A'}</td>
                                            <td className="py-3 px-4">{student.school}</td>
                                            <td className="py-3 px-4">{student.class}</td>
                                            <td className="py-3 px-4">{student.totalWorksheets}</td>
                                            <td className="py-3 px-4">
                                                {student.repetitionRate.toFixed(1)}%
                                            </td>
                                            <td className="py-3 px-4">
                                                {student.absentPercentage.toFixed(1)}%
                                            </td>
                                            <td className="py-3 px-4">
                                                {formatDate(student.firstWorksheetDate)}
                                            </td>
                                            <td className="py-3 px-4">
                                                {formatDate(student.lastWorksheetDate)}
                                            </td>
                                            <td className="py-3 px-4">
                                                {selectedClassId && selectedClassId !== 'all' && (
                                                    <Button
                                                        size="sm"
                                                        variant="default"
                                                        onClick={() => handleRemoveFromClass(student.id, selectedClassId)}
                                                    >
                                                        Remove from Class
                                                    </Button>
                                                )}
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