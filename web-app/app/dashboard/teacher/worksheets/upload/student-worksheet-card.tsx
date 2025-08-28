'use client';

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UploadIcon, Camera, Info, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { useState } from "react";
import { usePostHog } from 'posthog-js/react';

interface QuestionScore {
    question_number: number;
    question: string;
    student_answer: string;
    correct_answer: string;
    points_earned: number;
    max_points: number;
    is_correct: boolean;
    feedback: string;
}

interface GradingDetails {
    total_possible: number;
    grade_percentage: number;
    total_questions: number;
    correct_answers: number;
    wrong_answers: number;
    unanswered: number;
    question_scores: QuestionScore[];
    wrong_questions: QuestionScore[];
    correct_questions: QuestionScore[];
    unanswered_questions: QuestionScore[];
    overall_feedback: string;
}

interface StudentWorksheet {
    studentId: string;
    name: string;
    tokenNumber: string;
    worksheetNumber: number;
    isAbsent: boolean;
    isIncorrectGrade?: boolean;
    grade: string;
    isUploading: boolean;
    page1File?: File | null;
    page2File?: File | null;
    isRepeated?: boolean;
    gradingDetails?: GradingDetails;
    wrongQuestionNumbers?: string;
    id?: string;
    existing?: boolean;
}

interface StudentWorksheetCardProps {
    worksheet: StudentWorksheet;
    index: number;
    onUpdate: (index: number, field: string, value: any) => void;
    onPageFileChange?: (studentId: string, pageNumber: number, file: File | null) => void;
    onUpload: (worksheet: StudentWorksheet) => void;
    onSave: (worksheet: StudentWorksheet) => void;
}

export function StudentWorksheetCard({ 
    worksheet, 
    index,
    onUpdate,
    onPageFileChange,
    onUpload,
    onSave
}: StudentWorksheetCardProps) {
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const posthog = usePostHog();
    
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

    const handleIncorrectGradeChange = (checked: boolean) => {
        onUpdate(index, "isIncorrectGrade", checked);
        
        posthog.capture('incorrect_grade_checkbox_changed', {
            student_name: worksheet.name,
            student_token: worksheet.tokenNumber,
            worksheet_number: worksheet.worksheetNumber,
            current_grade: worksheet.grade,
            is_checked: checked,
            page: 'upload_worksheet'
        });
    };

    const handleWorksheetNumberChange = (value: string) => {
        const numValue = parseInt(value) || 0;
        onUpdate(index, "worksheetNumber", numValue);
    };

    const handleGradeChange = (value: string) => {
        onUpdate(index, "grade", value);
        if (value && worksheet.isAbsent) {
            onUpdate(index, "isAbsent", false);
        }
    };

    const handleWrongQuestionNumbersChange = (value: string) => {
        onUpdate(index, "wrongQuestionNumbers", value);
    };

    const getWrongQuestionNumbersFromGrading = () => {
        if (!worksheet.gradingDetails) return '';
        
        const wrongNumbers = worksheet.gradingDetails.wrong_questions.map(q => q.question_number);
        const unansweredNumbers = worksheet.gradingDetails.unanswered_questions.map(q => q.question_number);
        const allWrongNumbers = [...wrongNumbers, ...unansweredNumbers].sort((a, b) => a - b);
        
        return allWrongNumbers.join(', ');
    };

    const displayedWrongQuestionNumbers = worksheet.wrongQuestionNumbers !== undefined 
        ? worksheet.wrongQuestionNumbers 
        : getWrongQuestionNumbersFromGrading();

    const handlePageFileUpload = (pageNumber: number) => {
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
        input.capture = 'environment';
        input.multiple = false;
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file && onPageFileChange) {
                onPageFileChange(worksheet.studentId, pageNumber, file);
            }
        };
        input.click();
    };

    return (
        <div 
            className={`rounded-lg border transition-colors relative ${
                worksheet.isAbsent ? 'bg-gray-50 border-gray-200' : 
                worksheet.grade ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'
            } p-3 md:p-4`}
        >
            <div className="absolute top-2 right-2 flex gap-1">
                {worksheet.existing && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Saved
                    </span>
                )}
                {worksheet.isRepeated && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-orange-500 text-white">
                        Repeat
                    </span>
                )}
            </div>

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
                    <div className="flex items-center space-x-1">
                        <Select
                            value={worksheet.grade || ''}
                            onValueChange={handleGradeChange}
                            disabled={worksheet.isAbsent || worksheet.isUploading}
                        >
                            <SelectTrigger 
                                className="h-8 md:h-10 text-sm flex-1"
                                onClick={() => {
                                    if (worksheet.isAbsent) {
                                        onUpdate(index, "isAbsent", false);
                                    }
                                }}
                            >
                                <SelectValue 
                                    placeholder={worksheet.isAbsent ? "N/A" : (worksheet.isUploading ? "Processing" : "Select grade")} 
                                />
                            </SelectTrigger>
                            <SelectContent>
                                {Array.from({ length: 41 }, (_, i) => (40 - i).toString()).map((grade) => (
                                    <SelectItem key={grade} value={grade}>
                                        {grade}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {worksheet.gradingDetails && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 relative"
                                title="View grading details"
                                onClick={() => setIsDetailsOpen(true)}
                            >
                                <Info size={14} />
                                {(worksheet.gradingDetails.wrong_answers > 0 || worksheet.gradingDetails.unanswered > 0) && (
                                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                                        {worksheet.gradingDetails.wrong_answers + worksheet.gradingDetails.unanswered}
                                    </span>
                                )}
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            <div className="space-y-1 mb-3">
                <Label htmlFor={`wrong-questions-${worksheet.studentId}`} className="text-xs md:text-sm font-medium">
                    Wrong Questions
                </Label>
                <Input
                    id={`wrong-questions-${worksheet.studentId}`}
                    type="text"
                    value={displayedWrongQuestionNumbers}
                    onChange={(e) => handleWrongQuestionNumbersChange(e.target.value)}
                    disabled={worksheet.isAbsent || worksheet.isUploading}
                    placeholder={worksheet.isAbsent ? "N/A" : (worksheet.isUploading ? "Processing..." : "Enter wrong question numbers")}
                    className="h-8 md:h-10 text-sm"
                />
                {worksheet.gradingDetails && (
                    <div className="space-y-1">
                        {worksheet.gradingDetails.wrong_answers === 0 && worksheet.gradingDetails.unanswered === 0 && (
                            <p className="text-xs text-green-600">
                                No wrong questions
                            </p>
                        )}
                    </div>
                )}
            </div>                
            <div className="space-y-2 mb-3">
                    <div className="space-y-1">
                        <Label className="text-xs md:text-sm font-medium">Worksheet Pages</Label>
                        <div className="grid grid-cols-2 gap-2 md:gap-3">
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
                            </div>

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
                    <div className="flex flex-col space-y-2">
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
                        <div className="flex items-center space-x-2">
                            <input
                                type="checkbox"
                                id={`incorrect-grade-${worksheet.studentId}`}
                                checked={worksheet.isIncorrectGrade || false}
                                onChange={(e) => handleIncorrectGradeChange(e.target.checked)}
                                disabled={worksheet.isAbsent || worksheet.isUploading}
                                className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                            />
                            <Label htmlFor={`incorrect-grade-${worksheet.studentId}`} className="text-sm">Incorrect Grade</Label>
                        </div>
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
                            disabled={worksheet.isUploading}
                            variant="outline"
                            size="sm"
                            className="flex-1 md:flex-none"
                        >
                            Save
                        </Button>
                    </div>
                </div>

            {worksheet.gradingDetails && (
                <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
                    <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Grading Details - {worksheet.name}</DialogTitle>
                        </DialogHeader>
                        
                        <div className="space-y-6">
                            {/* Summary */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-green-600">{worksheet.gradingDetails.correct_answers}</div>
                                    <div className="text-sm text-gray-600">Correct</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-red-600">{worksheet.gradingDetails.wrong_answers}</div>
                                    <div className="text-sm text-gray-600">Wrong</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-yellow-600">{worksheet.gradingDetails.unanswered}</div>
                                    <div className="text-sm text-gray-600">Unanswered</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-blue-600">{worksheet.gradingDetails.grade_percentage}%</div>
                                    <div className="text-sm text-gray-600">Score</div>
                                </div>
                            </div>

                            {worksheet.gradingDetails.overall_feedback && (
                                <div className="p-4 bg-blue-50 rounded-lg">
                                    <h3 className="font-semibold text-blue-800 mb-2">Overall Feedback</h3>
                                    <p className="text-blue-700">{worksheet.gradingDetails.overall_feedback}</p>
                                </div>
                            )}

                            {worksheet.gradingDetails.wrong_questions.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-semibold text-red-600 mb-3 flex items-center">
                                        <XCircle className="mr-2" size={20} />
                                        Wrong Answers ({worksheet.gradingDetails.wrong_questions.length})
                                    </h3>
                                    <div className="space-y-3">
                                        {worksheet.gradingDetails.wrong_questions.map((question, idx) => (
                                            <div key={idx} className="p-3 border border-red-200 rounded-lg bg-red-50">
                                                <div className="font-medium text-red-800">Question {question.question_number}: {question.question}</div>
                                                <div className="mt-2 text-sm">
                                                    <div className="text-red-600"><strong>Student Answer:</strong> {question.student_answer}</div>
                                                    <div className="text-green-600"><strong>Correct Answer:</strong> {question.correct_answer}</div>
                                                    <div className="text-gray-600"><strong>Points:</strong> {question.points_earned}/{question.max_points}</div>
                                                    {question.feedback && (
                                                        <div className="text-red-700 mt-1"><strong>Feedback:</strong> {question.feedback}</div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {worksheet.gradingDetails.unanswered_questions.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-semibold text-yellow-600 mb-3 flex items-center">
                                        <AlertCircle className="mr-2" size={20} />
                                        Unanswered Questions ({worksheet.gradingDetails.unanswered_questions.length})
                                    </h3>
                                    <div className="space-y-3">
                                        {worksheet.gradingDetails.unanswered_questions.map((question, idx) => (
                                            <div key={idx} className="p-3 border border-yellow-200 rounded-lg bg-yellow-50">
                                                <div className="font-medium text-yellow-800">Question {question.question_number}: {question.question}</div>
                                                <div className="mt-2 text-sm">
                                                    <div className="text-gray-600"><strong>Expected Answer:</strong> {question.correct_answer}</div>
                                                    <div className="text-gray-600"><strong>Points:</strong> {question.points_earned}/{question.max_points}</div>
                                                    {question.feedback && (
                                                        <div className="text-yellow-700 mt-1"><strong>Feedback:</strong> {question.feedback}</div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {worksheet.gradingDetails.correct_questions.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-semibold text-green-600 mb-3 flex items-center">
                                        <CheckCircle className="mr-2" size={20} />
                                        Correct Answers ({worksheet.gradingDetails.correct_questions.length})
                                    </h3>
                                    <div className="space-y-3 max-h-60 overflow-y-auto">
                                        {worksheet.gradingDetails.correct_questions.map((question, idx) => (
                                            <div key={idx} className="p-3 border border-green-200 rounded-lg bg-green-50">
                                                <div className="font-medium text-green-800">Question {question.question_number}: {question.question}</div>
                                                <div className="mt-2 text-sm">
                                                    <div className="text-green-600"><strong>Student Answer:</strong> {question.student_answer}</div>
                                                    <div className="text-gray-600"><strong>Points:</strong> {question.points_earned}/{question.max_points}</div>
                                                    {question.feedback && (
                                                        <div className="text-green-700 mt-1"><strong>Feedback:</strong> {question.feedback}</div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            )}
                      
        </div>
    );
}
