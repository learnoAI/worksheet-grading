'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { analyticsAPI, School, Class, StudentAnalytics } from '@/lib/api/analytics';
import { toast } from 'sonner';

export default function StudentAnalyticsPage() {
    // Filter state
    const [schools, setSchools] = useState<School[]>([]);
    const [classes, setClasses] = useState<Class[]>([]);
    const [selectedSchoolId, setSelectedSchoolId] = useState<string>('all');
    const [selectedClassId, setSelectedClassId] = useState<string>('all');
    const [searchName, setSearchName] = useState<string>('');
    
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
                const data = await analyticsAPI.getStudentAnalytics(
                    selectedSchoolId !== 'all' ? selectedSchoolId : undefined,
                    selectedClassId !== 'all' ? selectedClassId : undefined
                );
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
    
    // Filter students by name when search changes
    useEffect(() => {
        if (searchName.trim() === '') {
            setFilteredStudents(students);
        } else {
            const searchLower = searchName.toLowerCase();
            setFilteredStudents(
                students.filter(student => 
                    student.name.toLowerCase().includes(searchLower) ||
                    student.username.toLowerCase().includes(searchLower) ||
                    (student.tokenNumber && student.tokenNumber.toLowerCase().includes(searchLower))
                )
            );
        }
    }, [searchName, students]);
    
    // Handle student class removal
    const handleRemoveFromClass = async (studentId: string, classId: string) => {
        if (!classId || classId === 'all') return;
        
        try {
            await analyticsAPI.removeStudentFromClass(studentId, classId);
            toast.success('Student removed from class successfully');
            
            // Refresh student data
            const updatedData = await analyticsAPI.getStudentAnalytics(
                selectedSchoolId !== 'all' ? selectedSchoolId : undefined,
                selectedClassId !== 'all' ? selectedClassId : undefined
            );
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
                    <CardTitle>Filters</CardTitle>
                    <CardDescription>Filter student data by school, class, and name</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>
            
            {/* Student Analytics Table */}
            <Card>
                <CardHeader>
                    <CardTitle>Student Performance Analytics</CardTitle>
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
                            <table className="w-full border-collapse">
                                <thead>
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
                                                        variant="destructive"
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