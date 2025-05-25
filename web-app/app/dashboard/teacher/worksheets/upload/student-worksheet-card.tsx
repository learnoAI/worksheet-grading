'use client';

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UploadIcon } from "lucide-react";

interface StudentWorksheet {
    studentId: string;
    name: string;
    tokenNumber: string;
    worksheetNumber: number;
    isAbsent: boolean;
    files: FileList | null;
    grade: string;
    isUploading: boolean;
}

interface StudentWorksheetCardProps {
    worksheet: StudentWorksheet;
    index: number;
    onUpdate: (index: number, field: string, value: any) => void;
    onFileChange: (studentId: string, files: FileList | null) => void;
    onUpload: (worksheet: StudentWorksheet) => void;
    fileInputRefs: React.MutableRefObject<{[key: string]: HTMLInputElement | null}>;
}

export function StudentWorksheetCard({ 
    worksheet, 
    index,
    onUpdate,
    onFileChange,
    onUpload,
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
    };

    const handleAbsentChange = (checked: boolean) => {
        onUpdate(index, "isAbsent", checked);
    };

    const handleWorksheetNumberChange = (value: string) => {
        const numValue = parseInt(value) || 0;
        onUpdate(index, "worksheetNumber", numValue);
    };

    const handleFileButtonClick = () => {
        fileInputRefs.current[worksheet.studentId]?.click();
    };

    return (
        <Card 
            className={`overflow-hidden transition-colors relative ${
                worksheet.isAbsent ? 'bg-gray-50 border-gray-200' : 
                worksheet.grade ? 'bg-green-50 border-green-200' : 'bg-white'
            }`}
        >
            <CardContent className="p-6">
                <div className="flex items-center space-x-4 mb-4">
                    <div className="flex-shrink-0">
                        <div className={`w-12 h-12 rounded-full ${getInitialsBgColor(worksheet.name)} text-white flex items-center justify-center text-lg font-semibold`}>
                            {avatarLetters}
                        </div>
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-gray-900 truncate">{worksheet.name}</h3>
                        <p className="text-sm text-gray-500">
                            Token no: {worksheet.tokenNumber}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="space-y-1.5">
                        <Label htmlFor={`worksheet-${worksheet.studentId}`} className="text-sm font-medium">Worksheet no</Label>
                        <Input
                            id={`worksheet-${worksheet.studentId}`}
                            type="number"
                            min="1"
                            step="1"
                            value={worksheet.worksheetNumber || ''}
                            onChange={(e) => handleWorksheetNumberChange(e.target.value)}
                            disabled={worksheet.isAbsent}
                            placeholder={worksheet.isAbsent ? "N/A" : "#"}
                            className="h-10"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor={`grade-${worksheet.studentId}`} className="text-sm font-medium">Grade</Label>
                        <div className="h-10 px-3 py-2 text-sm flex items-center border rounded-md bg-gray-50">
                            {worksheet.grade ? `${worksheet.grade}/10` : (worksheet.isUploading ? "Processing..." : "-")}
                        </div>
                    </div>
                </div>

                <div className="space-y-3 mb-4">
                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium">Images</Label>
                        <div className="flex items-center space-x-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleFileButtonClick}
                                disabled={worksheet.isAbsent || worksheet.isUploading}
                                className="flex-1"
                            >
                                <UploadIcon size={16} className="mr-2" />
                                {worksheet.files && worksheet.files.length > 0 
                                    ? `${worksheet.files.length} file${worksheet.files.length > 1 ? 's' : ''} selected`
                                    : "Choose Images"
                                }
                            </Button>
                            <input 
                                id={`file-input-${worksheet.studentId}`}
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(e) => onFileChange(worksheet.studentId, e.target.files)}
                                disabled={worksheet.isAbsent || worksheet.isUploading}
                                className="hidden"
                                ref={(el) => {
                                    fileInputRefs.current[worksheet.studentId] = el;
                                }}
                            />
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap justify-between items-center mt-4">
                    <div className="space-x-4 flex items-center">
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
                    </div>

                    <div className="mt-2 sm:mt-0">
                        <Button 
                            onClick={() => onUpload(worksheet)}
                            disabled={worksheet.isAbsent || worksheet.isUploading || !worksheet.files || worksheet.files.length === 0 || !worksheet.worksheetNumber}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                            size="sm"
                        >
                            {worksheet.isUploading ? "Processing..." : "AI Grade"}
                        </Button>
                    </div>
                </div>
                
            </CardContent>
        </Card>
    );
}
