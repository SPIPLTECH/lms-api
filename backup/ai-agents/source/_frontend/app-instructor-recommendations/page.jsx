"use client";

import { Sparkles } from "lucide-react";

import Loader from "@/components/common/Loader";
import EmptyState from "@/components/ui/EmptyState";
import RecommendationCard from "@/components/instructor/insights/RecommendationCard";
import { useInstructorActionRecommendations } from "@/hooks/queries/instructor/useTeacherInsights";

export default function InstructorRecommendationsPage() {
  const { recommendations, isLoading, isError } = useInstructorActionRecommendations();

  return (
    <div className="space-y-6 pb-12">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20 flex items-center justify-center">
            <Sparkles size={18} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight leading-none">Recommendations</h1>
            <p className="text-xs text-slate-400 mt-1.5">
              Data-driven calls to action across your courses, ranked by urgency and student impact.
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <Loader />
      ) : isError ? (
        <EmptyState
          icon={Sparkles}
          title="Couldn't load recommendations"
          description="Please refresh the page or try again later."
        />
      ) : recommendations.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No recommendations right now"
          description="You're all caught up — check back once your courses have more student activity to analyze."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {recommendations.map((rec) => (
            <RecommendationCard key={rec.id} recommendation={rec} />
          ))}
        </div>
      )}
    </div>
  );
}
