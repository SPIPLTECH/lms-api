"use client";

import { useState } from "react";
import { Lightbulb, Send, CheckCircle2 } from "lucide-react";

import Loader from "@/components/common/Loader";
import EmptyState from "@/components/ui/EmptyState";
import RecommendationCard from "@/components/instructor/insights/RecommendationCard";
import { useTeachingSuggestions } from "@/hooks/queries/instructor/useTeacherInsights";

export default function InstructorSuggestionsPage() {
  const { recommendations, isLoading, isError } = useTeachingSuggestions();
  const [feedback, setFeedback] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmitFeedback = (e) => {
    e.preventDefault();
    if (!feedback.trim()) return;
    // No platform-team inbox exists yet for this — routed to support the same
    // way the rest of the app does, until a dedicated endpoint is built.
    window.location.href = `mailto:support@orangetree.com?subject=${encodeURIComponent(
      "Course improvement suggestion"
    )}&body=${encodeURIComponent(feedback)}`;
    setSent(true);
    setFeedback("");
    setTimeout(() => setSent(false), 4000);
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20 flex items-center justify-center">
            <Lightbulb size={18} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight leading-none">Suggestions</h1>
            <p className="text-xs text-slate-400 mt-1.5">
              Content-gap ideas surfaced from student activity across your courses.
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <Loader />
      ) : isError ? (
        <EmptyState
          icon={Lightbulb}
          title="Couldn't load suggestions"
          description="Please refresh the page or try again later."
        />
      ) : recommendations.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No content-gap suggestions right now"
          description="Nothing stands out yet — check back once your courses have more student activity to analyze."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {recommendations.map((rec) => (
            <RecommendationCard key={rec.id} recommendation={rec} />
          ))}
        </div>
      )}

      {/* Submit a suggestion to the platform team */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm space-y-3">
        <h3 className="text-sm font-bold text-white">Have your own suggestion?</h3>
        <p className="text-xs text-slate-400">Send it directly to the platform team.</p>

        {sent && (
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
            <CheckCircle2 size={14} />
            <span>Thanks — your suggestion is on its way.</span>
          </div>
        )}

        <form onSubmit={handleSubmitFeedback} className="flex flex-col sm:flex-row gap-3">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="e.g. It would help to see per-lesson drop-off rates..."
            className="flex-1 resize-none rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-orange-500 transition"
          />
          <button
            type="submit"
            disabled={!feedback.trim()}
            className="flex items-center justify-center gap-2 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-slate-950 font-black text-xs px-5 py-2.5 transition active:scale-95"
          >
            <Send size={13} />
            <span>Send</span>
          </button>
        </form>
      </div>
    </div>
  );
}
