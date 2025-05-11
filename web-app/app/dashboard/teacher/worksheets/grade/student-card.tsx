'use client';

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
import { StudentGrade } from "./columns";

interface StudentCardProps {
    student: StudentGrade;
    updateData: (id: string, field: string, value: any) => void;
    onSave?: (student: StudentGrade) => void;
}

export function StudentCard({ 
    student, 
    updateData, 
    onSave
}: StudentCardProps) {
    // Local state to manage inputs
    const [isAbsent, setIsAbsent] = useState(!!student.isAbsent);
    const [isRepeated, setIsRepeated] = useState(!!student.isRepeated);
    const [worksheetNumber, setWorksheetNumber] = useState<string>(
        isAbsent ? '' : (student.worksheetNumber ? student.worksheetNumber.toString() : '')
    );
    const [grade, setGrade] = useState<string>(student.grade || '');
    
    // Initialize avatar letters from name
    const avatarLetters = student.name
        .split(' ')
        .slice(0, 2)
        .map(name => name.charAt(0))
        .join('')
        .toUpperCase();
        
    // Generate background color based on name (for consistent color per student)
    const getInitialsBgColor = (name: string) => {
        const colors = [
            'bg-blue-500', 'bg-green-500', 'bg-purple-500', 
            'bg-pink-500', 'bg-indigo-500', 'bg-teal-500'
        ];
        const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return colors[hash % colors.length];
    };

    // Update local state when student data changes
    useEffect(() => {
        setIsAbsent(!!student.isAbsent);
        setIsRepeated(!!student.isRepeated);
        setWorksheetNumber(student.isAbsent ? '' : (student.worksheetNumber ? student.worksheetNumber.toString() : ''));
        setGrade(student.grade || '');
    }, [student]);

    // Handler for absent checkbox
    const handleAbsentChange = (checked: boolean) => {
        setIsAbsent(checked);
        
        // Update parent component's data
        updateData(student.id, "isAbsent", checked);
        
        // When marking as absent, clear other fields
        if (checked) {
            setWorksheetNumber('');
            setGrade('');
            setIsRepeated(false);
            updateData(student.id, "worksheetNumber", 0);
            updateData(student.id, "grade", "");
            updateData(student.id, "isRepeated", false);
        }
    };

    // Handler for repeated checkbox
    const handleRepeatedChange = (checked: boolean) => {
        setIsRepeated(checked);
        updateData(student.id, "isRepeated", checked);
    };

    // Handler for worksheet number changes
    const handleWorksheetNumberChange = (value: string) => {
        setWorksheetNumber(value);
        
        const numValue = parseInt(value) || 0;
        updateData(student.id, "worksheetNumber", numValue);
        
        // If entering a valid worksheet number, automatically unmark as absent
        if (numValue > 0 && isAbsent) {
            setIsAbsent(false);
            updateData(student.id, "isAbsent", false);
        }
    };

    // Handler for grade changes
    const handleGradeChange = (value: string) => {
        setGrade(value);
        updateData(student.id, "grade", value);
        
        // If entering a grade, automatically unmark as absent
        if (value && isAbsent) {
            setIsAbsent(false);
            updateData(student.id, "isAbsent", false);
        }
    };

    // Generate grade options (1-40)
    const gradeOptions = Array.from({ length: 40 }, (_, i) => (i + 1).toString());

    return (
        <Card 
            className={`overflow-hidden transition-colors relative ${isAbsent ? 'bg-gray-50 border-gray-200' : 'bg-white'}`}
            data-student-id={student.id}
        >
            <CardContent className="p-6">
                <div className="flex items-center space-x-4 mb-4">
                    <div className="flex-shrink-0">
                        <div className={`w-12 h-12 rounded-full ${getInitialsBgColor(student.name)} text-white flex items-center justify-center text-lg font-semibold`}>
                            {avatarLetters}
                        </div>
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-gray-900 truncate">{student.name}</h3>
                        <p className="text-sm text-gray-500">
                            Token no: {student.tokenNumber}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="space-y-1.5">
                        <Label htmlFor={`worksheet-${student.id}`} className="text-sm font-medium">Worksheet no</Label>
                        <Input
                            id={`worksheet-${student.id}`}
                            type="number"
                            min="1"
                            step="1"
                            value={worksheetNumber}
                            onChange={(e) => handleWorksheetNumberChange(e.target.value)}
                            disabled={isAbsent}
                            placeholder={isAbsent ? "N/A" : ""}
                            className="h-10"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor={`marks-${student.id}`} className="text-sm font-medium">Marks</Label>
                        <Select
                            disabled={isAbsent}
                            value={grade}
                            onValueChange={handleGradeChange}
                        >
                            <SelectTrigger 
                                id={`marks-${student.id}`} 
                                className="w-full h-10"
                            >
                                <SelectValue placeholder="Select Marks" />
                            </SelectTrigger>
                            <SelectContent>
                                {gradeOptions.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="flex flex-wrap justify-between items-center mt-4">
                    <div className="space-x-4 flex items-center">
                        <div className="flex items-center space-x-2">
                            <input
                                type="checkbox"
                                id={`absent-${student.id}`}
                                checked={isAbsent}
                                onChange={(e) => handleAbsentChange(e.target.checked)}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <Label htmlFor={`absent-${student.id}`} className="text-sm">Absent</Label>
                        </div>

                        <div className="flex items-center space-x-2">
                            <input
                                type="checkbox"
                                id={`repeated-${student.id}`}
                                checked={isRepeated}
                                onChange={(e) => handleRepeatedChange(e.target.checked)}
                                disabled={isAbsent}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <Label htmlFor={`repeated-${student.id}`} className="text-sm">Repeated</Label>
                        </div>
                    </div>

                    <div className="mt-2 sm:mt-0">
                        {onSave && (
                            <Button 
                                onClick={() => onSave(student)}
                                className="bg-blue-600 hover:bg-blue-700 text-white"
                                size="sm"
                            >
                                Next Sheet
                            </Button>
                        )}
                    </div>
                </div>
                
                {student.existing && (
                    <div className="absolute top-4 right-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            Update
                        </span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}