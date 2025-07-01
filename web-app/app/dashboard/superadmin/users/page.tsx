'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { userAPI } from '@/lib/api/user';
import { User, UserRole } from '@/lib/api/types';
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

// Enhanced User interface with relationships - using the actual API response structure
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

// Pagination constants
const ITEMS_PER_PAGE = 30;

// Optimized loading components
const PageLoader = memo(() => (
    <div className="flex justify-center items-center h-96">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading users...</span>
    </div>
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

    useEffect(() => {
        if (user) {
            setName(user.name || '');
            setUsername(user.username || '');
            setRole(user.role || '');
            setTokenNumber(user.tokenNumber || '');
        }
    }, [user]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        if (!name || !username) {
            toast.error('Name and username are required');
            return;
        }

        try {
            setSubmitting(true);
            
            const updateData: any = {
                name,
                username,
                role
            };

            if (role === UserRole.STUDENT && tokenNumber) {
                updateData.tokenNumber = tokenNumber;
            }

            await userAPI.updateUser(user.id, updateData);
            toast.success('User updated successfully');
            onSuccess();
            onClose();
        } catch (error: any) {
            console.error('Error updating user:', error);
            toast.error(error.message || 'Failed to update user');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit User</DialogTitle>
                    <DialogDescription>
                        Update user information and settings
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <Label htmlFor="name">Full Name</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter full name"
                            required
                        />
                    </div>
                    
                    <div>
                        <Label htmlFor="username">Username</Label>
                        <Input
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter username"
                            required
                        />
                    </div>
                    
                    <div>
                        <Label htmlFor="role">Role</Label>
                        <Select value={role} onValueChange={setRole}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={UserRole.STUDENT}>Student</SelectItem>
                                <SelectItem value={UserRole.TEACHER}>Teacher</SelectItem>
                                <SelectItem value={UserRole.ADMIN}>Admin</SelectItem>
                                <SelectItem value={UserRole.SUPERADMIN}>Superadmin</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    
                    {role === UserRole.STUDENT && (
                        <div>
                            <Label htmlFor="tokenNumber">Token Number</Label>
                            <Input
                                id="tokenNumber"
                                value={tokenNumber}
                                onChange={(e) => setTokenNumber(e.target.value)}
                                placeholder="Enter token number"
                            />
                        </div>
                    )}
                    
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={submitting}>
                            {submitting ? 'Updating...' : 'Update User'}
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
        return <PageLoader />;
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
                                                    <Badge variant={u.isArchived ? "destructive" : "default"}>
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
