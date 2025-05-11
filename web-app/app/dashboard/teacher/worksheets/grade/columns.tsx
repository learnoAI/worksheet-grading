'use client';

import { ColumnDef } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import { DataTableColumnHeader } from "./data-table-column-header";
import { useState, useEffect } from "react";
import React from "react";
import { useDebounceFunction } from "@/lib/hooks";

// Custom checkbox component that forces re-render
function ControlledCheckbox({
    checked,
    onChange,
    disabled = false,
    label
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    label?: string;
}) {
    // Local state to ensure UI updates
    const [isChecked, setIsChecked] = useState(checked);

    // Update local state when prop changes
    useEffect(() => {
        setIsChecked(checked);
    }, [checked]);

    return (
        <div className="flex items-center">
            <input
                type="checkbox"
                checked={isChecked}
                onChange={(e) => {
                    setIsChecked(e.target.checked);
                    onChange(e.target.checked);
                }}
                disabled={disabled}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary accent-primary"
            />
            {label && <span className="ml-2 text-xs">{label}</span>}
        </div>
    );
}

export type StudentGrade = {
    id: string;
    studentId: string;
    name: string;
    tokenNumber: string;
    worksheetNumber: number;
    grade: string;
    existing: boolean;
    isAbsent: boolean;
    isRepeated: boolean;
    isNew?: boolean;
};

export const columns: ColumnDef<StudentGrade>[] = [
    {
        accessorKey: "name",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Student Name" />
        ),
    },
    {
        accessorKey: "tokenNumber",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Token Number" />
        ),
    },
    {
        id: "isAbsent",
        accessorKey: "isAbsent",
        header: "Absent",
        cell: ({ row, table }) => {
            const updateData = (table as any).options.meta?.updateData;
            const isAbsent = !!row.original.isAbsent;

            return (
                <ControlledCheckbox
                    checked={isAbsent}
                    onChange={(checked) => {
                        // First, update the isAbsent state
                        updateData(row.index, "isAbsent", checked);

                        // When marking as absent, ensure worksheet number and grade are cleared immediately
                        if (checked) {
                            // Force clearing values to empty strings and numbers to zero
                            updateData(row.index, "worksheetNumber", 0);
                            updateData(row.index, "grade", "");
                            updateData(row.index, "isRepeated", false);
                        }
                    }}
                    label="Absent"
                />
            );
        },
    },
    {
        id: "worksheetNumber",
        accessorKey: "worksheetNumber",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Worksheet #" />
        ),
        cell: ({ row, table }) => {
            const updateData = (table as any).options.meta?.updateData;
            const isAbsent = !!row.original.isAbsent;

            // Using useState to manage local input state to prevent deselecting
            const [inputValue, setInputValue] = useState(
                isAbsent ? '' : (row.getValue("worksheetNumber") || '')
            );

            // Update local state when row data changes
            useEffect(() => {
                setInputValue(isAbsent ? '' : (row.getValue("worksheetNumber") || ''));
            }, [isAbsent, row]);

            // Use our custom debounce hook for the update function
            const debouncedUpdate = useDebounceFunction((value: string) => {
                const numValue = parseInt(value) || 0;
                updateData(row.index, "worksheetNumber", numValue);
                
                // If entering a valid worksheet number, automatically unmark as absent
                if (numValue > 0 && isAbsent) {
                    updateData(row.index, "isAbsent", false);
                }
            }, 300);
            
            const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                const newValue = e.target.value;
                setInputValue(newValue);
                debouncedUpdate(newValue);
            };
            
            return (
                <Input
                    type="number"
                    min="1"
                    step="1"
                    value={inputValue}
                    onChange={handleChange}
                    onClick={() => {
                        // If absent is checked, uncheck it when user attempts to enter worksheet number
                        if (isAbsent) {
                            updateData(row.index, "isAbsent", false);
                        }
                    }}
                    className="w-20 h-8 px-2 text-sm"
                    disabled={isAbsent}
                    placeholder={isAbsent ? "N/A" : ""}
                />
            );
        },
    },
    {
        id: "isRepeated",
        accessorKey: "isRepeated",
        header: "Repeated",
        cell: ({ row, table }) => {
            const updateData = (table as any).options.meta?.updateData;
            const isAbsent = !!row.original.isAbsent;
            const isRepeated = !!row.original.isRepeated;

            return (
                <ControlledCheckbox
                    checked={isRepeated}
                    onChange={(checked) => {
                        updateData(row.index, "isRepeated", checked);
                    }}
                    disabled={isAbsent}
                    label="Repeated"
                />
            );
        },
    },
    {
        id: "grade",
        accessorKey: "grade",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Grade" />
        ),
        cell: ({ row, table }) => {
            const updateData = (table as any).options.meta?.updateData;
            const isAbsent = !!row.original.isAbsent;

            // Using useState to manage local input state to prevent deselecting
            const [inputValue, setInputValue] = useState(
                isAbsent ? '' : (row.getValue("grade") || '')
            );

            // Update local state when row data changes
            useEffect(() => {
                setInputValue(isAbsent ? '' : (row.getValue("grade") || ''));
            }, [isAbsent, row]);
            
            // Use our custom debounce hook for the update function
            const debouncedUpdate = useDebounceFunction((value: string) => {
                updateData(row.index, "grade", value);
                
                // If entering a valid grade, automatically unmark as absent
                if (value && isAbsent) {
                    updateData(row.index, "isAbsent", false);
                }
                
                // If grade is removed, consider marking as absent
                if (value === '') {
                    const worksheetNumber = row.getValue("worksheetNumber") || 0;
                    if (worksheetNumber === 0) {
                        updateData(row.index, "isAbsent", true);
                    }
                }
            }, 300);
            
            const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                const newValue = e.target.value;
                setInputValue(newValue);
                debouncedUpdate(newValue);
            };
            
            return (
                <Input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    value={inputValue}
                    onChange={handleChange}
                    onClick={() => {
                        // If absent is checked, uncheck it when user attempts to enter grade
                        if (isAbsent) {
                            updateData(row.index, "isAbsent", false);
                        }
                    }}
                    className="w-16 h-8 px-2 text-sm"
                    disabled={isAbsent}
                    placeholder={isAbsent ? "N/A" : ""}
                />
            );
        },
    },
    {
        id: "existing",
        accessorKey: "existing",
        enableHiding: true,
    },
    {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
            const existing = row.getValue("existing") || false;
            return (
                <div className="text-xs">
                    {existing ? (
                        <span className="text-blue-600">Update</span>
                    ) : (
                        <span className="text-gray-500">Create</span>
                    )}
                </div>
            );
        },
    },
];