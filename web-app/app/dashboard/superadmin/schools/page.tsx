'use client';

import { useState, useEffect } from 'react';
import { schoolAPI } from '@/lib/api';
import { School } from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AddSchoolModal } from '@/components/AddSchoolModal';
import { EditSchoolModal } from '@/components/EditSchoolModal';
import { ArchiveSchoolModal } from '@/components/ArchiveSchoolModal';
import { CreateClassModal } from '@/components/CreateClassModal';
import { toast } from 'sonner';
import { Search, Plus, Building2, Archive, ArchiveRestore, GraduationCap} from 'lucide-react';

export default function SchoolsPage() {
    const [schools, setSchools] = useState<School[]>([]);
    const [filteredSchools, setFilteredSchools] = useState<School[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
    const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
    const [archiveAction, setArchiveAction] = useState<'archive' | 'unarchive'>('archive');
    const [includeArchived, setIncludeArchived] = useState(false);
    const [isCreateClassModalOpen, setIsCreateClassModalOpen] = useState(false);
    const [selectedSchoolForClass, setSelectedSchoolForClass] = useState<School | null>(null);

    useEffect(() => {
        loadSchools();
    }, []);

    useEffect(() => {
        loadSchools();
    }, [includeArchived]);

    useEffect(() => {
        // Filter schools based on search term
        if (searchTerm.trim() === '') {
            setFilteredSchools(schools);
        } else {
            const filtered = schools.filter(school =>
                school.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                school.id.toLowerCase().includes(searchTerm.toLowerCase())
            );
            setFilteredSchools(filtered);
        }
    }, [searchTerm, schools]);

    const loadSchools = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const schoolsData = await schoolAPI.getAllSchools(includeArchived);
            setSchools(schoolsData);
            setFilteredSchools(schoolsData);
            if (schoolsData.length === 0) {
                toast.info('No schools found in the system');
            }
        } catch (error: any) {
            console.error('Error loading schools:', error);
            const errorMessage = error.message || 'Failed to load schools';
            setError(errorMessage);
            toast.error(errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
                    <p className="mt-2 text-sm text-gray-600">Loading schools...</p>
                </div>
            </div>
        );
    }

    if (error && schools.length === 0) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center">
                    <Building2 className="mx-auto h-12 w-12 text-red-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">Error loading schools</h3>
                    <p className="mt-1 text-sm text-gray-500">{error}</p>
                    <Button className="mt-4" onClick={loadSchools}>
                        Try Again
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                    <Building2 className="h-6 w-6" />
                    <h1 className="text-2xl font-bold">
                        {includeArchived ? 'Archived Schools' : 'Active Schools'}
                    </h1>
                </div>
                <div className="flex items-center space-x-2">
                    {!includeArchived && (
                        <Button onClick={() => setIsAddModalOpen(true)}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add School
                        </Button>
                    )}
                    <div className="flex items-center bg-gray-200 rounded-lg p-1">
                        
                        <Button
                            variant={!includeArchived ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setIncludeArchived(false)}
                            className="rounded-md"
                        >
                            <Building2 className="h-4 w-4 mr-2" />
                            Active
                        </Button>
                        <Button
                            variant={includeArchived ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setIncludeArchived(true)}
                            className="rounded-md"
                        >
                            <Archive className="h-4 w-4 mr-2" />
                            Archived
                        </Button>
                    </div>
                    
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            {includeArchived ? 'Archived Schools' : 'Active Schools'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {includeArchived 
                                ? schools.filter(s => s.isArchived).length 
                                : schools.filter(s => !s.isArchived).length
                            }
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {includeArchived ? 'Hidden from main list' : 'Currently operational'}
                        </p>
                    </CardContent>
                </Card>
                
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Classes</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {schools.reduce((total, school) => total + ((school as any)._count?.classes || 0), 0)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Across all {includeArchived ? 'archived' : 'active'} schools
                        </p>
                    </CardContent>
                </Card>
                
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Students</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {schools.reduce((total, school) => total + ((school as any)._count?.studentSchools || 0), 0)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            In {includeArchived ? 'archived' : 'active'} schools
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Search {includeArchived ? 'Archived' : 'Active'} Schools</CardTitle>
                    <CardDescription>
                        Find {includeArchived ? 'archived' : 'active'} schools by name or ID
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center space-x-2">
                        <Search className="h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by school name or ID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="max-w-sm"
                        />
                        {searchTerm && (
                            <Button
                                variant="default"
                                size="sm"
                                onClick={() => setSearchTerm('')}
                            >
                                Clear
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Schools Table */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        {includeArchived ? 'Archived Schools' : 'Active Schools'} List
                    </CardTitle>
                    <CardDescription>
                        {filteredSchools.length} school{filteredSchools.length !== 1 ? 's' : ''} found
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {filteredSchools.length === 0 ? (
                        <div className="text-center py-8">
                            {includeArchived ? (
                                <Archive className="mx-auto h-12 w-12 text-orange-400" />
                            ) : (
                                <Building2 className="mx-auto h-12 w-12 text-gray-400" />
                            )}
                            <h3 className="mt-2 text-sm font-medium text-gray-900">
                                No {includeArchived ? 'archived' : 'active'} schools found
                            </h3>
                            <p className="mt-1 text-sm text-gray-500">
                                {searchTerm 
                                    ? 'Try adjusting your search criteria.' 
                                    : includeArchived 
                                        ? 'No schools have been archived yet.'
                                        : 'Get started by adding a new school.'
                                }
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>School Name</TableHead>
                                        <TableHead>School ID</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredSchools.map((school) => (
                                        <TableRow key={school.id}>
                                            <TableCell className="font-medium">
                                                <div className="flex items-center space-x-2">
                                                    <Building2 className="h-4 w-4 text-muted-foreground" />
                                                    <span>{school.name}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm">
                                                    {school.id}
                                                </code>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end space-x-2">
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm"
                                                        onClick={() => {
                                                            setSelectedSchoolForClass(school);
                                                            setIsCreateClassModalOpen(true);
                                                        }}
                                                        title="Create Class for this school"
                                                    >
                                                        <GraduationCap className="h-4 w-4 mr-1" />
                                                        Add Class
                                                    </Button>
                                                    
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm"
                                                        onClick={() => {
                                                            setSelectedSchool(school);
                                                            setIsEditModalOpen(true);
                                                        }}
                                                    >
                                                        Edit
                                                    </Button>
                                                    
                                                    {includeArchived ? (
                                                        <Button
                                                            variant="default"
                                                            size="sm"
                                                            onClick={() => {
                                                                setSelectedSchool(school);
                                                                setArchiveAction('unarchive');
                                                                setIsArchiveModalOpen(true);
                                                            }}
                                                        >
                                                            <ArchiveRestore className="h-4 w-4 mr-1" />
                                                            Unarchive
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => {
                                                                setSelectedSchool(school);
                                                                setArchiveAction('archive');
                                                                setIsArchiveModalOpen(true);
                                                            }}
                                                        >
                                                            <Archive className="h-4 w-4 mr-1" />
                                                            Archive
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Add School Modal */}
            <AddSchoolModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSuccess={loadSchools}
            />

            {/* Edit School Modal */}
            <EditSchoolModal
                isOpen={isEditModalOpen}
                onClose={() => {
                    setIsEditModalOpen(false);
                    setSelectedSchool(null);
                }}
                onSuccess={loadSchools}
                school={selectedSchool}
            />

            {/* Archive School Modal */}
            <ArchiveSchoolModal
                isOpen={isArchiveModalOpen}
                onClose={() => {
                    setIsArchiveModalOpen(false);
                    setSelectedSchool(null);
                }}
                onSuccess={loadSchools}
                school={selectedSchool}
                action={archiveAction}
            />

            {/* Create Class Modal */}
            <CreateClassModal
                isOpen={isCreateClassModalOpen}
                onClose={() => {
                    setIsCreateClassModalOpen(false);
                    setSelectedSchoolForClass(null);
                }}
                onSuccess={() => {
                    setIsCreateClassModalOpen(false);
                    setSelectedSchoolForClass(null);
                    toast.success('Class created successfully! You can view it in the Classes page.');
                }}
                defaultSchoolId={selectedSchoolForClass?.id}
            />
        </div>
    );
}
