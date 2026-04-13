'use client';

import { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { userAPI } from '@/lib/api/user';
import { classAPI } from '@/lib/api/class';
import { analyticsAPI, Class as AnalyticsClass, School as AnalyticsSchool } from '@/lib/api/analyticsAPI';
import { User, UserRole} from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { 
    Dialog, 
    DialogContent, 
    DialogDescription, 
    DialogFooter, 
    DialogHeader, 
    DialogTitle 
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { 
    Search, 
    Filter, 
    RefreshCw, 
    UserPlus, 
    Edit, 
    Archive, 
    ArchiveRestore,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Users,
    GraduationCap,
    BookOpen,
    Shield,
    Crown,
    X
} from 'lucide-react';
import Link from 'next/link';
import { Skeleton, SkeletonStyles } from '@/components/ui/skeleton';
import { HeadingActionSkeleton, TableSkeleton } from '@/components/superadmin/skeletons';

interface UserWithDetails extends Omit<User, 'studentClasses' | 'teacherClasses' | 'adminSchools'> {
    studentClasses?: Array<{
        class: {
            id: string;
            name: string;
            school: {
                id: string;
                name: string;
            };
        };
    }>;
    teacherClasses?: Array<{
        class: {
            id: string;
            name: string;
            school: {
                id: string;
                name: string;
            };
        };
    }>;
    adminSchools?: Array<{
        school: {
            id: string;
            name: string;
        };
    }>;
}

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

const ITEMS_PER_PAGE = 30;

const UsersPageSkeleton = memo(() => (
    <div className="space-y-6">
        <SkeletonStyles />
        <div className="flex justify-between items-center">
            <Skeleton className="h-8 w-72" />
            <div className="flex gap-2">
                <Skeleton className="h-9 w-40" />
                <Skeleton className="h-9 w-40" />
            </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Array.from({length:4}).map((_,i)=>(
                <div key={i} className="border rounded-lg p-4 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-6 w-20" />
                </div>
            ))}
        </div>
        <div className="border rounded-lg p-4 space-y-4">
            <Skeleton className="h-5 w-40" />
            <div className="flex flex-wrap gap-3">
                {Array.from({length:6}).map((_,i)=>(
                    <Skeleton key={i} className="h-9 w-32" />
                ))}
            </div>
            <TableSkeleton rows={7} columns={6} />
        </div>
    </div>
));

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

// Edit User Modal Component
const EditUserModal = memo(({ user, isOpen, onClose, onSuccess }: {
    user: UserWithDetails | null;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}) => {
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [role, setRole] = useState('');
    const [tokenNumber, setTokenNumber] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // School and class management
    const [schools, setSchools] = useState<AnalyticsSchool[]>([]);
    const [classes, setClasses] = useState<AnalyticsClass[]>([]);
    const [selectedSchool, setSelectedSchool] = useState('');
    const [loadingSchools, setLoadingSchools] = useState(false);
    const [loadingClasses, setLoadingClasses] = useState(false);

    // Track current class assignments (mutable during editing)
    const [assignedClassIds, setAssignedClassIds] = useState<Set<string>>(new Set());
    const [classesToAdd, setClassesToAdd] = useState<Set<string>>(new Set());
    const [classesToRemove, setClassesToRemove] = useState<Set<string>>(new Set());

    // Get the user's current classes for display
    const currentUserClasses = useMemo(() => {
        if (!user) return [];
        if (role === UserRole.STUDENT && user.studentClasses) {
            return user.studentClasses.map(sc => ({ id: sc.class.id, name: sc.class.name, schoolName: sc.class.school.name, schoolId: sc.class.school.id }));
        }
        if (role === UserRole.TEACHER && user.teacherClasses) {
            return user.teacherClasses.map(tc => ({ id: tc.class.id, name: tc.class.name, schoolName: tc.class.school.name, schoolId: tc.class.school.id }));
        }
        return [];
    }, [user, role]);

    // Effective list: current minus removals plus additions
    const effectiveClasses = useMemo(() => {
        const kept = currentUserClasses.filter(c => !classesToRemove.has(c.id));
        const added = classes.filter(c => classesToAdd.has(c.id)).map(c => {
            const school = schools.find(s => s.id === selectedSchool);
            return { id: c.id, name: c.name, schoolName: school?.name || '', schoolId: selectedSchool };
        });
        return [...kept, ...added];
    }, [currentUserClasses, classesToRemove, classesToAdd, classes, schools, selectedSchool]);

    useEffect(() => {
        if (user) {
            setName(user.name || '');
            setUsername(user.username || '');
            setRole(user.role || '');
            setTokenNumber(user.tokenNumber || '');
            setClassesToAdd(new Set());
            setClassesToRemove(new Set());

            // Set school from first class assignment
            if (user.role === UserRole.STUDENT && user.studentClasses && user.studentClasses.length > 0) {
                setSelectedSchool(user.studentClasses[0].class.school.id);
                setAssignedClassIds(new Set(user.studentClasses.map(sc => sc.class.id)));
            } else if (user.role === UserRole.TEACHER && user.teacherClasses && user.teacherClasses.length > 0) {
                setSelectedSchool(user.teacherClasses[0].class.school.id);
                setAssignedClassIds(new Set(user.teacherClasses.map(tc => tc.class.id)));
            } else {
                setSelectedSchool('');
                setAssignedClassIds(new Set());
            }
        }
    }, [user]);

    useEffect(() => {
        if (isOpen) loadSchools();
    }, [isOpen]);

    useEffect(() => {
        if (selectedSchool) {
            loadClasses(selectedSchool);
        } else {
            setClasses([]);
        }
    }, [selectedSchool]);

    const loadSchools = async () => {
        try {
            setLoadingSchools(true);
            setSchools(await analyticsAPI.getAllSchools());
        } catch (error) {
            toast.error('Failed to load schools');
        } finally {
            setLoadingSchools(false);
        }
    };

    const loadClasses = async (schoolId: string) => {
        try {
            setLoadingClasses(true);
            setClasses(await analyticsAPI.getClassesBySchool(schoolId));
        } catch (error) {
            toast.error('Failed to load classes');
        } finally {
            setLoadingClasses(false);
        }
    };

    const handleSchoolChange = (newSchoolId: string) => {
        if (newSchoolId === selectedSchool) return;
        // Switching school: mark all current classes for removal
        setClassesToRemove(new Set(currentUserClasses.map(c => c.id)));
        setClassesToAdd(new Set());
        setSelectedSchool(newSchoolId);
    };

    const handleAddClass = (classId: string) => {
        // If it was originally assigned and marked for removal, just un-remove it
        if (assignedClassIds.has(classId)) {
            setClassesToRemove(prev => { const next = new Set(prev); next.delete(classId); return next; });
        } else {
            setClassesToAdd(prev => new Set(prev).add(classId));
        }
    };

    const handleRemoveClass = (classId: string) => {
        if (classesToAdd.has(classId)) {
            setClassesToAdd(prev => { const next = new Set(prev); next.delete(classId); return next; });
        } else {
            setClassesToRemove(prev => new Set(prev).add(classId));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        if (!name || !username) {
            toast.error('Name and username are required');
            return;
        }

        if ((role === UserRole.STUDENT || role === UserRole.TEACHER) && effectiveClasses.length === 0) {
            toast.error('At least one class assignment is required');
            return;
        }

        try {
            setSubmitting(true);

            const updateData: any = { name, username };
            if (role === UserRole.STUDENT && tokenNumber) {
                updateData.tokenNumber = tokenNumber;
            }
            await userAPI.updateUser(user.id, updateData);

            // Process class removals
            for (const classId of classesToRemove) {
                try {
                    if (role === UserRole.STUDENT) {
                        await analyticsAPI.removeStudentFromClass(user.id, classId);
                    } else if (role === UserRole.TEACHER) {
                        await classAPI.removeTeacherFromClass(classId, user.id);
                    }
                } catch (error) {
                    console.warn(`Could not remove from class ${classId}:`, error);
                }
            }

            // Process class additions
            for (const classId of classesToAdd) {
                try {
                    if (role === UserRole.STUDENT) {
                        await analyticsAPI.addStudentToClass(user.id, classId);
                    } else if (role === UserRole.TEACHER) {
                        await classAPI.addTeacherToClass(classId, user.id);
                    }
                } catch (error) {
                    console.warn(`Could not add to class ${classId}:`, error);
                }
            }

            toast.success('User updated successfully');
            onSuccess();
            onClose();
        } catch (error: any) {
            toast.error(error.message || 'Failed to update user');
        } finally {
            setSubmitting(false);
        }
    };

    const handleClose = () => {
        setName(''); setUsername(''); setRole(''); setTokenNumber('');
        setSelectedSchool('');
        setSchools([]); setClasses([]);
        setClassesToAdd(new Set()); setClassesToRemove(new Set());
        setAssignedClassIds(new Set());
        onClose();
    };

    const hasChanges = classesToAdd.size > 0 || classesToRemove.size > 0;

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit User</DialogTitle>
                    <DialogDescription>
                        Update user information and class assignments
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <Label htmlFor="name">Full Name</Label>
                        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter full name" required />
                    </div>

                    <div>
                        <Label htmlFor="username">Username</Label>
                        <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter username" required />
                    </div>

                    <div>
                        <Label>Role</Label>
                        <Input
                            value={role === UserRole.STUDENT ? 'Student' : role === UserRole.TEACHER ? 'Teacher' : role === UserRole.ADMIN ? 'Admin' : 'Superadmin'}
                            disabled className="bg-gray-100"
                        />
                    </div>

                    {role === UserRole.STUDENT && (
                        <div>
                            <Label htmlFor="tokenNumber">Token Number</Label>
                            <Input id="tokenNumber" value={tokenNumber} onChange={(e) => setTokenNumber(e.target.value)} placeholder="Enter token number" />
                        </div>
                    )}

                    {/* School info for admins (read-only) */}
                    {role === UserRole.ADMIN && user?.adminSchools && user.adminSchools.length > 0 && (
                        <div>
                            <Label>School</Label>
                            <Input value={user.adminSchools.map(as => as.school.name).join(', ')} disabled className="bg-gray-100" />
                        </div>
                    )}

                    {/* School & class management for students and teachers */}
                    {(role === UserRole.STUDENT || role === UserRole.TEACHER) && (
                        <>
                            <div>
                                <Label>School</Label>
                                <Select value={selectedSchool} onValueChange={handleSchoolChange} disabled={loadingSchools || submitting}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={loadingSchools ? "Loading..." : "Select school"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {schools.map(school => (
                                            <SelectItem key={school.id} value={school.id}>{school.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Class multi-select */}
                            <div>
                                <Label>Classes</Label>
                                {loadingClasses ? (
                                    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                                        <Loader2 className="h-3 w-3 animate-spin" /> Loading classes...
                                    </div>
                                ) : !selectedSchool ? (
                                    <p className="text-sm text-muted-foreground py-2">Select a school first</p>
                                ) : classes.length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-2">No classes in this school</p>
                                ) : (
                                    <div className="space-y-1 mt-1 max-h-48 overflow-y-auto border rounded-md p-2">
                                        {classes.map(cls => {
                                            const isAssigned = effectiveClasses.some(c => c.id === cls.id);
                                            return (
                                                <button
                                                    key={cls.id}
                                                    type="button"
                                                    disabled={submitting}
                                                    onClick={() => isAssigned ? handleRemoveClass(cls.id) : handleAddClass(cls.id)}
                                                    className={`w-full flex items-center justify-between rounded px-3 py-1.5 text-sm text-left transition-colors ${
                                                        isAssigned
                                                            ? 'bg-blue-50 border border-blue-200 text-blue-900'
                                                            : 'bg-gray-50 hover:bg-gray-100 text-gray-700'
                                                    }`}
                                                >
                                                    <span>{cls.name}</span>
                                                    {isAssigned && <X className="h-3 w-3 text-blue-500" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {hasChanges && (
                                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                                    {classesToAdd.size > 0 && `${classesToAdd.size} class(es) to add. `}
                                    {classesToRemove.size > 0 && `${classesToRemove.size} class(es) to remove. `}
                                    Changes apply on save.
                                </p>
                            )}
                        </>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
                        <Button type="submit" disabled={submitting || (role === UserRole.STUDENT && effectiveClasses.length === 0)}>
                            {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating...</>) : 'Update User'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
});

export default function UsersPage() {
    const { user, isLoading } = useAuth();
    const router = useRouter();
    
    // Core data state
    const [users, setUsers] = useState<UserWithDetails[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchLoading, setSearchLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    
    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [hasNextPage, setHasNextPage] = useState(false);
    const [hasPrevPage, setHasPrevPage] = useState(false);
    
    // Filters with debouncing
    const [selectedRole, setSelectedRole] = useState<string>('all');
    const [showArchived, setShowArchived] = useState<string>('active');
    const [searchTerm, setSearchTerm] = useState<string>('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    
    // Edit modal state
    const [selectedUser, setSelectedUser] = useState<UserWithDetails | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [selectedRole, showArchived, debouncedSearchTerm]);

    // Initial load and auth check
    useEffect(() => {
        if (!isLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('Access denied');
            router.push('/dashboard');
        } else if (!isLoading && user?.role === UserRole.SUPERADMIN) {
            // Only load on initial mount
            loadUsers(false);
        }
    }, [user, isLoading, router]);

    // Load users when filters change (excluding search)
    useEffect(() => {
        if (user?.role === UserRole.SUPERADMIN) {
            loadUsers(false);
        }
    }, [currentPage, selectedRole, showArchived]);

    // Load users when search term changes (debounced)
    useEffect(() => {
        if (user?.role === UserRole.SUPERADMIN && debouncedSearchTerm !== searchTerm) {
            loadUsers(true);
        }
    }, [debouncedSearchTerm]);

    const loadUsers = useCallback(async (isSearch = false) => {
        try {
            if (isSearch) {
                setSearchLoading(true);
            } else {
                setLoading(true);
            }
            
            const params: any = {
                page: currentPage,
                limit: ITEMS_PER_PAGE
            };
            
            if (selectedRole !== 'all') {
                params.role = selectedRole;
            }
            
            if (showArchived === 'active') {
                params.isArchived = false;
            } else if (showArchived === 'archived') {
                params.isArchived = true;
            }
            
            if (debouncedSearchTerm) {
                params.search = debouncedSearchTerm;
            }
            
            const response = await userAPI.getUsersWithDetails(params);
            
            setUsers(response.users as UserWithDetails[]);
            setTotalPages(response.pagination.totalPages);
            setTotalCount(response.pagination.totalCount);
            setHasNextPage(response.pagination.hasNextPage);
            setHasPrevPage(response.pagination.hasPrevPage);
            
        } catch (error) {
            console.error('Error loading users:', error);
            toast.error('Failed to load users data');
        } finally {
            if (isSearch) {
                setSearchLoading(false);
            } else {
                setLoading(false);
            }
        }
    }, [currentPage, selectedRole, showArchived, debouncedSearchTerm]);

    const handleSearch = useCallback(() => {
        if (user?.role === UserRole.SUPERADMIN) {
            loadUsers(true);
        }
    }, [loadUsers, user]);

    const handleClearSearch = useCallback(() => {
        setSearchTerm('');
        if (user?.role === UserRole.SUPERADMIN) {
            // This will trigger the debounced search effect to clear results
            setTimeout(() => loadUsers(true), 100);
        }
    }, [loadUsers, user]);

    const handleArchiveUser = useCallback(async (userId: string) => {
        try {
            setActionLoading(userId);
            await userAPI.archiveStudent(userId);
            
            // Update the user in our state
            setUsers(prev => prev.map(u => 
                u.id === userId 
                    ? { ...u, isArchived: true }
                    : u
            ));
            
            toast.success('User archived successfully');
        } catch (error: any) {
            console.error('Error archiving user:', error);
            toast.error(error.message || 'Failed to archive user');
        } finally {
            setActionLoading(null);
        }
    }, []);

    const handleUnarchiveUser = useCallback(async (userId: string) => {
        try {
            setActionLoading(userId);
            await userAPI.unarchiveStudent(userId);
            
            // Update the user in our state
            setUsers(prev => prev.map(u => 
                u.id === userId 
                    ? { ...u, isArchived: false }
                    : u
            ));
            
            toast.success('User unarchived successfully');
        } catch (error: any) {
            console.error('Error unarchiving user:', error);
            toast.error(error.message || 'Failed to unarchive user');
        } finally {
            setActionLoading(null);
        }
    }, []);

    const handleEditUser = useCallback((user: UserWithDetails) => {
        setSelectedUser(user);
        setShowEditModal(true);
    }, []);

    const handleEditSuccess = useCallback(() => {
        loadUsers(false); // Refresh the data
    }, [loadUsers]);

    const handleRefresh = useCallback(() => {
        loadUsers(false);
    }, [loadUsers]);

    const getRoleIcon = (role: UserRole) => {
        switch (role) {
            case UserRole.STUDENT:
                return <GraduationCap className="h-4 w-4" />;
            case UserRole.TEACHER:
                return <BookOpen className="h-4 w-4" />;
            case UserRole.ADMIN:
                return <Shield className="h-4 w-4" />;
            case UserRole.SUPERADMIN:
                return <Crown className="h-4 w-4" />;
            default:
                return <Users className="h-4 w-4" />;
        }
    };

    const getRoleBadgeColor = (role: UserRole) => {
        switch (role) {
            case UserRole.STUDENT:
                return 'bg-blue-100 text-blue-800';
            case UserRole.TEACHER:
                return 'bg-green-100 text-green-800';
            case UserRole.ADMIN:
                return 'bg-yellow-100 text-yellow-800';
            case UserRole.SUPERADMIN:
                return 'bg-purple-100 text-purple-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    };

    const getUserAssignments = (user: UserWithDetails) => {
        const assignments: string[] = [];
        
        if (user.studentClasses && user.studentClasses.length > 0) {
            user.studentClasses.forEach(sc => {
                assignments.push(`${sc.class.name} (${sc.class.school.name})`);
            });
        }
        
        if (user.teacherClasses && user.teacherClasses.length > 0) {
            user.teacherClasses.forEach(tc => {
                assignments.push(`${tc.class.name} (${tc.class.school.name})`);
            });
        }
        
        if (user.adminSchools && user.adminSchools.length > 0) {
            user.adminSchools.forEach(as => {
                assignments.push(as.school.name);
            });
        }
        
        return assignments.length > 0 ? assignments.join(', ') : 'No assignments';
    };

    if (isLoading || (loading && users.length === 0)) {
    return <UsersPageSkeleton />;
    }

    if (!user || user.role !== UserRole.SUPERADMIN) {
        return null;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                <h1 className="text-2xl font-bold">User Management</h1>
                <div className="flex flex-col sm:flex-row gap-2">
                    <Button 
                        asChild
                        size="sm"
                        className="flex items-center gap-2 w-full sm:w-auto"
                    >
                        <Link href="/dashboard/superadmin/create-user">
                            <UserPlus className="h-4 w-4" />
                            Add User
                        </Link>
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
                        Filters
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                        {/* Search Section - Left side, takes more space */}
                        <div className="lg:col-span-6">
                            <label className="block text-sm font-medium mb-2">Search</label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    {searchTerm && (
                                        <button
                                            onClick={handleClearSearch}
                                            className="absolute right-8 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 hover:text-gray-600"
                                            title="Clear search"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    )}
                                    {searchLoading && (
                                        <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
                                    )}
                                    <Input
                                        placeholder="Search by name, username, or token number..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                handleSearch();
                                            }
                                        }}
                                        className={`pl-10 ${searchTerm ? 'pr-16' : searchLoading ? 'pr-10' : ''}`}
                                    />
                                </div>
                                <Button
                                    onClick={handleSearch}
                                    disabled={searchLoading}
                                    variant="outline"
                                    size="default"
                                    className="flex items-center gap-2"
                                >
                                    {searchLoading ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Search className="h-4 w-4" />
                                    )}
                                    Search
                                </Button>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">Search across names, usernames, and token numbers • Press Enter or click Search</p>
                        </div>
                        
                        {/* Role Filter - Right side */}
                        <div className="lg:col-span-3">
                            <label className="block text-sm font-medium mb-2">Role</label>
                            <Select value={selectedRole} onValueChange={setSelectedRole}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select role" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Roles</SelectItem>
                                    <SelectItem value={UserRole.STUDENT}>Students</SelectItem>
                                    <SelectItem value={UserRole.TEACHER}>Teachers</SelectItem>
                                    <SelectItem value={UserRole.SUPERADMIN}>Admins</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        
                        {/* Status Filter - Right side */}
                        <div className="lg:col-span-3">
                            <label className="block text-sm font-medium mb-2">Status</label>
                            <Select value={showArchived} onValueChange={setShowArchived}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">Active Only</SelectItem>
                                    <SelectItem value="archived">Archived Only</SelectItem>
                                    <SelectItem value="all">All Users</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Users List */}
            <Card>
                <CardHeader>
                    <CardTitle>Users ({totalCount})</CardTitle>
                    <CardDescription>
                        Showing {users.length} of {totalCount} users (Page {currentPage} of {totalPages})
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {users.length === 0 ? (
                        <div className="text-center py-8">
                            <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                            <p className="text-gray-500">No users found</p>
                        </div>
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="py-3 px-4 text-left">User</th>
                                            <th className="py-3 px-4 text-left">Role</th>
                                            <th className="py-3 px-4 text-left">Token</th>
                                            <th className="py-3 px-4 text-left">School</th>
                                            <th className="py-3 px-4 text-left">Status</th>
                                            <th className="py-3 px-4 text-left">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.map((u) => (
                                            <tr key={u.id} className="border-b hover:bg-gray-50">
                                                <td className="py-3 px-4">
                                                    <div>
                                                        <div className="font-medium">{u.name}</div>
                                                        <div className="text-sm text-gray-500">@{u.username}</div>
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <Badge className={`flex items-center gap-1 w-fit ${getRoleBadgeColor(u.role)}`}>
                                                        {getRoleIcon(u.role)}
                                                        {u.role}
                                                    </Badge>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <span className="text-sm font-mono">
                                                        {u.tokenNumber || '-'}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 max-w-xs">
                                                    <div className="text-sm text-gray-600 truncate" title={getUserAssignments(u)}>
                                                        {getUserAssignments(u)}
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <Badge variant={u.isArchived ? "secondary" : "default"}>
                                                        {u.isArchived ? 'Archived' : 'Active'}
                                                    </Badge>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="flex items-center gap-2">
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleEditUser(u)}
                                                            className="flex items-center gap-1"
                                                        >
                                                            <Edit className="h-3 w-3" />
                                                            Edit
                                                        </Button>
                                                        
                                                        {u.isArchived ? (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => handleUnarchiveUser(u.id)}
                                                                disabled={actionLoading === u.id}
                                                                className="flex items-center gap-1"
                                                            >
                                                                <ArchiveRestore className="h-3 w-3" />
                                                                {actionLoading === u.id ? 'Unarchiving...' : 'Unarchive'}
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => handleArchiveUser(u.id)}
                                                                disabled={actionLoading === u.id}
                                                                className="flex items-center gap-1"
                                                            >
                                                                <Archive className="h-3 w-3" />
                                                                {actionLoading === u.id ? 'Archiving...' : 'Archive'}
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
                                isLoading={loading || searchLoading}
                            />
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Edit User Modal */}
            <EditUserModal
                user={selectedUser}
                isOpen={showEditModal}
                onClose={() => setShowEditModal(false)}
                onSuccess={handleEditSuccess}
            />
        </div>
    );
}
