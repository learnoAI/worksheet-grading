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
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { 
    Archive, 
    ArchiveRestore, 
    Plus, 
    Search, 
    UserPlus, 
    Users,
    Trash2
} from 'lucide-react';
import { CreateUserForm } from './CreateUserForm';

interface StudentManagementModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    className: string;
    schoolId: string;
    onStudentsUpdated: () => void;
}

export function StudentManagementModal({ 
    isOpen, 
    onClose, 
    classId, 
    className, 
    schoolId,
    onStudentsUpdated 
}: StudentManagementModalProps) {
    const [currentStudents, setCurrentStudents] = useState<User[]>([]);
    const [availableStudents, setAvailableStudents] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [activeTab, setActiveTab] = useState<'current' | 'available'>('current');

    useEffect(() => {
        if (isOpen) {
            loadStudents();
        }
    }, [isOpen, classId]);

    const loadStudents = async () => {
        setLoading(true);
        try {            const [current, available] = await Promise.all([
                classAPI.getStudents(classId),
                classAPI.getAvailableStudents(classId)
            ]);
            setCurrentStudents(current);
            setAvailableStudents(available);
        } catch (error: any) {
            console.error('Error loading students:', error);
            toast.error(error.message || 'Failed to load students');
        } finally {
            setLoading(false);
        }
    };

    const handleAddStudent = async (studentId: string) => {
        setActionLoading(studentId);
        try {
            await classAPI.addStudent(classId, studentId);
            toast.success('Student added to class successfully');
            loadStudents();
            onStudentsUpdated();
        } catch (error: any) {
            console.error('Error adding student:', error);
            toast.error(error.message || 'Failed to add student to class');
        } finally {
            setActionLoading(null);
        }
    };

    const handleRemoveStudent = async (studentId: string) => {
        setActionLoading(studentId);
        try {
            await classAPI.removeStudent(classId, studentId);
            toast.success('Student removed from class successfully');
            loadStudents();
            onStudentsUpdated();
        } catch (error: any) {
            console.error('Error removing student:', error);
            toast.error(error.message || 'Failed to remove student from class');
        } finally {
            setActionLoading(null);
        }
    };    const handleArchiveStudent = async (studentId: string) => {
        setActionLoading(studentId);
        try {
            await userAPI.archiveStudent(studentId);
            toast.success('Student archived successfully');
            loadStudents();
            onStudentsUpdated();
        } catch (error: any) {
            console.error('Error archiving student:', error);
            toast.error(error.message || 'Failed to archive student');
        } finally {
            setActionLoading(null);
        }
    };    const handleUnarchiveStudent = async (studentId: string) => {
        setActionLoading(studentId);
        try {
            await userAPI.unarchiveStudent(studentId);
            toast.success('Student unarchived successfully');
            loadStudents();
            onStudentsUpdated();
        } catch (error: any) {
            console.error('Error unarchiving student:', error);
            toast.error(error.message || 'Failed to unarchive student');
        } finally {
            setActionLoading(null);
        }
    };

    const handleCreateUserSuccess = () => {
        setShowCreateForm(false);
        loadStudents();
        onStudentsUpdated();
    };

    const filteredCurrentStudents = currentStudents.filter(student =>
        student.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.tokenNumber?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const filteredAvailableStudents = availableStudents.filter(student =>
        student.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.tokenNumber?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[80vh]">
                {showCreateForm ? (
                    <div className="space-y-4">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <UserPlus className="h-5 w-5" />
                                Add New Student to {className}
                            </DialogTitle>
                            <DialogDescription>
                                Create a new student and add them to this class
                            </DialogDescription>
                        </DialogHeader>
                        <CreateUserForm
                            onClose={() => setShowCreateForm(false)}
                            onSuccess={handleCreateUserSuccess}
                            allowedRoles={[UserRole.STUDENT]}
                            defaultSchool={schoolId}
                            defaultClass={classId}
                        />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5" />
                                Manage Students - {className}
                            </DialogTitle>
                            <DialogDescription>
                                Add new students, remove existing ones, or archive/unarchive students from this class
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
                                    Current Students ({currentStudents.length})
                                </Button>
                                <Button
                                    variant={activeTab === 'available' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setActiveTab('available')}
                                >
                                    Available Students ({availableStudents.length})
                                </Button>
                            </div>
                            <Button
                                onClick={() => setShowCreateForm(true)}
                                size="sm"
                                className="flex items-center gap-2"
                            >
                                <UserPlus className="h-4 w-4" />
                                Add New Student
                            </Button>
                        </div>

                        {/* Search */}
                        <div className="flex items-center space-x-2">
                            <Search className="h-4 w-4 text-gray-400" />
                            <Input
                                placeholder="Search students by name or token number..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="flex-1"
                            />
                        </div>

                        {/* Content */}
                        <div className="border rounded-lg">
                            {loading ? (
                                <div className="p-6 text-center">Loading students...</div>
                            ) : activeTab === 'current' ? (
                                <div className="space-y-2 max-h-96 overflow-y-auto">
                                    <div className="bg-gray-50 p-3 font-medium border-b">
                                        Current Students in Class
                                    </div>
                                    {filteredCurrentStudents.length === 0 ? (
                                        <div className="p-6 text-center text-gray-500">
                                            {searchTerm ? 'No students found matching search' : 'No students in this class'}
                                        </div>
                                    ) : (
                                        filteredCurrentStudents.map(student => (
                                            <div key={student.id} className="flex items-center justify-between p-3 hover:bg-gray-50">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{student.name}</span>
                                                        <Badge variant="outline">TN: {student.tokenNumber}</Badge>
                                                        {student.isArchived && (
                                                            <Badge variant="destructive">Archived</Badge>
                                                        )}
                                                    </div>
                                                    <div className="text-sm text-gray-500">{student.username}</div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {student.isArchived ? (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleUnarchiveStudent(student.id)}
                                                            disabled={actionLoading === student.id}
                                                            className="flex items-center gap-1"
                                                        >
                                                            <ArchiveRestore className="h-3 w-3" />
                                                            Unarchive
                                                        </Button>
                                                    ) : (
                                                        <>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => handleArchiveStudent(student.id)}
                                                                disabled={actionLoading === student.id}
                                                                className="flex items-center gap-1"
                                                            >
                                                                <Archive className="h-3 w-3" />
                                                                Archive
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="destructive"
                                                                onClick={() => handleRemoveStudent(student.id)}
                                                                disabled={actionLoading === student.id}
                                                                className="flex items-center gap-1"
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                                Remove
                                                            </Button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-96 overflow-y-auto">
                                    <div className="bg-gray-50 p-3 font-medium border-b">
                                        Available Students (same school, not in this class)
                                    </div>
                                    {filteredAvailableStudents.length === 0 ? (
                                        <div className="p-6 text-center text-gray-500">
                                            {searchTerm ? 'No students found matching search' : 'No available students'}
                                        </div>
                                    ) : (
                                        filteredAvailableStudents.map(student => (
                                            <div key={student.id} className="flex items-center justify-between p-3 hover:bg-gray-50">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{student.name}</span>
                                                        <Badge variant="outline">TN: {student.tokenNumber}</Badge>
                                                    </div>
                                                    <div className="text-sm text-gray-500">{student.username}</div>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleAddStudent(student.id)}
                                                    disabled={actionLoading === student.id}
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
