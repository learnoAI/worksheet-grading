'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { userAPI } from '@/lib/api/user';
import { analyticsAPI } from '@/lib/api/analytics';
import { UserRole } from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface School {
    id: string;
    name: string;
}

interface Class {
    id: string;
    name: string;
    schoolId: string;
}

export default function CreateUserPage() {
    const router = useRouter();
    const { user, isLoading } = useAuth();
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [tokenNumber, setTokenNumber] = useState('');
    const [selectedRole, setSelectedRole] = useState<string>(UserRole.TEACHER);
    const [selectedSchool, setSelectedSchool] = useState<string>('');
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);
    
    // Data for dropdowns
    const [schools, setSchools] = useState<School[]>([]);
    const [classes, setClasses] = useState<Class[]>([]);
    const [loadingData, setLoadingData] = useState(true);

    useEffect(() => {
        // Redirect if not logged in or not a superadmin
        if (!isLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('You do not have permission to access this page');
            router.push('/dashboard');
        } else if (!isLoading && user?.role === UserRole.SUPERADMIN) {
            loadInitialData();
        }
    }, [user, isLoading, router]);

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
            router.push('/dashboard/superadmin');
        } catch (error: any) {
            console.error('Error creating user:', error);
            toast.error(error.message || 'Failed to create user');
        } finally {
            setSubmitting(false);
        }
    };

    if (isLoading || loadingData) {
        return <div className="flex justify-center items-center h-full">Loading...</div>;
    }

    if (!user || user.role !== UserRole.SUPERADMIN) {
        return null; // This shouldn't be visible due to redirect in useEffect
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Create New User</h1>
                <Button variant="outline" asChild>
                    <Link href="/dashboard/superadmin">Back to Users</Link>
                </Button>
            </div>

            <Card>
                <form onSubmit={handleSubmit}>
                    <CardHeader>
                        <CardTitle>User Details</CardTitle>
                        <CardDescription>Create a new user account</CardDescription>
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
                                placeholder="Enter password"
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
                                    <SelectItem value={UserRole.TEACHER}>Teacher</SelectItem>
                                    <SelectItem value={UserRole.STUDENT}>Student</SelectItem>
                                    <SelectItem value={UserRole.ADMIN}>Admin</SelectItem>
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

                        {/* School Selection for Admin or when selecting class */}
                        {(selectedRole === UserRole.ADMIN || selectedRole === UserRole.STUDENT || selectedRole === UserRole.TEACHER) && (
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
                                {selectedRole === UserRole.ADMIN && (
                                    <p className="text-sm text-gray-500">
                                        Admin will be assigned to this school
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Class Selection for Students and Teachers */}
                        {(selectedRole === UserRole.STUDENT || selectedRole === UserRole.TEACHER) && selectedSchool && (
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
                    <CardFooter>
                        <Button type="submit" disabled={submitting}>
                            {submitting ? 'Creating...' : 'Create User'}
                        </Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    );
}
