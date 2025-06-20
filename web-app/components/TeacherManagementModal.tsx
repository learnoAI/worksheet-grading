'use client';

import { useState, useEffect } from 'react';
import { classAPI } from '@/lib/api/class';
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
    Plus, 
    Search, 
    UserPlus, 
    Users,
    Trash2
} from 'lucide-react';
import { CreateUserForm } from './CreateUserForm';

interface TeacherManagementModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    className: string;
    schoolId: string;
    onTeachersUpdated: () => void;
}

export function TeacherManagementModal({ 
    isOpen, 
    onClose, 
    classId, 
    className, 
    schoolId,
    onTeachersUpdated 
}: TeacherManagementModalProps) {
    const [currentTeachers, setCurrentTeachers] = useState<User[]>([]);
    const [availableTeachers, setAvailableTeachers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [activeTab, setActiveTab] = useState<'current' | 'available'>('current');

    useEffect(() => {
        if (isOpen) {
            loadTeachers();
        }
    }, [isOpen, classId]);    const loadTeachers = async () => {
        setLoading(true);
        try {
            const [current, available] = await Promise.all([
                classAPI.getClassTeachers(classId),
                classAPI.getAvailableTeachers(classId)
            ]);
            setCurrentTeachers(current);
            setAvailableTeachers(available);
        } catch (error: any) {
            console.error('Error loading teachers:', error);
            toast.error(error.message || 'Failed to load teachers');
        } finally {
            setLoading(false);
        }
    };

    const handleAddTeacher = async (teacherId: string) => {
        setActionLoading(teacherId);
        try {
            await classAPI.addTeacherToClass(classId, teacherId);
            toast.success('Teacher added to class successfully');
            loadTeachers();
            onTeachersUpdated();
        } catch (error: any) {
            console.error('Error adding teacher:', error);
            toast.error(error.message || 'Failed to add teacher to class');
        } finally {
            setActionLoading(null);
        }
    };

    const handleRemoveTeacher = async (teacherId: string) => {
        setActionLoading(teacherId);
        try {
            await classAPI.removeTeacherFromClass(classId, teacherId);
            toast.success('Teacher removed from class successfully');
            loadTeachers();
            onTeachersUpdated();
        } catch (error: any) {
            console.error('Error removing teacher:', error);
            toast.error(error.message || 'Failed to remove teacher from class');
        } finally {
            setActionLoading(null);
        }
    };

    const handleCreateUserSuccess = () => {
        setShowCreateForm(false);
        loadTeachers();
        onTeachersUpdated();
    };

    const filteredCurrentTeachers = currentTeachers.filter(teacher =>
        teacher.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        teacher.username.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const filteredAvailableTeachers = availableTeachers.filter(teacher =>
        teacher.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        teacher.username.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[80vh]">
                {showCreateForm ? (
                    <div className="space-y-4">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <UserPlus className="h-5 w-5" />
                                Add New Teacher to {className}
                            </DialogTitle>
                            <DialogDescription>
                                Create a new teacher and add them to this class
                            </DialogDescription>
                        </DialogHeader>
                        <CreateUserForm
                            onClose={() => setShowCreateForm(false)}
                            onSuccess={handleCreateUserSuccess}
                            allowedRoles={[UserRole.TEACHER]}
                            defaultSchool={schoolId}
                            defaultClass={classId}
                        />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5" />
                                Manage Teachers - {className}
                            </DialogTitle>
                            <DialogDescription>
                                Add new teachers or remove existing ones from this class
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
                                    Current Teachers ({currentTeachers.length})
                                </Button>
                                <Button
                                    variant={activeTab === 'available' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setActiveTab('available')}
                                >
                                    Available Teachers ({availableTeachers.length})
                                </Button>
                            </div>
                            <Button
                                onClick={() => setShowCreateForm(true)}
                                size="sm"
                                className="flex items-center gap-2"
                            >
                                <UserPlus className="h-4 w-4" />
                                Add New Teacher
                            </Button>
                        </div>

                        {/* Search */}
                        <div className="flex items-center space-x-2">
                            <Search className="h-4 w-4 text-gray-400" />
                            <Input
                                placeholder="Search teachers by name or username..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="flex-1"
                            />
                        </div>

                        {/* Content */}
                        <div className="border rounded-lg">
                            {loading ? (
                                <div className="p-6 text-center">Loading teachers...</div>
                            ) : activeTab === 'current' ? (
                                <div className="space-y-2 max-h-96 overflow-y-auto">
                                    <div className="bg-gray-50 p-3 font-medium border-b">
                                        Current Teachers in Class
                                    </div>
                                    {filteredCurrentTeachers.length === 0 ? (
                                        <div className="p-6 text-center text-gray-500">
                                            {searchTerm ? 'No teachers found matching search' : 'No teachers in this class'}
                                        </div>
                                    ) : (
                                        filteredCurrentTeachers.map(teacher => (
                                            <div key={teacher.id} className="flex items-center justify-between p-3 hover:bg-gray-50">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{teacher.name}</span>
                                                        <Badge variant="outline">Teacher</Badge>
                                                    </div>
                                                    <div className="text-sm text-gray-500">{teacher.username}</div>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    onClick={() => handleRemoveTeacher(teacher.id)}
                                                    disabled={actionLoading === teacher.id}
                                                    className="flex items-center gap-1"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                    Remove
                                                </Button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-96 overflow-y-auto">
                                    <div className="bg-gray-50 p-3 font-medium border-b">
                                        Available Teachers (same school, not in this class)
                                    </div>
                                    {filteredAvailableTeachers.length === 0 ? (
                                        <div className="p-6 text-center text-gray-500">
                                            {searchTerm ? 'No teachers found matching search' : 'No available teachers'}
                                        </div>
                                    ) : (
                                        filteredAvailableTeachers.map(teacher => (
                                            <div key={teacher.id} className="flex items-center justify-between p-3 hover:bg-gray-50">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{teacher.name}</span>
                                                        <Badge variant="outline">Teacher</Badge>
                                                    </div>
                                                    <div className="text-sm text-gray-500">{teacher.username}</div>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleAddTeacher(teacher.id)}
                                                    disabled={actionLoading === teacher.id}
                                                    className="flex items-center gap-1"
                                                >
                                                    <Plus className="h-3 w-3" />
                                                    Add to Class
                                                </Button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
