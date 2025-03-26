'use client';

import { ColumnDef } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import { DataTableColumnHeader } from "./data-table-column-header";

export type StudentGrade = {
    id: string;
    studentId: string;
    name: string;
    tokenNumber: string;
    worksheetNumber: number;
    grade: string;
    existing: boolean;
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
        id: "worksheetNumber",
        accessorKey: "worksheetNumber",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Worksheet #" />
        ),
        cell: ({ row, table }) => {
            const updateData = (table as any).options.meta?.updateData;
            return (
                <Input
                    type="number"
                    min="1"
                    step="1"
                    value={row.getValue("worksheetNumber") || ''}
                    onChange={(e) => updateData(row.index, "worksheetNumber", parseInt(e.target.value) || 0)}
                    className="w-20 h-8 px-2 text-sm"
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
            return (
                <Input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    value={row.getValue("grade") || ''}
                    onChange={(e) => updateData(row.index, "grade", e.target.value)}
                    className="w-16 h-8 px-2 text-sm"
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