"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, CheckCircle2, XCircle, ArrowRight, TrendingUp, Target, BrainCircuit, ChevronDown, ChevronUp } from "lucide-react";

import Loader from "@/components/common/Loader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

import useCourse from "@/hooks/queries/student/useCourse";
import {
    useEntryAssessment,
    useGenerateEntryAssessment,
    useSubmitEntryAssessment,
} from "@/hooks/queries/student/useEntryAssessment";

const DIFFICULTY_STYLES = {
    EASY: "bg-green-500/10 text-green-400",
    MEDIUM: "bg-amber-500/10 text-amber-400",
    HARD: "bg-red-500/10 text-red-400",
};

export default function EntryAssessmentPage({ params }) {
    const { courseId } = use(params);
    const router = useRouter();

    const { data: course } = useCourse(courseId);
    const { data: assessment, isLoading, error, refetch } = useEntryAssessment(courseId);
    const generateMutation = useGenerateEntryAssessment(courseId);
    const submitMutation = useSubmitEntryAssessment(courseId);

    const [answers, setAnswers] = useState({});
    const [showReview, setShowReview] = useState(false);

    const notFound = error?.response?.status === 404;

    const goToCourse = () => router.push(`/student/learn/${courseId}`);

    const handleStart = async () => {
        // Expected failures (e.g. 422 "not enough content") are surfaced via
        // generateMutation.isError below — nothing further to do here.
        await generateMutation.mutateAsync().catch(() => {});
    };

    const handleSelect = (questionId, optionIndex) => {
        setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
    };

    const allAnswered = useMemo(
        () => (assessment?.questions || []).every((q) => answers[q.id] !== undefined),
        [assessment, answers]
    );

    const handleSubmit = async () => {
        // Expected failures are surfaced via submitMutation.isError below.
        await submitMutation.mutateAsync(answers).catch(() => {});
    };

    if (isLoading) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <Loader />
            </div>
        );
    }

    // ---- Intro: no assessment generated yet ----
    if (notFound && !generateMutation.data) {
        return (
            <div className="mx-auto max-w-2xl py-12 text-center">
                <Card className="space-y-6 p-10">
                    <Sparkles className="mx-auto h-12 w-12 text-orange-500" />

                    <div>
                        <h1 className="text-2xl font-bold text-white">AI Entry Assessment</h1>
                        <p className="mt-3 text-slate-400">
                            Before you start <span className="text-white font-medium">{course?.title || "this course"}</span>, take a
                            short AI-generated assessment. It helps us understand what you already know so we can personalize your
                            learning path — compressing what you've mastered and giving extra time to what needs work. Nothing is ever
                            skipped.
                        </p>
                    </div>

                    {generateMutation.isError && (
                        <p className="text-sm text-red-400">
                            {generateMutation.error?.response?.data?.message || "Failed to start the assessment. Please try again."}
                        </p>
                    )}

                    <Button onClick={handleStart} loading={generateMutation.isPending} disabled={generateMutation.isPending} className="mx-auto px-8 py-3">
                        Start Assessment
                    </Button>

                    <button onClick={goToCourse} className="block w-full text-sm text-slate-500 hover:text-slate-300">
                        Skip for now and go to the course
                    </button>
                </Card>
            </div>
        );
    }

    const current = assessment || generateMutation.data;

    if (!current) {
        return (
            <div className="mx-auto max-w-2xl py-12 text-center">
                <Card className="p-10">
                    <p className="text-slate-400">Something went wrong loading your entry assessment.</p>
                    <Button onClick={() => refetch()} className="mt-4">Try again</Button>
                </Card>
            </div>
        );
    }

    // ---- Generating: assessment requested by another tab/request, still in progress ----
    if (current.status === "GENERATING") {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
                <Loader />
                <p className="text-slate-400">Generating your assessment questions...</p>
            </div>
        );
    }

    // ---- Failed: honest, non-blocking ----
    if (current.status === "FAILED") {
        return (
            <div className="mx-auto max-w-2xl py-12 text-center">
                <Card className="space-y-5 p-10">
                    <XCircle className="mx-auto h-12 w-12 text-red-500" />
                    <h1 className="text-xl font-bold text-white">Entry assessment unavailable</h1>
                    <p className="text-slate-400">
                        {current.failureReason || "We couldn't generate an entry assessment for this course right now."}
                    </p>
                    <Button onClick={goToCourse} className="mx-auto px-8">
                        Continue to the course <ArrowRight className="ml-2 inline h-4 w-4" />
                    </Button>
                </Card>
            </div>
        );
    }

    // ---- Evaluated: results screen ----
    if (current.status === "EVALUATED") {
        return (
            <div className="mx-auto max-w-3xl space-y-6 py-10">
                <Card className="space-y-6 p-8 text-center">
                    <BrainCircuit className="mx-auto h-12 w-12 text-orange-500" />
                    <h1 className="text-2xl font-bold text-white">Your Knowledge Level: {current.knowledgeLevel}</h1>

                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                        <Stat label="Overall Score" value={`${current.overallScore}%`} />
                        <Stat label="Confidence" value={`${current.confidenceScore}%`} />
                        <Stat label="Concepts Covered" value={current.conceptScores?.length ?? 0} />
                    </div>

                    <div className="grid gap-4 text-left sm:grid-cols-2">
                        <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-green-400">
                                <TrendingUp className="h-4 w-4" /> Strengths
                            </p>
                            {current.strongConcepts?.length ? (
                                <ul className="space-y-1 text-sm text-slate-300">
                                    {current.strongConcepts.map((c) => <li key={c}>• {c}</li>)}
                                </ul>
                            ) : (
                                <p className="text-sm text-slate-500">None identified yet — that's okay, this is your starting point.</p>
                            )}
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-400">
                                <Target className="h-4 w-4" /> Areas to Improve
                            </p>
                            {current.weakConcepts?.length ? (
                                <ul className="space-y-1 text-sm text-slate-300">
                                    {current.weakConcepts.map((c) => <li key={c}>• {c}</li>)}
                                </ul>
                            ) : (
                                <p className="text-sm text-slate-500">No significant gaps found.</p>
                            )}
                        </div>
                    </div>

                    <p className="text-sm text-slate-500">
                        We've personalized your learning path based on these results — every concept is still covered, just with
                        depth and duration matched to what you already know.
                    </p>

                    <button
                        onClick={() => setShowReview((prev) => !prev)}
                        className="mx-auto flex items-center gap-1.5 text-sm font-medium text-orange-400 hover:text-orange-300"
                    >
                        {showReview ? "Hide" : "Review"} your answers
                        {showReview ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>

                    <Button onClick={goToCourse} className="mx-auto px-8 py-3">
                        Start Learning <ArrowRight className="ml-2 inline h-4 w-4" />
                    </Button>
                </Card>

                {showReview && <AnswerReview questions={current.questions || []} />}
            </div>
        );
    }

    // ---- Ready: questions ----
    const questions = current.questions || [];

    return (
        <div className="mx-auto max-w-3xl space-y-6 py-10">
            <div className="text-center">
                <h1 className="text-2xl font-bold text-white">Entry Assessment</h1>
                <p className="mt-1 text-sm text-slate-500">
                    {Object.keys(answers).length} / {questions.length} answered
                </p>
            </div>

            <div className="space-y-4">
                {questions.map((q, idx) => (
                    <Card key={q.id} className="space-y-4 p-6">
                        <div className="flex items-start justify-between gap-4">
                            <p className="font-medium text-white">
                                {idx + 1}. {q.question}
                            </p>
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${DIFFICULTY_STYLES[q.difficulty] || "bg-slate-800 text-slate-300"}`}>
                                {q.difficulty}
                            </span>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                            {q.options.map((option, optionIndex) => {
                                const selected = answers[q.id] === optionIndex;
                                const optionText = getOptionText(option);
                                return (
                                    <button
                                        key={optionIndex}
                                        onClick={() => handleSelect(q.id, optionIndex)}
                                        className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-left text-sm transition ${
                                            selected
                                                ? "border-orange-500 bg-orange-500/10 text-white"
                                                : "border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700"
                                        }`}
                                    >
                                        {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-orange-500" />}
                                        <span>{optionText}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </Card>
                ))}
            </div>

            <div className="sticky bottom-4 flex flex-col items-center gap-2">
                {submitMutation.isError && (
                    <p className="text-sm text-red-400">
                        {submitMutation.error?.response?.data?.message || "Failed to submit your assessment. Please try again."}
                    </p>
                )}
                <Button
                    onClick={handleSubmit}
                    loading={submitMutation.isPending}
                    disabled={!allAnswered || submitMutation.isPending}
                    className="px-10 py-3"
                >
                    Submit Assessment
                </Button>
            </div>
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-2xl font-bold text-white">{value}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
        </div>
    );
}

/** Per-question breakdown — student's answer vs. the correct one, with the explanation, only shown once evaluated. */
const getOptionText = (opt) => {
    if (opt === null || opt === undefined) return "";
    if (typeof opt === "string") return opt;
    if (typeof opt === "object") return opt.optionText || opt.text || JSON.stringify(opt);
    return String(opt);
};

function AnswerReview({ questions }) {
    if (questions.length === 0) return null;

    return (
        <div className="space-y-3">
            {questions.map((q, idx) => (
                <Card key={q.id} className={`space-y-3 p-5 border-l-4 ${q.isCorrect ? "border-l-green-500" : "border-l-red-500"}`}>
                    <div className="flex items-start justify-between gap-4">
                        <p className="text-sm font-medium text-white">
                            {idx + 1}. {q.question}
                        </p>
                        {q.isCorrect ? (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                        ) : (
                            <XCircle className="h-5 w-5 shrink-0 text-red-500" />
                        )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                        {q.options.map((option, optionIndex) => {
                            const isCorrectOption = optionIndex === q.correctAnswerIndex;
                            const isSelected = optionIndex === q.selectedIndex;
                            const optionText = getOptionText(option);
                            return (
                                <div
                                    key={optionIndex}
                                    className={`rounded-lg border px-3 py-2 text-xs ${
                                        isCorrectOption
                                            ? "border-green-500/40 bg-green-500/10 text-green-300"
                                            : isSelected
                                                ? "border-red-500/40 bg-red-500/10 text-red-300"
                                                : "border-slate-800 bg-slate-950 text-slate-400"
                                    }`}
                                >
                                    {optionText}
                                    {isCorrectOption && " ✓"}
                                    {isSelected && !isCorrectOption && " (your answer)"}
                                </div>
                            );
                        })}
                    </div>

                    {q.explanation && (
                        <p className="text-xs text-slate-400 leading-relaxed">
                            <span className="font-semibold text-slate-300">Explanation: </span>
                            {q.explanation}
                        </p>
                    )}
                </Card>
            ))}
        </div>
    );
}
