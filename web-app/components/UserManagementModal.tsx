'use client';

import { useState, useEffect } from 'react';
import { classAPI } from '@/lib/api/class';
import { userAPI } from '@/lib/api/user';
import { User, UserRole } from '@/lib/api/types';
import { 
    Dialog, 
    DialogContent, 
    DialogDescription, 
    DialogHeader, 
    DialogTitle 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { 
    Archive, 
    ArchiveRestore, 
    Plus, 
    Search, 
    UserPlus, 
    Users,
    Trash2,
    LucideIcon
} from 'lucide-react';
import { UserModal } from '@/src/components';

// Configuration types for different user management behaviors
export interface UserManagementConfig {
    userType: 'student' | 'teacher';
    userRole: UserRole;
    icon: LucideIcon;
    labels: {
        singular: string;
        plural: string;
        modalTitle: (className: string) => string;
        modalDescription: string;
        addNewButton: string;
        currentTab: string;
        availableTab: string;
        currentHeader: string;
        availableHeader: string;
        searchPlaceholder: string;
        addToClassButton: string;
        removeFromClassButton: string;
        noCurrentUsers: string;
        noAvailableUsers: string;
        loadingMessage: string;
    };
    api: {
        getCurrent: (classId: string) => Promise<User[]>;
        getAvailable: (classId: string) => Promise<User[]>;
        add: (classId: string, userId: string) => Promise<any>;
        remove: (classId: string, userId: string) => Promise<any>;
        archive?: (userId: string) => Promise<any>;
        unarchive?: (userId: string) => Promise<any>;
    };
    features: {
        hasArchiving: boolean;
        hasTokenNumber: boolean;
    };
    searchFields: (keyof User)[];
    badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
}

// Configurations for different user types
export const USER_MANAGEMENT_CONFIGS: Record<'student' | 'teacher', UserManagementConfig> = {
    student: {
        userType: 'student',
        userRole: UserRole.STUDENT,
        icon: Users,
        labels: {
            singular: 'Student',
            plural: 'Students',
            modalTitle: (className: string) => `Manage Students - ${className}`,
            modalDescription: 'Add new students, remove existing ones, or archive/unarchive students from this class',
            addNewButton: 'Add New Student',
            currentTab: 'Current Students',
            availableTab: 'Available',
            currentHeader: 'Current Students in Class',
            availableHeader: 'Available Students (same school, not in this class)',
            searchPlaceholder: 'Search students by name or token number...',
            addToClassButton: 'Add to Class',
            removeFromClassButton: 'Remove',
            noCurrentUsers: 'No students in this class',
            noAvailableUsers: 'No available students',
            loadingMessage: 'Loading students...',
        },
        api: {
            getCurrent: classAPI.getStudents,
            getAvailable: classAPI.getAvailableStudents,
            add: classAPI.addStudent,
            remove: classAPI.removeStudent,
            archive: userAPI.archiveStudent,
            unarchive: userAPI.unarchiveStudent,
        },
        features: {
            hasArchiving: true,
            hasTokenNumber: true,
        },
        searchFields: ['name', 'tokenNumber'],
        badgeVariant: 'outline',
    },
    teacher: {
        userType: 'teacher',
        userRole: UserRole.TEACHER,
        icon: Users,
        labels: {
            singular: 'Teacher',
            plural: 'Teachers',
            modalTitle: (className: string) => `Manage Teachers - ${className}`,
            modalDescription: 'Add new teachers or remove existing ones from this class',
            addNewButton: 'Add New Teacher',
            currentTab: 'Current Teachers',
            availableTab: 'Available Teachers',
            currentHeader: 'Current Teachers in Class',
            availableHeader: 'Available Teachers (same school, not in this class)',
            searchPlaceholder: 'Search teachers by name or username...',
            addToClassButton: 'Add to Class',
            removeFromClassButton: 'Remove',
            noCurrentUsers: 'No teachers in this class',
            noAvailableUsers: 'No available teachers',
            loadingMessage: 'Loading teachers...',
        },
        api: {
            getCurrent: classAPI.getClassTeachers,
            getAvailable: classAPI.getAvailableTeachers,
            add: classAPI.addTeacherToClass,
            remove: classAPI.removeTeacherFromClass,
        },
        features: {
            hasArchiving: false,
            hasTokenNumber: false,
        },
        searchFields: ['name', 'username'],
        badgeVariant: 'outline',
    },
};

// Props for the unified modal
interface UserManagementModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    className: string;
    schoolId: string;
    onUsersUpdated: () => void;
    config: UserManagementConfig;
}

// Reusable UserCard component
interface UserCardProps {
    user: User;
    config: UserManagementConfig;
    actionLoading: string | null;
    onAdd?: (userId: string) => void;
    onRemove?: (userId: string) => void;
    onArchive?: (userId: string) => void;
    onUnarchive?: (userId: string) => void;
    mode: 'current' | 'available';
}

function UserCard({ 
    user, 
    config, 
    actionLoading, 
    onAdd, 
    onRemove, 
    onArchive, 
    onUnarchive,
    mode 
}: UserCardProps) {
    const isLoading = actionLoading === user.id;

    return (
        <div className="flex items-center justify-between p-3 hover:bg-gray-50">
            <div className="flex-1">
                <div className="flex items-center gap-2">
                    <span className="font-medium">{user.name}</span>
                    {config.features.hasTokenNumber && user.tokenNumber && (
                        <Badge variant={config.badgeVariant}>TN: {user.tokenNumber}</Badge>
                    )}
                    {!config.features.hasTokenNumber && (
                        <Badge variant={config.badgeVariant}>{config.labels.singular}</Badge>
                    )}
                    {user.isArchived && (
                        <Badge variant="destructive">Archived</Badge>
                    )}
                </div>
                <div className="text-sm text-gray-500">{user.username}</div>
            </div>
            <div className="flex items-center gap-2">
                {mode === 'current' ? (
                    <>
                        {config.features.hasArchiving && user.isArchived ? (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onUnarchive?.(user.id)}
                                disabled={isLoading}
                                className="flex items-center gap-1"
                            >
                                <ArchiveRestore className="h-3 w-3" />
                                Unarchive
                            </Button>
                        ) : (
                            <>
                                {config.features.hasArchiving && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => onArchive?.(user.id)}
                                        disabled={isLoading}
                                        className="flex items-center gap-1"
                                    >
                                        <Archive className="h-3 w-3" />
                                        Archive
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => onRemove?.(user.id)}
                                    disabled={isLoading}
                                    className="flex items-center gap-1 hover:bg-amber-300"
                                >
                                    <Trash2 className="h-3 w-3" />
                                    {config.labels.removeFromClassButton}
                                </Button>
                            </>
                        )}
                    </>
                ) : (
                    <Button
                        size="sm"
                        onClick={() => onAdd?.(user.id)}
                        disabled={isLoading}
                        className="flex items-center gap-1"
                    >
                        <Plus className="h-3 w-3" />
                        {config.labels.addToClassButton}
                    </Button>
                )}
            </div>
        </div>
    );
}

// Reusable UserList component
interface UserListProps {
    users: User[];
    config: UserManagementConfig;
    actionLoading: string | null;
    searchTerm: string;
    mode: 'current' | 'available';
    onAdd?: (userId: string) => void;
    onRemove?: (userId: string) => void;
    onArchive?: (userId: string) => void;
    onUnarchive?: (userId: string) => void;
}

function UserList({ 
    users, 
    config, 
    actionLoading, 
    searchTerm, 
    mode, 
    onAdd, 
    onRemove, 
    onArchive, 
    onUnarchive 
}: UserListProps) {
    const filteredUsers = users.filter(user =>
        config.searchFields.some(field => {
            const value = user[field];
            return value && typeof value === 'string' && 
                   value.toLowerCase().includes(searchTerm.toLowerCase());
        })
    );

    const emptyMessage = searchTerm 
        ? `No ${config.labels.plural.toLowerCase()} found matching search`
        : mode === 'current' 
            ? config.labels.noCurrentUsers 
            : config.labels.noAvailableUsers;

    const headerText = mode === 'current' 
        ? config.labels.currentHeader 
        : config.labels.availableHeader;

    return (
        <div className="space-y-2 max-h-96 overflow-y-auto">
            <div className="bg-gray-50 p-3 font-medium border-b">
                {headerText}
            </div>
            {filteredUsers.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                    {emptyMessage}
                </div>
            ) : (
                filteredUsers.map(user => (
                    <UserCard
                        key={user.id}
                        user={user}
                        config={config}
                        actionLoading={actionLoading}
                        mode={mode}
                        onAdd={onAdd}
                        onRemove={onRemove}
                        onArchive={onArchive}
                        onUnarchive={onUnarchive}
                    />
                ))
            )}
        </div>
    );
}

// Main UserManagementModal component
export function UserManagementModal({ 
    isOpen, 
    onClose, 
    classId, 
    className, 
    schoolId,
    onUsersUpdated,
    config
}: UserManagementModalProps) {
    const [currentUsers, setCurrentUsers] = useState<User[]>([]);
    const [availableUsers, setAvailableUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [activeTab, setActiveTab] = useState<'current' | 'available'>('current');

    const IconComponent = config.icon;

    useEffect(() => {
        if (isOpen) {
            loadUsers();
        }
    }, [isOpen, classId, config]);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const [current, available] = await Promise.all([
                config.api.getCurrent(classId),
                config.api.getAvailable(classId)
            ]);
            setCurrentUsers(current);
            setAvailableUsers(available);
        } catch (error: unknown) {
            console.error(`Error loading ${config.labels.plural.toLowerCase()}:`, error);
            toast.error(error instanceof Error ? error.message : `Failed to load ${config.labels.plural.toLowerCase()}`);
        } finally {
            setLoading(false);
        }
    };

    const handleAddUser = async (userId: string) => {
        setActionLoading(userId);
        try {
            await config.api.add(classId, userId);
            toast.success(`${config.labels.singular} added to class successfully`);
            loadUsers();
            onUsersUpdated();
        } catch (error: unknown) {
            console.error(`Error adding ${config.labels.singular.toLowerCase()}:`, error);
            toast.error(error instanceof Error ? error.message : `Failed to add ${config.labels.singular.toLowerCase()} to class`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleRemoveUser = async (userId: string) => {
        setActionLoading(userId);
        try {
            await config.api.remove(classId, userId);
            toast.success(`${config.labels.singular} removed from class successfully`);
            loadUsers();
            onUsersUpdated();
        } catch (error: unknown) {
            console.error(`Error removing ${config.labels.singular.toLowerCase()}:`, error);
            toast.error(error instanceof Error ? error.message : `Failed to remove ${config.labels.singular.toLowerCase()} from class`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleArchiveUser = async (userId: string) => {
        if (!config.api.archive) return;
        
        setActionLoading(userId);
        try {
            await config.api.archive(userId);
            toast.success(`${config.labels.singular} archived successfully`);
            loadUsers();
            onUsersUpdated();
        } catch (error: unknown) {
            console.error(`Error archiving ${config.labels.singular.toLowerCase()}:`, error);
            toast.error(error instanceof Error ? error.message : `Failed to archive ${config.labels.singular.toLowerCase()}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleUnarchiveUser = async (userId: string) => {
        if (!config.api.unarchive) return;
        
        setActionLoading(userId);
        try {
            await config.api.unarchive(userId);
            toast.success(`${config.labels.singular} unarchived successfully`);
            loadUsers();
            onUsersUpdated();
        } catch (error: unknown) {
            console.error(`Error unarchiving ${config.labels.singular.toLowerCase()}:`, error);
            toast.error(error instanceof Error ? error.message : `Failed to unarchive ${config.labels.singular.toLowerCase()}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleCreateUserSuccess = () => {
        setShowCreateModal(false);
        loadUsers();
        onUsersUpdated();
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="max-w-4xl max-h-[80vh]">
                    <div className="space-y-4 overflow-hidden">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <IconComponent className="h-5 w-5" />
                                {config.labels.modalTitle(className)}
                            </DialogTitle>
                            <DialogDescription>
                                {config.labels.modalDescription}
                            </DialogDescription>
                        </DialogHeader>

                        {/* Action buttons */}
                        <div className="flex justify-between items-center">
                            <div className="flex space-x-2">
                                <Button
                                    variant={activeTab === 'current' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setActiveTab('current')}
                                >
                                    {config.labels.currentTab} ({currentUsers.length})
                                </Button>
                                <Button
                                    variant={activeTab === 'available' ? 'default' : 'secondary'}
                                    size="sm"
                                    onClick={() => setActiveTab('available')}
                                >
                                    {config.labels.availableTab} ({availableUsers.length})
                                </Button>
                            </div>
                            <Button
                                onClick={() => setShowCreateModal(true)}
                                size="sm"
                                className="flex items-center gap-2"
                            >
                                <UserPlus className="h-4 w-4" />
                                {config.labels.addNewButton}
                            </Button>
                        </div>

                        {/* Search */}
                        <div className="flex items-center space-x-2">
                            <Search className="h-4 w-4 text-gray-400" />
                            <Input
                                placeholder={config.labels.searchPlaceholder}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="flex-1"
                            />
                        </div>

                        {/* Content */}
                        <div className="border rounded-lg">
                            {loading ? (
                                <div className="p-6 text-center">{config.labels.loadingMessage}</div>
                            ) : activeTab === 'current' ? (
                                <UserList
                                    users={currentUsers}
                                    config={config}
                                    actionLoading={actionLoading}
                                    searchTerm={searchTerm}
                                    mode="current"
                                    onRemove={handleRemoveUser}
                                    onArchive={config.features.hasArchiving ? handleArchiveUser : undefined}
                                    onUnarchive={config.features.hasArchiving ? handleUnarchiveUser : undefined}
                                />
                            ) : (
                                <UserList
                                    users={availableUsers}
                                    config={config}
                                    actionLoading={actionLoading}
                                    searchTerm={searchTerm}
                                    mode="available"
                                    onAdd={handleAddUser}
                                />
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            
            <UserModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onSuccess={handleCreateUserSuccess}
                mode="create"
                allowedRoles={[config.userRole]}
                defaultSchool={schoolId}
                defaultClass={classId}
            />
        </>
    );
}

// Convenience components for specific user types
export function StudentManagementModal(props: Omit<UserManagementModalProps, 'config'>) {
    return <UserManagementModal {...props} config={USER_MANAGEMENT_CONFIGS.student} />;
}

export function TeacherManagementModal(props: Omit<UserManagementModalProps, 'config'>) {
    return <UserManagementModal {...props} config={USER_MANAGEMENT_CONFIGS.teacher} />;
}