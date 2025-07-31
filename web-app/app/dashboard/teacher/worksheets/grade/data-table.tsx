'use client';

import {
    ColumnDef,
    ColumnFiltersState,
    SortingState,
    useReactTable,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
} from "@tanstack/react-table";
import { useMemo, useCallback, useState, useEffect } from "react";

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
import { useDebounce } from "@/lib/hooks";
import { StudentGrade } from "./columns";

function deepCopy<T>(obj: T): T {
    if (obj === null || typeof obj !== "object") return obj;
    if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T;
    if (Array.isArray(obj)) return obj.map(item => deepCopy(item)) as unknown as T;
    
    const cloned = {} as T;
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            cloned[key] = deepCopy(obj[key]);
        }
    }
    return cloned;
}

interface DataTableProps<TData extends StudentGrade, TValue> {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    onDataChange?: (updatedData: TData[]) => void;
    onSaveStudent?: (student: TData) => void;
}

export function DataTable<TData extends StudentGrade, TValue>({
    columns,
    data,
    onDataChange,
    onSaveStudent,
}: DataTableProps<TData, TValue>) {
    const [sorting, setSorting] = useState<SortingState>([
        { id: "tokenNumber", desc: false }
    ]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [bulkWorksheetNumber, setBulkWorksheetNumber] = useState<string>('');
    const [bulkGrade, setBulkGrade] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);

    // Debounce search term for better performance
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    // Memoize table configuration to prevent unnecessary re-renders
    const tableConfig = useMemo(() => ({
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
            updateData: (rowIndex: number, columnId: string, value: unknown) => {
                // Use optimized deep copy instead of JSON methods
                const newData = deepCopy(data);
                
                // Get the current row data
                const currentRow = (newData as any)[rowIndex];
                
                
                // Handle specific field updates with their side effects
                if (columnId === 'isAbsent') {
                    const newAbsentState = !!value;
                    
                    // When marking a student as absent, clear other fields
                    if (newAbsentState) {
                        (newData as any)[rowIndex] = {
                            ...currentRow,
                            isAbsent: true,
                            worksheetNumber: 0,
                            grade: "",
                            isRepeated: false,
                            isIncorrectGrade: false
                        };
                    } else {
                        // When unmarking as absent, only update the isAbsent status
                        // The StudentCard component will handle setting proper values
                        (newData as any)[rowIndex] = {
                            ...currentRow,
                            isAbsent: false
                        };
                    }                } else if (columnId === 'worksheetNumber') {
                    // Set worksheet number without auto-marking as absent
                    const worksheetNumber = value;
                    
                    
                    (newData as any)[rowIndex] = {
                        ...currentRow,
                        worksheetNumber: worksheetNumber
                        // No longer auto-mark as absent
                    };                } else if (columnId === 'grade') {
                    // Set grade without auto-marking as absent
                    const grade = value;
                    
                    
                    (newData as any)[rowIndex] = {
                        ...currentRow,
                        grade: grade
                        // No longer auto-mark as absent
                    };
                } else {
                    // For regular field updates
                    (newData as any)[rowIndex] = {
                        ...currentRow,
                        [columnId]: value,
                    };
                }
                
                // Log the final state after update
                
                // Notify the parent component of the data change
                onDataChange?.(newData);
            },
        },
    }), [data, columns, sorting, columnFilters, onDataChange]);

    const table = useReactTable(tableConfig);    // Helper function to update data by student ID - memoized for performance
    const updateStudentData = useCallback((studentId: string, field: string, value: unknown) => {
        // Instead of trying to find the student in possibly filtered data,
        // we'll make a direct update to the full data array
        const updatedData = [...data].map((student: TData) => {
            // Only update the student with matching ID
            if (student.studentId === studentId) {
                
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
                }                // Special handling for worksheet number
                else if (field === 'worksheetNumber') {
                    updatedStudent.worksheetNumber = typeof value === 'number' ? value : Number(value);
                    
                    // If setting valid worksheet number, ensure not absent
                    const numValue = typeof value === 'number' ? value : Number(value);
                    if (numValue > 0) {
                        updatedStudent.isAbsent = false;
                    }
                    // No longer auto-mark as absent if value is 0
                }
                // Special handling for grade
                else if (field === 'grade') {
                    updatedStudent.grade = String(value);
                    
                    // If setting a grade, ensure not absent
                    if (value) {
                        updatedStudent.isAbsent = false;
                    }
                    // No longer auto-mark as absent if grade is empty
                }
                // For all other fields, just set the value directly
                else {
                    updatedStudent[field] = value;
                }
                
                
                return updatedStudent;
            }
            return student;
        });
        
        // Directly call onDataChange with the updated data
        onDataChange?.(updatedData);
    }, [data, onDataChange]);    // Apply bulk settings to selected students - memoized for performance
    const applyBulkSettingsToSelected = useCallback(() => {
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
    }, [selectedStudentIds, bulkWorksheetNumber, bulkGrade, data, onDataChange]);

    // Clear all selections - memoized for performance
    const clearSelections = useCallback(() => {
        setSelectedStudentIds([]);
        setBulkWorksheetNumber('');
        setBulkGrade('');
    }, []);

    // Memoize filtered rows calculation
    const filteredRows = useMemo(() => table.getRowModel().rows, [table]);
    
    // Memoize all students for the dropdown - only recalculate when data changes
    const allStudents = useMemo(() => data.map(student => ({
        id: (student as any).studentId,
        name: (student as any).name,
        tokenNumber: (student as any).tokenNumber,
    })), [data]);

    // Memoize filtered students based on debounced search term
    const filteredStudents = useMemo(() => 
        allStudents.filter(student => 
            student.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
            student.tokenNumber.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
        ),
        [allStudents, debouncedSearchTerm]
    );    // Toggle student selection - memoized and optimized
    const toggleStudentSelection = useCallback((studentId: string) => {
        setSelectedStudentIds(prevIds => {
            const isCurrentlySelected = prevIds.includes(studentId);
            
            // If already selected, remove it; otherwise add it
            if (isCurrentlySelected) {
                return prevIds.filter(id => id !== studentId);
            } else {
                return [...prevIds, studentId];
            }
        });
    }, []);

    // Bulk selection functions - memoized for performance
    const selectAllFilteredStudents = useCallback(() => {
        const filteredIds = filteredStudents.map(student => student.id);
        setSelectedStudentIds(filteredIds);
    }, [filteredStudents]);

    const clearAllSelections = useCallback(() => {
        setSelectedStudentIds([]);
        setBulkWorksheetNumber('');
        setBulkGrade('');
    }, []);

    // Memoize grade options to prevent recreation on every render
    const gradeOptions = useMemo(() => Array.from({ length: 41 }, (_, i) => (40 - i).toString()), []);


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
            </div>            {/* Button removed: No longer auto-mark students as absent */}

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
