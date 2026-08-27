"use client";

import { useState } from "react";
import MentorButton from "./MentorButton";
import MentorWindow from "./MentorWindow";

export default function MentorWidget() {
  const [isOpen, setIsOpen] = useState(false);
  // Lifted here (rather than inside MentorWindow) so the active conversation
  // survives closing/reopening the drawer regardless of how MentorWindow is
  // mounted.
  const [activeConvId, setActiveConvId] = useState(null);

  return (
    <>
      <MentorButton isOpen={isOpen} onToggle={() => setIsOpen(true)} />
      <MentorWindow
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        activeConvId={activeConvId}
        setActiveConvId={setActiveConvId}
      />
    </>
  );
}
