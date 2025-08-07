'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { classAPI } from '@/lib/api/class';
import { analyticsAPI, School } from '@/lib/api/analytics';
import { Loader2 } from 'lucide-react';

interface CreateClassModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    defaultSchoolId?: string;
}

export function CreateClassModal({ isOpen, onClose, onSuccess, defaultSchoolId }: CreateClassModalProps) {
    const [formData, setFormData] = useState({
        name: '',
        schoolId: defaultSchoolId || ''
    });
    const [schools, setSchools] = useState<School[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingSchools, setIsLoadingSchools] = useState(true);

    useEffect(() => {
        if (isOpen) {
            loadSchools();
        }
    }, [isOpen]);

    useEffect(() => {
        if (defaultSchoolId) {
            setFormData(prev => ({ ...prev, schoolId: defaultSchoolId }));
        }
    }, [defaultSchoolId]);

    const loadSchools = async () => {
        try {
            setIsLoadingSchools(true);
            const schoolsData = await analyticsAPI.getAllSchools();
            setSchools(schoolsData);
        } catch (error) {
            console.error('Error loading schools:', error);
            toast.error('Failed to load schools');
        } finally {
            setIsLoadingSchools(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!formData.name.trim()) {
            toast.error('Class name is required');
            return;
        }

        if (!formData.schoolId) {
            toast.error('Please select a school');
            return;
        }

        try {
            setIsLoading(true);
            await classAPI.createClass({
                name: formData.name.trim(),
                schoolId: formData.schoolId
            });
            
            toast.success('Class created successfully');
            onSuccess();
            onClose();
            
            // Reset form
            setFormData({
                name: '',
                schoolId: defaultSchoolId || ''
            });
        } catch (error: any) {
            console.error('Error creating class:', error);
            toast.error(error?.message || 'Failed to create class');
        } finally {
            setIsLoading(false);
        }
    };

    const handleClose = () => {
        if (!isLoading) {
            onClose();
            // Reset form
            setFormData({
                name: '',
                schoolId: defaultSchoolId || ''
            });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Create New Class</DialogTitle>
                    <DialogDescription>
                        Add a new class to the selected school.
                    </DialogDescription>
                </DialogHeader>
                
                <form onSubmit={handleSubmit}>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="name" className="text-right">
                                Class Name
                            </Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Enter class name"
                                className="col-span-3"
                                disabled={isLoading}
                                required
                            />
                        </div>
                        
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="school" className="text-right">
                                School
                            </Label>
                            <div className="col-span-3">
                                {isLoadingSchools ? (
                                    <div className="flex items-center space-x-2">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        <span className="text-sm text-muted-foreground">Loading schools...</span>
                                    </div>
                                ) : (
                                    <Select
                                        value={formData.schoolId}
                                        onValueChange={(value) => setFormData(prev => ({ ...prev, schoolId: value }))}
                                        disabled={isLoading || !!defaultSchoolId}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a school" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {schools.map((school) => (
                                                <SelectItem key={school.id} value={school.id}>
                                                    {school.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                        </div>
                    </div>
                    
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleClose}
                            disabled={isLoading}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading || isLoadingSchools}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Create Class
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
