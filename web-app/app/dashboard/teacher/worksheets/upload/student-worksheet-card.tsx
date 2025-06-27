'use client';

import React from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UploadIcon, Camera } from "lucide-react";

interface StudentWorksheet {
    studentId: string;
    name: string;
    tokenNumber: string;
    worksheetNumber: number;
    isAbsent: boolean;
    grade: string;
    isUploading: boolean;
    page1File?: File | null;
    page2File?: File | null;
}

interface StudentWorksheetCardProps {
    worksheet: StudentWorksheet;
    index: number;
    onUpdate: (index: number, field: string, value: any) => void;
    onPageFileChange?: (studentId: string, pageNumber: number, file: File | null) => void;
    onUpload: (worksheet: StudentWorksheet) => void;
    onSave: (worksheet: StudentWorksheet) => void;
    fileInputRefs: React.RefObject<{[key: string]: HTMLInputElement | null}>;
}

export function StudentWorksheetCard({ 
    worksheet, 
    index,
    onUpdate,
    onPageFileChange,
    onUpload,
    onSave,
    fileInputRefs
}: StudentWorksheetCardProps) {
    const avatarLetters = worksheet.name
        .split(' ')
        .slice(0, 2)
        .map(name => name.charAt(0))
        .join('')
        .toUpperCase();
        
    const getInitialsBgColor = (name: string) => {
        const colors = [
            'bg-blue-500', 'bg-green-500', 'bg-purple-500', 
            'bg-pink-500', 'bg-indigo-500', 'bg-teal-500'
        ];
        const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return colors[hash % colors.length];
    };    const handleAbsentChange = (checked: boolean) => {
        onUpdate(index, "isAbsent", checked);
    };

    const handleWorksheetNumberChange = (value: string) => {
        const numValue = parseInt(value) || 0;
        onUpdate(index, "worksheetNumber", numValue);
    };    const handleGradeChange = (value: string) => {
        onUpdate(index, "grade", value);
        // If entering a grade, automatically unmark as absent
        if (value && worksheet.isAbsent) {
            onUpdate(index, "isAbsent", false);
        }
    };    const handleFileButtonClick = () => {
        fileInputRefs.current[worksheet.studentId]?.click();
    };    const handlePageFileUpload = (pageNumber: number) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = false;
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file && onPageFileChange) {
                onPageFileChange(worksheet.studentId, pageNumber, file);
            }
        };
        input.click();
    };

    const handlePageFileCapture = (pageNumber: number) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment'; // Use back camera on mobile devices
        input.multiple = false;
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file && onPageFileChange) {
                onPageFileChange(worksheet.studentId, pageNumber, file);
            }
        };
        input.click();
    };    return (
        <div 
            className={`rounded-lg border transition-colors relative ${
                worksheet.isAbsent ? 'bg-gray-50 border-gray-200' : 
                worksheet.grade ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'
            } p-3 md:p-4`}
        >
            <div className="flex items-center space-x-3 mb-3">
                <div className="flex-shrink-0">
                    <div className={`w-10 h-10 md:w-12 md:h-12 rounded-full ${getInitialsBgColor(worksheet.name)} text-white flex items-center justify-center text-sm md:text-lg font-semibold`}>
                        {avatarLetters}
                    </div>
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="text-base md:text-lg font-semibold text-gray-900 truncate">{worksheet.name}</h3>
                    <p className="text-xs md:text-sm text-gray-500">
                        Token: {worksheet.tokenNumber}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 md:gap-4 mb-3">
                <div className="space-y-1">
                    <Label htmlFor={`worksheet-${worksheet.studentId}`} className="text-xs md:text-sm font-medium">Worksheet #</Label>
                    <Input
                        id={`worksheet-${worksheet.studentId}`}
                        type="number"
                        min="1"
                        step="1"
                        value={worksheet.worksheetNumber || ''}
                        onChange={(e) => handleWorksheetNumberChange(e.target.value)}
                        disabled={worksheet.isAbsent}
                        placeholder={worksheet.isAbsent ? "N/A" : "#"}
                        className="h-8 md:h-10 text-sm"
                    />
                </div>
                <div className="space-y-1">
                    <Label htmlFor={`grade-${worksheet.studentId}`} className="text-xs md:text-sm font-medium">Grade</Label>
                    <Input
                        id={`grade-${worksheet.studentId}`}
                        type="number"
                        min="0"
                        max="10"
                        step="0.1"
                        value={worksheet.grade || ''}
                        onChange={(e) => handleGradeChange(e.target.value)}
                        onClick={() => {
                            // If absent is checked, uncheck it when user attempts to enter grade
                            if (worksheet.isAbsent) {
                                onUpdate(index, "isAbsent", false);
                            }
                        }}
                        disabled={worksheet.isAbsent || worksheet.isUploading}
                        placeholder={worksheet.isAbsent ? "N/A" : (worksheet.isUploading ? "Processing..." : "Grade")}
                        className="h-8 md:h-10 text-sm"
                    />
                </div>
            </div>                <div className="space-y-2 mb-3">
                    <div className="space-y-1">
                        <Label className="text-xs md:text-sm font-medium">Worksheet Pages</Label>
                        <div className="grid grid-cols-2 gap-2 md:gap-3">                            {/* Page 1 */}
                            <div className={`border border-dashed rounded-lg p-2 md:p-3 text-center transition-colors ${
                                worksheet.page1File ? 'border-green-300 bg-green-50' : 'border-gray-300 bg-gray-50'
                            } ${worksheet.isAbsent ? 'opacity-50' : ''}`}>
                                <div className="space-y-1 md:space-y-2">
                                    <div className="text-xs md:text-sm font-medium text-gray-700">Page 1</div>
                                    {worksheet.page1File ? (
                                        <div className="space-y-1 md:space-y-2">
                                            <div className="relative w-full h-16 md:h-24 bg-gray-100 rounded overflow-hidden">
                                                <img
                                                    src={URL.createObjectURL(worksheet.page1File)}
                                                    alt="Page 1 preview"
                                                    className="w-full h-full object-cover"
                                                />
                                            </div>
                                            <div className="text-xs text-green-600">
                                                ✓ Uploaded
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-xs text-gray-500 py-4 md:py-8">No image</div>
                                    )}
                                    <div className="flex flex-col space-y-1">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handlePageFileCapture(1)}
                                            disabled={worksheet.isAbsent || worksheet.isUploading}
                                            className="text-xs h-6 md:h-7 px-2"
                                        >
                                            <Camera size={10} className="mr-1" />
                                            Camera
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handlePageFileUpload(1)}
                                            disabled={worksheet.isAbsent || worksheet.isUploading}
                                            className="text-xs h-6 md:h-7 px-2"
                                        >
                                            <UploadIcon size={10} className="mr-1" />
                                            Upload
                                        </Button>
                                    </div>
                                </div>
                            </div>                            {/* Page 2 */}
                            <div className={`border border-dashed rounded-lg p-2 md:p-3 text-center transition-colors ${
                                worksheet.page2File ? 'border-green-300 bg-green-50' : 'border-gray-300 bg-gray-50'
                            } ${worksheet.isAbsent ? 'opacity-50' : ''}`}>
                                <div className="space-y-1 md:space-y-2">
                                    <div className="text-xs md:text-sm font-medium text-gray-700">Page 2</div>
                                    {worksheet.page2File ? (
                                        <div className="space-y-1 md:space-y-2">
                                            <div className="relative w-full h-16 md:h-24 bg-gray-100 rounded overflow-hidden">
                                                <img
                                                    src={URL.createObjectURL(worksheet.page2File)}
                                                    alt="Page 2 preview"
                                                    className="w-full h-full object-cover"
                                                />
                                            </div>
                                            <div className="text-xs text-green-600">
                                                ✓ Uploaded
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-xs text-gray-500 py-4 md:py-8">No image</div>
                                    )}
                                    <div className="flex flex-col space-y-1">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handlePageFileCapture(2)}
                                            disabled={worksheet.isAbsent || worksheet.isUploading}
                                            className="text-xs h-6 md:h-7 px-2"
                                        >
                                            <Camera size={10} className="mr-1" />
                                            Camera
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handlePageFileUpload(2)}
                                            disabled={worksheet.isAbsent || worksheet.isUploading}
                                            className="text-xs h-6 md:h-7 px-2"
                                        >
                                            <UploadIcon size={10} className="mr-1" />
                                            Upload
                                        </Button>                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mt-3 space-y-2 md:space-y-0">
                    <div className="flex items-center space-x-2">
                        <input
                            type="checkbox"
                            id={`absent-${worksheet.studentId}`}
                            checked={worksheet.isAbsent}
                            onChange={(e) => handleAbsentChange(e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <Label htmlFor={`absent-${worksheet.studentId}`} className="text-sm">Absent</Label>
                    </div>

                    <div className="flex w-full md:w-auto space-x-2">
                        <Button 
                            onClick={() => onUpload(worksheet)}
                            disabled={worksheet.isAbsent || worksheet.isUploading || (!worksheet.page1File && !worksheet.page2File) || !worksheet.worksheetNumber}
                            className="bg-blue-600 hover:bg-blue-700 text-white flex-1 md:flex-none"
                            size="sm"
                        >
                            {worksheet.isUploading ? "Processing..." : "AI Grade"}
                        </Button>
                        <Button
                            onClick={() => onSave(worksheet)}
                            disabled={worksheet.isAbsent || worksheet.isUploading || !worksheet.worksheetNumber}
                            variant="outline"
                            size="sm"
                            className="flex-1 md:flex-none"
                        >
                            Save
                        </Button>
                    </div>
                </div>
                      
        </div>
    );
}
