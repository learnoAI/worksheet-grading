'use client';

import { ColumnDef } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTableColumnHeader } from "./data-table-column-header";
import { useState, useEffect } from "react";

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
            console.log('Rendering Absent checkbox:', row.index, isAbsent, row.original.name);
            
            return (
                <ControlledCheckbox
                    checked={isAbsent}
                    onChange={(checked) => {
                        console.log('Checkbox changed for', row.original.name, ':', checked);
                        updateData(row.index, "isAbsent", checked);
                        if (checked) {
                            updateData(row.index, "worksheetNumber", 0);
                            updateData(row.index, "grade", "");
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
            return (
                <Input
                    type="number"
                    min="1"
                    step="1"
                    value={row.getValue("worksheetNumber") || ''}
                    onChange={(e) => updateData(row.index, "worksheetNumber", parseInt(e.target.value) || 0)}
                    className="w-20 h-8 px-2 text-sm"
                    disabled={isAbsent}
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
            return (
                <Input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    value={row.getValue("grade") || ''}
                    onChange={(e) => updateData(row.index, "grade", e.target.value)}
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