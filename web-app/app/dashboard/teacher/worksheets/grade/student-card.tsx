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
import { usePostHog } from 'posthog-js/react';
import { TrendingUp } from "lucide-react";
import { 
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

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
    const [isAbsent, setIsAbsent] = useState(!!student.isAbsent);
    const [worksheetNumber, setWorksheetNumber] = useState<string>(
        isAbsent ? '' : (student.worksheetNumber ? student.worksheetNumber.toString() : '')
    );
    const [grade, setGrade] = useState<string>(student.grade || '');
    const posthog = usePostHog();
    
    const avatarLetters = student.name
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

    useEffect(() => {
        console.log(`[StudentCard] Student data updated: ${student.name}`, {
            isAbsent: student.isAbsent,
            worksheetNumber: student.worksheetNumber,
            grade: student.grade
        });
        
        const hasWorksheetNumber = student.worksheetNumber && student.worksheetNumber > 0;
        const hasGrade = student.grade && student.grade.toString().trim() !== '';
        
        if (student.isAbsent && hasWorksheetNumber && hasGrade) {
            console.warn(`[StudentCard] Inconsistent state detected for ${student.name}: marked as absent but has worksheet=${student.worksheetNumber} and grade=${student.grade}`);
            updateData(student.studentId, "isAbsent", false);
            setIsAbsent(false);
        } else {
            setIsAbsent(!!student.isAbsent);
        }
        
        setWorksheetNumber(student.worksheetNumber ? student.worksheetNumber.toString() : '');
        
        setGrade(student.grade || '');
    }, [student]);
    const handleAbsentChange = (checked: boolean) => {
        console.log(`${student.name}: Changing absent status to ${checked}`);
        
        setIsAbsent(checked);
        
        if (checked) {
            setWorksheetNumber('');
            setGrade('');
            updateData(student.studentId, "isAbsent", true);
        } else {
            setWorksheetNumber('');
            updateData(student.studentId, "isAbsent", false);
        }
    };

    const handleIncorrectGradeChange = (checked: boolean) => {
        updateData(student.studentId, "isIncorrectGrade", checked);
        
        // Track incorrect grade checkbox interaction
        posthog.capture('incorrect_grade_checkbox_changed', {
            student_name: student.name,
            student_token: student.tokenNumber,
            worksheet_number: student.worksheetNumber,
            current_grade: student.grade,
            is_checked: checked,
            page: 'grade_worksheet'
        });
    };

    const handleWorksheetNumberChange = (value: string) => {
        console.log(`${student.name}: Setting worksheet number to ${value}`);
        setWorksheetNumber(value);
        const numValue = parseInt(value) || 0;
        
        if (isAbsent) {
            setIsAbsent(false);
            
            updateData(student.studentId, "isAbsent", false);
            
            setTimeout(() => {
                updateData(student.studentId, "worksheetNumber", numValue);
            }, 50);
        } else {
            updateData(student.studentId, "worksheetNumber", numValue);
        }
    };

    const handleGradeChange = (value: string) => {
        console.log(`${student.name}: Setting grade to ${value}`);
        setGrade(value);
        
        if (isAbsent) {
            // Update local state
            setIsAbsent(false);
            
            // First update absent status in parent component
            updateData(student.studentId, "isAbsent", false);
            
            // Wait a moment to ensure the absent status change is processed
            setTimeout(() => {
                // Then update the grade
                updateData(student.studentId, "grade", value);
            }, 50);
        } else {
            // Just update the grade directly
            updateData(student.studentId, "grade", value);
        }
    };

    // Generate grade options (1-40)
    const gradeOptions = Array.from({ length: 40 }, (_, i) => (40 - i).toString());

    const determineIfProgressed = () => {
        if (student.worksheetNumber <= 1) return false;
        return !student.existing && student.worksheetNumber > 1;
    };
    
    const hasProgressed = determineIfProgressed();

    return (
        <Card 
            className={`overflow-hidden transition-colors relative ${isAbsent ? 'bg-gray-50 border-gray-200' : hasProgressed ? 'bg-green-50 border-green-200' : 'bg-white'}`}
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
                        <div className="flex items-center">
                            <Label htmlFor={`worksheet-${student.id}`} className="text-sm font-medium">Worksheet no</Label>
                            {hasProgressed && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="ml-2 flex items-center text-green-600 text-xs font-semibold cursor-help">
                                                <TrendingUp size={16} className="mr-1" />
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent className="p-3">
                                            <p className="text-sm">This student scored 80%+ on their previous worksheet</p>
                                            <p className="text-sm mt-1">Automatically advanced to the next level</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>
                        <Input
                            id={`worksheet-${student.id}`}
                            type="number"
                            min="1"
                            step="1"
                            value={worksheetNumber}
                            onChange={(e) => handleWorksheetNumberChange(e.target.value)}
                            disabled={isAbsent}
                            placeholder={isAbsent ? "N/A" : ""}
                            className={`h-10 ${hasProgressed ? 'border-green-500 focus-visible:ring-green-500 bg-green-50' : ''}`}
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
                                className="w-full h-10 bg-white"
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
                    <div className="space-x-4 flex items-center flex-wrap">
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
                                id={`incorrect-grade-${student.id}`}
                                checked={student.isIncorrectGrade || false}
                                onChange={(e) => handleIncorrectGradeChange(e.target.checked)}
                                disabled={isAbsent}
                                className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                            />
                            <Label htmlFor={`incorrect-grade-${student.id}`} className="text-sm">Incorrect Grade</Label>
                        </div>
                    </div>

                    <div className="mt-2 sm:mt-0">
                        {onSave && (
                            <Button 
                                onClick={() => onSave(student)}
                                className="bg-blue-600 hover:bg-blue-700 text-white"
                                size="sm"
                            >
                                Save
                            </Button>
                        )}
                    </div>
                </div>
                
            </CardContent>
        </Card>
    );
}