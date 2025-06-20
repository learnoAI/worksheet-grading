'use client';

import { useState, useEffect } from 'react';
import { userAPI } from '@/lib/api/user';
import { analyticsAPI } from '@/lib/api/analytics';
import { UserRole } from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { X } from 'lucide-react';

interface School {
    id: string;
    name: string;
}

interface Class {
    id: string;
    name: string;
    schoolId: string;
}

interface CreateUserFormProps {
    onClose: () => void;
    onSuccess: () => void;
    allowedRoles?: UserRole[];
    defaultSchool?: string;
    defaultClass?: string;
}

export function CreateUserForm({ 
    onClose, 
    onSuccess, 
    allowedRoles = [UserRole.TEACHER, UserRole.STUDENT],
    defaultSchool,
    defaultClass
}: CreateUserFormProps) {
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [tokenNumber, setTokenNumber] = useState('');
    const [selectedRole, setSelectedRole] = useState<string>(allowedRoles[0]);
    const [selectedSchool, setSelectedSchool] = useState<string>(defaultSchool || '');
    const [selectedClass, setSelectedClass] = useState<string>(defaultClass || '');
    const [submitting, setSubmitting] = useState(false);
    
    // Data for dropdowns
    const [schools, setSchools] = useState<School[]>([]);
    const [classes, setClasses] = useState<Class[]>([]);
    const [loadingData, setLoadingData] = useState(true);

    useEffect(() => {
        loadInitialData();
    }, []);

    // Load classes when school changes
    useEffect(() => {
        if (selectedSchool) {
            loadClasses();
        } else {
            setClasses([]);
            setSelectedClass('');
        }
    }, [selectedSchool]);

    const loadInitialData = async () => {
        try {
            setLoadingData(true);
            const schoolsData = await analyticsAPI.getAllSchools();
            setSchools(schoolsData);
            
            // If defaultSchool is provided, load its classes
            if (defaultSchool) {
                const classesData = await analyticsAPI.getClassesBySchool(defaultSchool);
                setClasses(classesData);
            }
        } catch (error) {
            console.error('Error loading data:', error);
            toast.error('Failed to load data');
        } finally {
            setLoadingData(false);
        }
    };

    const loadClasses = async () => {
        try {
            const classesData = await analyticsAPI.getClassesBySchool(selectedSchool);
            setClasses(classesData);
        } catch (error) {
            console.error('Error loading classes:', error);
            toast.error('Failed to load classes');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!name || !username || !password) {
            toast.error('Name, username and password are required');
            return;
        }

        if (password.length < 6) {
            toast.error('Password must be at least 6 characters');
            return;
        }

        // Validation for student
        if (selectedRole === UserRole.STUDENT) {
            if (!tokenNumber) {
                toast.error('Token number is required for students');
                return;
            }
            if (!selectedClass) {
                toast.error('Class selection is required for students');
                return;
            }
        }

        // Validation for teacher
        if (selectedRole === UserRole.TEACHER && !selectedClass) {
            toast.error('Class selection is required for teachers');
            return;
        }

        try {
            setSubmitting(true);

            const userData: any = {
                name,
                username,
                password,
                role: selectedRole
            };

            // Add token number for students
            if (selectedRole === UserRole.STUDENT && tokenNumber) {
                userData.tokenNumber = tokenNumber;
            }

            // Add class for students and teachers
            if (selectedClass && (selectedRole === UserRole.STUDENT || selectedRole === UserRole.TEACHER)) {
                userData.classId = selectedClass;
            }

            // Add school for admins
            if (selectedRole === UserRole.ADMIN && selectedSchool) {
                userData.schoolId = selectedSchool;
            }

            await userAPI.createUser(userData);

            toast.success(`${selectedRole.toLowerCase()} created successfully`);
            onSuccess();
        } catch (error: any) {
            console.error('Error creating user:', error);
            toast.error(error.message || 'Failed to create user');
        } finally {
            setSubmitting(false);
        }
    };

    if (loadingData) {
        return (
            <Card className="w-full max-w-2xl">
                <CardContent className="p-6">
                    <div className="flex justify-center items-center h-32">Loading...</div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="w-full max-w-2xl">
            <form onSubmit={handleSubmit}>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle>Create New User</CardTitle>
                            <CardDescription>Add a new student or teacher to the system</CardDescription>
                        </div>
                        <Button 
                            type="button" 
                            variant="ghost" 
                            size="sm" 
                            onClick={onClose}
                            className="h-8 w-8 p-0"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">Full Name</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter full name"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="username">Username</Label>
                        <Input
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter username"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <Input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter password (min 6 characters)"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="role">User Role</Label>
                        <Select value={selectedRole} onValueChange={setSelectedRole}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                            <SelectContent>
                                {allowedRoles.map(role => (
                                    <SelectItem key={role} value={role}>
                                        {role === UserRole.TEACHER ? 'Teacher' : 'Student'}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Token Number for Students */}
                    {selectedRole === UserRole.STUDENT && (
                        <div className="space-y-2">
                            <Label htmlFor="tokenNumber">Token Number</Label>
                            <Input
                                id="tokenNumber"
                                value={tokenNumber}
                                onChange={(e) => setTokenNumber(e.target.value)}
                                placeholder="Enter token number"
                                required
                            />
                        </div>
                    )}

                    {/* School Selection */}
                    <div className="space-y-2">
                        <Label htmlFor="school">School</Label>
                        <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select school" />
                            </SelectTrigger>
                            <SelectContent>
                                {schools.map(school => (
                                    <SelectItem key={school.id} value={school.id}>
                                        {school.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Class Selection */}
                    {selectedSchool && (
                        <div className="space-y-2">
                            <Label htmlFor="class">Class</Label>
                            <Select value={selectedClass} onValueChange={setSelectedClass}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select class" />
                                </SelectTrigger>
                                <SelectContent>
                                    {classes.map(cls => (
                                        <SelectItem key={cls.id} value={cls.id}>
                                            {cls.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-sm text-gray-500">
                                {selectedRole === UserRole.STUDENT ? 'Student will be assigned to this class' : 'Teacher will be assigned to this class'}
                            </p>
                        </div>
                    )}
                </CardContent>
                <CardFooter className="flex justify-end space-x-2">
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={submitting}>
                        {submitting ? 'Creating...' : 'Create User'}
                    </Button>
                </CardFooter>
            </form>
        </Card>
    );
}
