'use client';

import * as React from "react";
import {
    ColumnDef,
    ColumnFiltersState,
    SortingState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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
                console.log('updateData called:', rowIndex, columnId, value);
                const newData = [...data];
                (newData as any)[rowIndex] = {
                    ...(newData as any)[rowIndex],
                    [columnId]: value,
                };
                console.log('Updated newData:', newData);
                onDataChange?.(newData);
            },
        },
    });

    const handleBulkWorksheetUpdate = () => {
        const worksheetNumber = parseInt(bulkWorksheetNumber);
        if (!isNaN(worksheetNumber) && worksheetNumber > 0) {
            const newData = data.map(row => {
                // Only update non-absent students or mark all as present with the new worksheet number
                return {
                    ...row,
                    worksheetNumber,
                    isAbsent: false // Setting worksheet number means student is present
                };
            });
            onDataChange?.(newData);
            setBulkWorksheetNumber('');
        }
    };

    const displayColumns = React.useMemo(() => {
        if (!onSaveStudent) return columns;
        
        const saveColumn: ColumnDef<TData, any> = {
            id: "actions",
            header: "Actions",
            cell: ({ row }) => (
                <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => onSaveStudent(row.original)}
                >
                    Save
                </Button>
            ),
        };
        
        return [...columns, saveColumn];
    }, [columns, onSaveStudent]);

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex flex-1 items-center gap-4">
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
                <div className="flex items-end gap-2">
                    <div className="space-y-2">
                        <Label htmlFor="bulkWorksheetNumber">Set Worksheet # for All</Label>
                        <Input
                            id="bulkWorksheetNumber"
                            type="number"
                            min="1"
                            step="1"
                            value={bulkWorksheetNumber}
                            onChange={(e) => setBulkWorksheetNumber(e.target.value)}
                            className="w-24"
                            placeholder="#"
                        />
                    </div>
                    <Button
                        onClick={handleBulkWorksheetUpdate}
                        variant="secondary"
                        className="mb-0.5"
                        disabled={!bulkWorksheetNumber || parseInt(bulkWorksheetNumber) < 1}
                    >
                        Apply
                    </Button>
                </div>
            </div>
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => {
                                    return (
                                        <TableHead key={header.id}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext()
                                                )}
                                        </TableHead>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                    data-row-index={row.index}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id}>
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell
                                    colSpan={displayColumns.length}
                                    className="h-24 text-center"
                                >
                                    No results.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            
            <div className="text-sm text-muted-foreground">
                Showing {data.length} students
            </div>
        </div>
    );
}