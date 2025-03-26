'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { worksheetTemplateAPI } from '@/lib/api/worksheetTemplate';
import { MathSkill, UserRole } from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import Link from 'next/link';

export default function SkillsPage() {
    const router = useRouter();
    const { user, isLoading } = useAuth();
    const [skills, setSkills] = useState<MathSkill[]>([]);
    const [loading, setLoading] = useState(true);

    // New skill form state
    const [skillName, setSkillName] = useState('');
    const [skillDescription, setSkillDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        // Redirect if not logged in or not a superadmin
        if (!isLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('You do not have permission to access this page');
            router.push('/dashboard');
        } else if (!isLoading && user?.role === UserRole.SUPERADMIN) {
            loadSkills();
        }
    }, [user, isLoading, router]);

    const loadSkills = async () => {
        try {
            setLoading(true);
            const data = await worksheetTemplateAPI.getAllMathSkills();
            setSkills(data);
        } catch (error) {
            console.error('Error loading math skills:', error);
            toast.error('Failed to load math skills');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!skillName.trim()) {
            toast.error('Skill name is required');
            return;
        }

        try {
            setSubmitting(true);

            await worksheetTemplateAPI.createMathSkill({
                name: skillName.trim(),
                description: skillDescription.trim() || undefined
            });

            toast.success('Math skill created successfully');

            // Reset form
            setSkillName('');
            setSkillDescription('');

            // Reload skills
            loadSkills();
        } catch (error) {
            console.error('Error creating math skill:', error);
            toast.error('Failed to create math skill');
        } finally {
            setSubmitting(false);
        }
    };

    if (isLoading || loading) {
        return <div className="flex justify-center items-center h-full">Loading...</div>;
    }

    if (!user || user.role !== UserRole.SUPERADMIN) {
        return null; // This shouldn't be visible due to redirect in useEffect
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Math Skills</h1>
                <Button variant="outline" asChild>
                    <Link href="/dashboard/superadmin/templates">Back to Templates</Link>
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Add new skill form */}
                <Card>
                    <form onSubmit={handleSubmit}>
                        <CardHeader>
                            <CardTitle>Add New Math Skill</CardTitle>
                            <CardDescription>Create a new skill that can be associated with worksheet questions</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="skillName">Skill Name</Label>
                                <Input
                                    id="skillName"
                                    value={skillName}
                                    onChange={(e) => setSkillName(e.target.value)}
                                    placeholder="Enter skill name (e.g., Addition, Fractions)"
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="skillDescription">Description (Optional)</Label>
                                <Textarea
                                    id="skillDescription"
                                    value={skillDescription}
                                    onChange={(e) => setSkillDescription(e.target.value)}
                                    placeholder="Enter skill description"
                                    rows={3}
                                />
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? 'Creating...' : 'Create Skill'}
                            </Button>
                        </CardFooter>
                    </form>
                </Card>

                {/* Existing skills */}
                <Card>
                    <CardHeader>
                        <CardTitle>Existing Math Skills</CardTitle>
                        <CardDescription>List of available math skills</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {skills.length === 0 ? (
                            <p>No math skills found. Add your first skill using the form.</p>
                        ) : (
                            <div className="space-y-4">
                                {skills.map((skill) => (
                                    <div key={skill.id} className="border rounded-md p-4">
                                        <h3 className="font-medium">{skill.name}</h3>
                                        {skill.description && (
                                            <p className="mt-1 text-sm text-gray-600">{skill.description}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
} 