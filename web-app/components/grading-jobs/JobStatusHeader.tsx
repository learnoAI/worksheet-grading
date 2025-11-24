'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ClassJobsStatus, GradingJob } from '@/lib/api/types';
import { gradingJobsAPI } from '@/lib/api/gradingJobs';
import { ChevronDown, ChevronUp, Clock, Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

interface JobStatusHeaderProps {
    classId?: string;
    date: string;
    onRefresh?: () => void;
}

export function JobStatusHeader({ classId, date, onRefresh }: JobStatusHeaderProps) {
    const [status, setStatus] = useState<ClassJobsStatus | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchStatus = async () => {
        if (!classId) {
            setLoading(false);
            return;
        }
        
        try {
            setError(null);
            const response = await gradingJobsAPI.getJobsByClass(classId, date);
            setStatus({
                pending: response.pending,
                processing: response.processing,
                completed: response.completed,
                failed: response.failed,
                jobs: response.jobs
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch job status');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        
        // Poll for updates every 10 seconds if there are active jobs
        const interval = setInterval(() => {
            if (classId && status && (status.pending > 0 || status.processing > 0)) {
                fetchStatus();
            }
        }, 10000);

        return () => clearInterval(interval);
    }, [classId, date, status?.pending, status?.processing]);

    const handleRefresh = () => {
        setLoading(true);
        fetchStatus();
        onRefresh?.();
    };

    if (loading && !status) {
        return (
            <Card className="mb-6 p-4">
                <div className="flex items-center justify-center gap-2 text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading job status...</span>
                </div>
            </Card>
        );
    }

    if (error) {
        return (
            <Card className="mb-6 p-4 border-red-200 bg-red-50">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-red-700">
                        <XCircle className="h-4 w-4" />
                        <span className="text-sm font-medium">{error}</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleRefresh}>
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </div>
            </Card>
        );
    }

    const totalJobs = status ? (status.pending + status.processing + status.completed + status.failed) : 0;
    
    if (!status || totalJobs === 0) {
        return null; // Don't show header if no jobs
    }

    const activeJobs = status.pending + status.processing;
    const hasActiveJobs = activeJobs > 0;

    return (
        <Card className={`mb-6 ${hasActiveJobs ? 'border-blue-200 bg-blue-50' : ''}`}>
            <div className="p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <h3 className="text-sm font-semibold text-gray-900">Grading Jobs</h3>
                        
                        <div className="flex items-center gap-3">
                            {/* Pending */}
                            {status.pending > 0 && (
                                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-yellow-100 text-yellow-800">
                                    <Clock className="h-3.5 w-3.5" />
                                    <span className="text-xs font-medium">{status.pending} Queued</span>
                                </div>
                            )}
                            
                            {/* Processing */}
                            {status.processing > 0 && (
                                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 text-blue-800">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    <span className="text-xs font-medium">{status.processing} Processing</span>
                                </div>
                            )}
                            
                            {/* Completed */}
                            {status.completed > 0 && (
                                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-800">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    <span className="text-xs font-medium">{status.completed} Completed</span>
                                </div>
                            )}
                            
                            {/* Failed */}
                            {status.failed > 0 && (
                                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-800">
                                    <XCircle className="h-3.5 w-3.5" />
                                    <span className="text-xs font-medium">{status.failed} Failed</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={handleRefresh}
                            disabled={loading}
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                        
                        {status.jobs.length > 0 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setExpanded(!expanded)}
                            >
                                {expanded ? (
                                    <>
                                        <ChevronUp className="h-4 w-4 mr-1" />
                                        Hide Details
                                    </>
                                ) : (
                                    <>
                                        <ChevronDown className="h-4 w-4 mr-1" />
                                        Show Details
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </div>

                {/* Expanded job list */}
                {expanded && status.jobs.length > 0 && (
                    <div className="mt-4 border-t pt-4">
                        <div className="max-h-96 overflow-y-auto space-y-2">
                            {status.jobs.map((job) => (
                                <JobStatusItem key={job.jobId} job={job} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </Card>
    );
}

// Individual job status item
function JobStatusItem({ job }: { job: ClassJobsStatus['jobs'][0] }) {
    const getStatusIcon = () => {
        switch (job.status) {
            case 'pending':
                return <Clock className="h-4 w-4 text-yellow-600" />;
            case 'processing':
                return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />;
            case 'completed':
                return <CheckCircle2 className="h-4 w-4 text-green-600" />;
            case 'failed':
                return <XCircle className="h-4 w-4 text-red-600" />;
        }
    };

    const getStatusColor = () => {
        switch (job.status) {
            case 'pending':
                return 'bg-yellow-50 border-yellow-200';
            case 'processing':
                return 'bg-blue-50 border-blue-200';
            case 'completed':
                return 'bg-green-50 border-green-200';
            case 'failed':
                return 'bg-red-50 border-red-200';
        }
    };

    return (
        <div className={`flex items-center justify-between p-3 rounded-lg border ${getStatusColor()}`}>
            <div className="flex items-center gap-3">
                {getStatusIcon()}
                <div>
                    <p className="text-sm font-medium text-gray-900">
                        Token: {job.tokenNo}
                    </p>
                    <p className="text-xs text-gray-500">
                        {job.studentName}
                    </p>
                </div>
            </div>
            
            <div className="text-right">
                {job.status === 'failed' && job.error && (
                    <p className="text-xs text-red-600 max-w-xs truncate" title={job.error}>
                        {job.error}
                    </p>
                )}
                {job.status === 'completed' && job.result && (
                    <p className="text-xs font-medium text-green-700">
                        Score: {job.result.grade}/{job.result.total_possible}
                    </p>
                )}
            </div>
        </div>
    );
}
