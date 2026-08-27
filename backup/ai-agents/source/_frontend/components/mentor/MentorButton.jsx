"use client";

import { Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export default function MentorButton({ isOpen, onToggle }) {
  return (
    <AnimatePresence>
      {!isOpen && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          onClick={onToggle}
          title="AI Mentor"
          className="
            fixed
            bottom-6
            right-6
            sm:bottom-6
            sm:right-6
            z-[9998]
            flex
            h-14
            w-14
            sm:h-16
            sm:w-16
            items-center
            justify-center
            rounded-full
            bg-gradient-to-br
            from-indigo-600
            via-purple-600
            to-pink-600
            text-white
            shadow-[0_15px_35px_rgba(99,102,241,0.45)]
            border
            border-indigo-400/30
          "
        >
          <Sparkles className="h-7 w-7 text-amber-200 animate-pulse" />
          <span className="sr-only">Open AI Mentor</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
