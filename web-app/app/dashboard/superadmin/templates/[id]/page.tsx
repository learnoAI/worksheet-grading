'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { worksheetTemplateAPI } from '@/lib/api/worksheetTemplate';
import { WorksheetTemplate, WorksheetTemplateImage, WorksheetTemplateQuestion, MathSkill, UserRole } from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import Link from 'next/link';
import { Skeleton, SkeletonStyles } from '@/components/ui/skeleton';

interface TemplateEditPageProps {
    params: {
        id: string;
    };
}

export default function TemplateEditPage({ params }: TemplateEditPageProps) {
    const { id } = params;
    const router = useRouter();
    const { user, isLoading } = useAuth();

    // Template state
    const [template, setTemplate] = useState<WorksheetTemplate | null>(null);
    const [worksheetNumber, setWorksheetNumber] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Questions state
    const [questions, setQuestions] = useState<WorksheetTemplateQuestion[]>([]);
    const [newQuestion, setNewQuestion] = useState('');
    const [newAnswer, setNewAnswer] = useState('');
    const [newOutOf, setNewOutOf] = useState('1');
    const [addingQuestion, setAddingQuestion] = useState(false);

    // Images state
    const [images, setImages] = useState<WorksheetTemplateImage[]>([]);
    const [imageUrl, setImageUrl] = useState('');
    const [pageNumber, setPageNumber] = useState('1');
    const [addingImage, setAddingImage] = useState(false);

    // Math skills state
    const [mathSkills, setMathSkills] = useState<MathSkill[]>([]);
    const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

    useEffect(() => {
        // Redirect if not logged in or not a superadmin
        if (!isLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('You do not have permission to access this page');
            router.push('/dashboard');
        } else if (!isLoading && user?.role === UserRole.SUPERADMIN) {
            loadData();
        }
    }, [user, isLoading, router, id]);

    const loadData = async () => {
        try {
            setLoading(true);

            // Load template data
            const templateData = await worksheetTemplateAPI.getTemplateById(id);
            setTemplate(templateData);
            setWorksheetNumber(templateData.worksheetNumber?.toString() || '');
            setQuestions(templateData.questions || []);
            setImages(templateData.worksheetImages || []);

            // Load math skills
            const skillsData = await worksheetTemplateAPI.getAllMathSkills();
            setMathSkills(skillsData);
        } catch (error) {
            console.error('Error loading template data:', error);
            toast.error('Failed to load template data');
            router.push('/dashboard/superadmin/templates');
        } finally {
            setLoading(false);
        }
    };

    const updateTemplate = async () => {
        try {
            setSaving(true);

            const data = worksheetNumber.trim()
                ? { worksheetNumber: parseInt(worksheetNumber) }
                : { worksheetNumber: undefined };

            await worksheetTemplateAPI.updateTemplate(id, data);

            toast.success('Template updated successfully');
            loadData(); // Refresh data
        } catch (error) {
            console.error('Error updating template:', error);
            toast.error('Failed to update template');
        } finally {
            setSaving(false);
        }
    };

    const addQuestion = async () => {
        if (!newQuestion.trim()) {
            toast.error('Question text is required');
            return;
        }

        try {
            setAddingQuestion(true);

            await worksheetTemplateAPI.addTemplateQuestion(id, {
                question: newQuestion,
                answer: newAnswer.trim() || undefined,
                outOf: newOutOf ? parseFloat(newOutOf) : 1,
                skillIds: selectedSkills.length > 0 ? selectedSkills : undefined
            });

            toast.success('Question added successfully');

            // Reset form
            setNewQuestion('');
            setNewAnswer('');
            setNewOutOf('1');
            setSelectedSkills([]);

            // Refresh data
            loadData();
        } catch (error) {
            console.error('Error adding question:', error);
            toast.error('Failed to add question');
        } finally {
            setAddingQuestion(false);
        }
    };

    const deleteQuestion = async (questionId: string) => {
        if (confirm('Are you sure you want to delete this question?')) {
            try {
                await worksheetTemplateAPI.deleteTemplateQuestion(questionId);
                toast.success('Question deleted successfully');
                loadData(); // Refresh data
            } catch (error) {
                console.error('Error deleting question:', error);
                toast.error('Failed to delete question');
            }
        }
    };

    const addImage = async () => {
        if (!imageUrl.trim()) {
            toast.error('Image URL is required');
            return;
        }

        if (!pageNumber.trim() || isNaN(parseInt(pageNumber))) {
            toast.error('Valid page number is required');
            return;
        }

        try {
            setAddingImage(true);

            await worksheetTemplateAPI.addTemplateImage(id, {
                imageUrl: imageUrl.trim(),
                pageNumber: parseInt(pageNumber)
            });

            toast.success('Image added successfully');

            // Reset form
            setImageUrl('');
            setPageNumber('1');

            // Refresh data
            loadData();
        } catch (error) {
            console.error('Error adding image:', error);
            toast.error('Failed to add image');
        } finally {
            setAddingImage(false);
        }
    };

    const deleteImage = async (imageId: string) => {
        if (confirm('Are you sure you want to delete this image?')) {
            try {
                await worksheetTemplateAPI.deleteTemplateImage(imageId);
                toast.success('Image deleted successfully');
                loadData(); // Refresh data
            } catch (error) {
                console.error('Error deleting image:', error);
                toast.error('Failed to delete image');
            }
        }
    };

    const handleSkillToggle = (skillId: string) => {
        setSelectedSkills(prev =>
            prev.includes(skillId)
                ? prev.filter(id => id !== skillId)
                : [...prev, skillId]
        );
    };

    const skeleton = useMemo(() => (
        <div className="space-y-6">
            <SkeletonStyles />
            <div className="flex justify-between items-center">
                <Skeleton className="h-8 w-96" />
                <Skeleton className="h-9 w-40" />
            </div>
            <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                    <div className="border rounded-lg p-6 space-y-4">
                        <Skeleton className="h-5 w-40" />
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-10 w-full" />
                        </div>
                        <div className="flex gap-3 justify-end">
                            <Skeleton className="h-9 w-28" />
                            <Skeleton className="h-9 w-40" />
                        </div>
                    </div>
                    <div className="border rounded-lg p-6 space-y-4">
                        <Skeleton className="h-5 w-44" />
                        {Array.from({length:3}).map((_,i)=>(
                            <div key={i} className="space-y-2">
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-10 w-full" />
                            </div>
                        ))}
                        <div className="flex justify-end gap-3">
                            <Skeleton className="h-9 w-28" />
                            <Skeleton className="h-9 w-40" />
                        </div>
                    </div>
                </div>
                <div className="space-y-4">
                    <div className="border rounded-lg p-6 space-y-4">
                        <Skeleton className="h-5 w-52" />
                        {Array.from({length:4}).map((_,i)=>(
                            <Skeleton key={i} className="h-32 w-full" />
                        ))}
                    </div>
                    <div className="border rounded-lg p-6 space-y-4">
                        <Skeleton className="h-5 w-40" />
                        <div className="flex flex-wrap gap-2">
                            {Array.from({length:8}).map((_,i)=>(
                                <Skeleton key={i} className="h-7 w-20" />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    ), []);

    if (isLoading || loading) {
        return skeleton;
    }

    if (!user || user.role !== UserRole.SUPERADMIN || !template) {
        return null; // This shouldn't be visible due to redirect in useEffect
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">
                    Edit Worksheet Template {template.worksheetNumber ? `#${template.worksheetNumber}` : ''}
                </h1>
                <Button variant="outline" asChild>
                    <Link href="/dashboard/superadmin/templates">Back to Templates</Link>
                </Button>
            </div>

            {/* Template Details */}
            <Card>
                <CardHeader>
                    <CardTitle>Template Details</CardTitle>
                    <CardDescription>Update basic template information</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="worksheetNumber">Worksheet Number (Optional)</Label>
                        <Input
                            id="worksheetNumber"
                            type="number"
                            min="1"
                            value={worksheetNumber}
                            onChange={(e) => setWorksheetNumber(e.target.value)}
                            placeholder="Enter worksheet number"
                        />
                    </div>
                </CardContent>
                <CardFooter>
                    <Button onClick={updateTemplate} disabled={saving}>
                        {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                </CardFooter>
            </Card>

            {/* Template Images */}
            <Card>
                <CardHeader>
                    <CardTitle>Template Images</CardTitle>
                    <CardDescription>Manage images associated with this template</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Existing images */}
                    {images.length > 0 ? (
                        <div className="space-y-4">
                            <h3 className="text-lg font-medium">Current Images</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {images.map((image) => (
                                    <div key={image.id} className="border rounded-md p-4 relative">
                                        <Button
                                            size="sm"
                                            variant="destructive"
                                            className="absolute top-2 right-2"
                                            onClick={() => deleteImage(image.id)}
                                        >
                                            Delete
                                        </Button>
                                        <div className="aspect-video relative overflow-hidden rounded-md">
                                            <img
                                                src={image.imageUrl}
                                                alt={`Page ${image.pageNumber}`}
                                                className="object-cover w-full h-full"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).src = 'https://via.placeholder.com/400x300?text=Image+Load+Error';
                                                }}
                                            />
                                        </div>
                                        <p className="mt-2 text-center">Page {image.pageNumber}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <p>No images added yet.</p>
                    )}

                    {/* Add new image */}
                    <div className="border-t pt-4">
                        <h3 className="text-lg font-medium mb-2">Add New Image</h3>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="imageUrl">Image URL</Label>
                                <Input
                                    id="imageUrl"
                                    value={imageUrl}
                                    onChange={(e) => setImageUrl(e.target.value)}
                                    placeholder="Enter image URL"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="pageNumber">Page Number</Label>
                                <Input
                                    id="pageNumber"
                                    type="number"
                                    min="1"
                                    value={pageNumber}
                                    onChange={(e) => setPageNumber(e.target.value)}
                                    placeholder="Enter page number"
                                />
                            </div>
                            <Button onClick={addImage} disabled={addingImage}>
                                {addingImage ? 'Adding...' : 'Add Image'}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Template Questions */}
            <Card>
                <CardHeader>
                    <CardTitle>Template Questions</CardTitle>
                    <CardDescription>Manage questions for this template</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Existing questions */}
                    {questions.length > 0 ? (
                        <div className="space-y-4">
                            <h3 className="text-lg font-medium">Current Questions</h3>
                            <div className="space-y-4">
                                {questions.map((question) => (
                                    <div key={question.id} className="border rounded-md p-4">
                                        <div className="flex justify-between">
                                            <h4 className="font-medium">Question</h4>
                                            <Button
                                                size="sm"
                                                variant="destructive"
                                                onClick={() => deleteQuestion(question.id)}
                                            >
                                                Delete
                                            </Button>
                                        </div>
                                        <p className="mt-1">{question.question}</p>

                                        {question.answer && (
                                            <>
                                                <h4 className="font-medium mt-2">Answer</h4>
                                                <p className="mt-1">{question.answer}</p>
                                            </>
                                        )}

                                        <div className="flex justify-between mt-2">
                                            <div>
                                                <h4 className="font-medium">Points</h4>
                                                <p className="mt-1">{question.outOf || 1}</p>
                                            </div>

                                            {question.skills && question.skills.length > 0 && (
                                                <div>
                                                    <h4 className="font-medium">Skills</h4>
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {question.skills.map(skill => (
                                                            <span key={skill.id} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                                                                {skill.name}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <p>No questions added yet.</p>
                    )}

                    {/* Add new question */}
                    <div className="border-t pt-4">
                        <h3 className="text-lg font-medium mb-2">Add New Question</h3>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="question">Question</Label>
                                <Textarea
                                    id="question"
                                    value={newQuestion}
                                    onChange={(e) => setNewQuestion(e.target.value)}
                                    placeholder="Enter question text"
                                    rows={3}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="answer">Answer (Optional)</Label>
                                <Textarea
                                    id="answer"
                                    value={newAnswer}
                                    onChange={(e) => setNewAnswer(e.target.value)}
                                    placeholder="Enter answer"
                                    rows={2}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="outOf">Point Value</Label>
                                <Input
                                    id="outOf"
                                    type="number"
                                    min="0.5"
                                    step="0.5"
                                    value={newOutOf}
                                    onChange={(e) => setNewOutOf(e.target.value)}
                                    placeholder="Enter point value (default: 1)"
                                />
                            </div>

                            {mathSkills.length > 0 && (
                                <div className="space-y-2">
                                    <Label>Associated Skills (Optional)</Label>
                                    <div className="grid grid-cols-2 gap-2 mt-1">
                                        {mathSkills.map(skill => (
                                            <div key={skill.id} className="flex items-center">
                                                <input
                                                    type="checkbox"
                                                    id={`skill-${skill.id}`}
                                                    checked={selectedSkills.includes(skill.id)}
                                                    onChange={() => handleSkillToggle(skill.id)}
                                                    className="mr-2"
                                                />
                                                <label htmlFor={`skill-${skill.id}`}>{skill.name}</label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <Button onClick={addQuestion} disabled={addingQuestion}>
                                {addingQuestion ? 'Adding...' : 'Add Question'}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
} 