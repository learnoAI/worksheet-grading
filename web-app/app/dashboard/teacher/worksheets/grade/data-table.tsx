'use client';

import * as React from "react";
import {
    ColumnDef,
    ColumnFiltersState,
    SortingState,
    useReactTable,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
} from "@tanstack/react-table";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { 
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { 
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { StudentCard } from "./student-card";

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    onDataChange?: (updatedData: TData[]) => void;
    onSaveStudent?: (student: TData) => void;
}

export function DataTable<TData, TValue>({
    columns,
    data,
    onDataChange,
    onSaveStudent,
}: DataTableProps<TData, TValue>) {
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [bulkWorksheetNumber, setBulkWorksheetNumber] = React.useState<string>('');
    const [bulkGrade, setBulkGrade] = React.useState<string>('');
    const [searchTerm, setSearchTerm] = React.useState<string>('');
    const [dropdownOpen, setDropdownOpen] = React.useState(false);
    const [selectedStudentIds, setSelectedStudentIds] = React.useState<string[]>([]);

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        onSortingChange: setSorting,
        getSortedRowModel: getSortedRowModel(),
        onColumnFiltersChange: setColumnFilters,
        getFilteredRowModel: getFilteredRowModel(),
        state: {
            sorting,
            columnFilters,
        },
        meta: {
            updateData: (rowIndex: number, columnId: string, value: any) => {
                // Make a deep copy of the data
                const newData = JSON.parse(JSON.stringify(data));
                
                // Get the current row data
                const currentRow = (newData as any)[rowIndex];
                
                console.log(`[Table] Updating row ${rowIndex}, field: ${columnId}, value:`, value, 
                    `Current state: isAbsent=${currentRow.isAbsent}, worksheetNumber=${currentRow.worksheetNumber}, grade=${currentRow.grade}`);
                
                // Handle specific field updates with their side effects
                if (columnId === 'isAbsent') {
                    const newAbsentState = !!value;
                    
                    // When marking a student as absent, clear other fields
                    if (newAbsentState) {
                        console.log(`[Table] Row ${rowIndex} marked as absent, clearing other fields`);
                        (newData as any)[rowIndex] = {
                            ...currentRow,
                            isAbsent: true,
                            worksheetNumber: 0,
                            grade: "",
                            isRepeated: false
                        };
                    } else {
                        // When unmarking as absent, only update the isAbsent status
                        // The StudentCard component will handle setting proper values
                        console.log(`[Table] Row ${rowIndex} marked as not absent`);
                        (newData as any)[rowIndex] = {
                            ...currentRow,
                            isAbsent: false
                        };
                    }
                } else if (columnId === 'worksheetNumber') {
                    // If setting valid worksheet number, ensure not absent
                    const worksheetNumber = value;
                    const shouldBeAbsent = worksheetNumber <= 0 && !currentRow.grade;
                    
                    console.log(`[Table] Setting worksheet number for row ${rowIndex} to ${worksheetNumber}, shouldBeAbsent=${shouldBeAbsent}`);
                    
                    (newData as any)[rowIndex] = {
                        ...currentRow,
                        worksheetNumber: worksheetNumber,
                        isAbsent: shouldBeAbsent // Only mark as absent if both worksheet and grade are empty
                    };
                } else if (columnId === 'grade') {
                    // If setting grade, ensure not absent
                    const grade = value;
                    const shouldBeAbsent = !grade && (!currentRow.worksheetNumber || currentRow.worksheetNumber <= 0);
                    
                    console.log(`[Table] Setting grade for row ${rowIndex} to "${grade}", shouldBeAbsent=${shouldBeAbsent}`);
                    
                    (newData as any)[rowIndex] = {
                        ...currentRow,
                        grade: grade,
                        isAbsent: shouldBeAbsent // Only mark as absent if both worksheet and grade are empty
                    };
                } else {
                    // For regular field updates
                    (newData as any)[rowIndex] = {
                        ...currentRow,
                        [columnId]: value,
                    };
                }
                
                // Log the final state after update
                console.log(`[Table] Row ${rowIndex} final state:`, (newData as any)[rowIndex]);
                
                // Notify the parent component of the data change
                onDataChange?.(newData);
            },
        },
    });

    // Helper function to update data by student ID
    const updateStudentData = (studentId: string, field: string, value: any) => {
        // Instead of trying to find the student in possibly filtered data,
        // we'll make a direct update to the full data array
        const updatedData = [...data].map((student: any) => {
            // Only update the student with matching ID
            if (student.studentId === studentId) {
                console.log(`[DataTable] Directly updating student ${studentId}, field: ${field}, value:`, value);
                
                // Create a copy of the student object to modify
                const updatedStudent = { ...student };
                
                // Special handling for absent status
                if (field === 'isAbsent') {
                    updatedStudent.isAbsent = !!value;
                    
                    // When marking as absent, clear other fields
                    if (updatedStudent.isAbsent) {
                        updatedStudent.worksheetNumber = 0;
                        updatedStudent.grade = "";
                        updatedStudent.isRepeated = false;
                    }
                } 
                // Special handling for worksheet number
                else if (field === 'worksheetNumber') {
                    updatedStudent.worksheetNumber = value;
                    
                    // If setting valid worksheet number, ensure not absent
                    if (value > 0) {
                        updatedStudent.isAbsent = false;
                    } else if (!updatedStudent.grade) {
                        // Mark as absent only if both worksheet and grade are empty
                        updatedStudent.isAbsent = true;
                    }
                }
                // Special handling for grade
                else if (field === 'grade') {
                    updatedStudent.grade = value;
                    
                    // If setting a grade, ensure not absent
                    if (value) {
                        updatedStudent.isAbsent = false;
                    } else if (!updatedStudent.worksheetNumber || updatedStudent.worksheetNumber <= 0) {
                        // Mark as absent only if both worksheet and grade are empty
                        updatedStudent.isAbsent = true;
                    }
                }
                // For all other fields, just set the value directly
                else {
                    updatedStudent[field] = value;
                }
                
                console.log(`[DataTable] After direct update, student ${studentId} state:`, {
                    isAbsent: updatedStudent.isAbsent,
                    worksheetNumber: updatedStudent.worksheetNumber,
                    grade: updatedStudent.grade,
                    isRepeated: updatedStudent.isRepeated
                });
                
                return updatedStudent;
            }
            return student;
        });
        
        // Directly call onDataChange with the updated data
        onDataChange?.(updatedData);
    };

    // Apply bulk settings to selected students
    const applyBulkSettingsToSelected = () => {
        if (selectedStudentIds.length === 0) return;

        const worksheetNumber = bulkWorksheetNumber ? parseInt(bulkWorksheetNumber) : 0;
        const updatedData = [...data] as any[];

        selectedStudentIds.forEach(studentId => {
            const rowIndex = updatedData.findIndex(item => item.studentId === studentId);
            if (rowIndex !== -1) {
                // Update worksheet number if provided
                if (bulkWorksheetNumber) {
                    updatedData[rowIndex].worksheetNumber = worksheetNumber;
                    updatedData[rowIndex].isAbsent = false;
                }

                // Update grade if provided
                if (bulkGrade) {
                    updatedData[rowIndex].grade = bulkGrade;
                    updatedData[rowIndex].isAbsent = false;
                }
            }
        });

        onDataChange?.(updatedData);
        
        // Close dropdown after applying settings
        setDropdownOpen(false);
        
        // Clear bulk inputs after applying
        setBulkWorksheetNumber('');
        setBulkGrade('');
    };

    // Mark all students without grades as absent
    const markAbsentWithoutGrades = () => {
        const updatedData = [...data] as any[];
        
        updatedData.forEach((student, index) => {
            // If the student has no grade and no worksheet number, mark them as absent
            if ((!student.grade || student.grade === "") && 
                (!student.worksheetNumber || student.worksheetNumber <= 0)) {
                updatedData[index] = {
                    ...student,
                    isAbsent: true,
                    worksheetNumber: 0,
                    grade: "",
                    isRepeated: false
                };
            }
        });

        onDataChange?.(updatedData);
    };

    // Clear all selections
    const clearSelections = () => {
        setSelectedStudentIds([]);
        setBulkWorksheetNumber('');
        setBulkGrade('');
    };

    // Get filtered rows based on table state and search
    const filteredRows = table.getFilteredRowModel().rows;
    
    // Get all students for the dropdown
    const allStudents = data.map(student => ({
        id: (student as any).studentId,
        name: (student as any).name,
        tokenNumber: (student as any).tokenNumber,
    }));

    // Filter students based on search term
    const filteredStudents = allStudents.filter(student => 
        student.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.tokenNumber.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Toggle student selection - updated to ensure correct state updates
    const toggleStudentSelection = (studentId: string) => {
        // Update the selection state
        setSelectedStudentIds(prevIds => {
            const isCurrentlySelected = prevIds.includes(studentId);
            
            // If already selected, remove it; otherwise add it
            if (isCurrentlySelected) {
                return prevIds.filter(id => id !== studentId);
            } else {
                return [...prevIds, studentId];
            }
        });
        
        // We no longer need the setTimeout as we directly set dropdown state in the onSelect handler
    };

    // Add bulk selection and deselection functions
    const selectAllFilteredStudents = () => {
        const filteredIds = filteredStudents.map(student => student.id);
        setSelectedStudentIds(filteredIds);
    };

    const clearAllSelections = () => {
        setSelectedStudentIds([]);
        setBulkWorksheetNumber('');
        setBulkGrade('');
    };

    // Generate grade options (1-40)
    const gradeOptions = Array.from({ length: 40 }, (_, i) => (i + 1).toString());

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex flex-1 items-center gap-4 flex-wrap">
                    <Input
                        placeholder="Search by name..."
                        value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
                        onChange={(event) =>
                            table.getColumn("name")?.setFilterValue(event.target.value)
                        }
                        className="max-w-sm"
                    />
                    <Input
                        placeholder="Search by token number..."
                        value={(table.getColumn("tokenNumber")?.getFilterValue() as string) ?? ""}
                        onChange={(event) =>
                            table.getColumn("tokenNumber")?.setFilterValue(event.target.value)
                        }
                        className="max-w-sm"
                    />
                </div>
            </div>

            {/* Student selection dropdown - updated UI */}
            <div className="space-y-4 border border-gray-200 rounded-lg p-4 bg-gray-50">
                <div className="flex justify-between items-center">
                    <h3 className="text-sm font-medium">Select Students for Bulk Grading</h3>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={selectAllFilteredStudents}
                            className="text-xs"
                        >
                            Select All Filtered
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={clearAllSelections}
                            className="text-xs"
                        >
                            Clear All
                        </Button>
                    </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="w-full sm:w-1/2">
                        <Popover 
                            open={dropdownOpen} 
                            onOpenChange={(open) => {
                                // Simply update the dropdown state
                                setDropdownOpen(open);
                                
                                // If opening the dropdown, reset the search term
                                if (open) {
                                    setSearchTerm('');
                                }
                            }}
                        >
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={dropdownOpen}
                                    className="w-full justify-between"
                                >
                                    {selectedStudentIds.length > 0 
                                        ? `${selectedStudentIds.length} students selected`
                                        : "Search students by name..."}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[300px] p-0 shadow-md border rounded-md" align="start">
                                <Command className="w-full rounded-md" shouldFilter={false}>
                                    <CommandInput 
                                        placeholder="Search students..." 
                                        value={searchTerm}
                                        onValueChange={setSearchTerm}
                                        className="h-9 px-3"
                                    />
                                    {filteredStudents.length === 0 && (
                                        <CommandEmpty className="py-2 text-center text-sm">No students found.</CommandEmpty>
                                    )}
                                    <CommandGroup className="max-h-[240px] overflow-y-auto px-1">
                                        {filteredStudents.map((student) => (
                                            <CommandItem
                                                key={student.id}
                                                value={student.id}
                                                onSelect={(currentValue) => {
                                                    // Toggle selection without auto-closing
                                                    toggleStudentSelection(student.id);
                                                    // Keep dropdown open
                                                    setDropdownOpen(true);
                                                    return false;
                                                }}
                                                className="flex items-center px-2 py-1.5 cursor-pointer rounded-sm hover:bg-gray-100"
                                                onClick={(e) => {
                                                    // Handle clicks directly to avoid default CommandItem behavior
                                                    e.preventDefault();
                                                    e.stopPropagation(); 
                                                    toggleStudentSelection(student.id);
                                                    setDropdownOpen(true);
                                                }}
                                            >
                                                <div className="flex items-center w-5 h-5 mr-2">
                                                    <Check
                                                        className={cn(
                                                            "h-4 w-4",
                                                            selectedStudentIds.includes(student.id) ? "opacity-100" : "opacity-0"
                                                        )}
                                                    />
                                                </div>
                                                <div className="flex-1">
                                                    <span className="font-medium text-sm">{student.name}</span>
                                                    <span className="ml-2 text-gray-500 text-xs">({student.tokenNumber})</span>
                                                </div>
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="batchWorksheetNumber" className="text-sm">Worksheet #</Label>
                        <Input
                            id="batchWorksheetNumber"
                            type="number"
                            min="1"
                            step="1"
                            value={bulkWorksheetNumber}
                            onChange={(e) => setBulkWorksheetNumber(e.target.value)}
                            className="h-9 w-full sm:w-28"
                            placeholder="Enter #"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="batchGrade" className="text-sm">Grade</Label>
                        <Select
                            value={bulkGrade}
                            onValueChange={setBulkGrade}
                        >
                            <SelectTrigger id="batchGrade" className="h-9 w-full sm:w-28">
                                <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                                {gradeOptions.map((value) => (
                                    <SelectItem key={`bulk-${value}`} value={value}>
                                        {value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button
                        onClick={applyBulkSettingsToSelected}
                        disabled={selectedStudentIds.length === 0 || (!bulkGrade && !bulkWorksheetNumber)}
                        className="bg-blue-600 hover:bg-blue-700 text-white h-9 self-end"
                    >
                        Apply to Selected
                    </Button>
                    {selectedStudentIds.length > 0 && (
                        <Button
                            onClick={clearSelections}
                            variant="outline"
                            className="h-9 self-end"
                        >
                            Clear Selection
                        </Button>
                    )}
                </div>
                {selectedStudentIds.length > 0 && (
                    <div className="text-sm">
                        <p className="text-gray-500">Selected students: {selectedStudentIds.length}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {selectedStudentIds.map(id => {
                                const student = allStudents.find(s => s.id === id);
                                return student ? (
                                    <span key={id} className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                        {student.name}
                                    </span>
                                ) : null;
                            })}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex justify-between">
                <Button
                    onClick={markAbsentWithoutGrades}
                    variant="outline"
                    className="text-yellow-600 border-yellow-600 hover:bg-yellow-50"
                >
                    Mark All Without Grades as Absent
                </Button>
            </div>

            {/* Scrollable Card Grid Layout */}
            <div className="border rounded-lg shadow-sm bg-white overflow-hidden">
                <div className="max-h-[70vh] overflow-y-auto p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filteredRows.length > 0 ? (
                            filteredRows.map((row) => {
                                const student = row.original as any;
                                return (
                                    <StudentCard 
                                        key={`student-card-${student.studentId}`} 
                                        student={student}
                                        updateData={updateStudentData}
                                        onSave={onSaveStudent ? () => onSaveStudent(student) : undefined}
                                    />
                                );
                            })
                        ) : (
                            <div className="col-span-2 py-10 text-center text-gray-500">
                                No students found. Try adjusting your search.
                            </div>
                        )}
                    </div>
                </div>
            </div>
            
            <div className="text-sm text-muted-foreground">
                Showing {filteredRows.length} of {data.length} students
            </div>
        </div>
    );
}