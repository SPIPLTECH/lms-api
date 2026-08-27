"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Sparkles,
  X,
  Plus,
  Send,
  Loader2,
  MessageSquare,
  ChevronLeft,
  AlertCircle,
  RefreshCw,
  User,
  Bot,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  useMentorConversations,
  useMentorMessages,
  useCreateMentorConversation,
} from "@/hooks/queries/mentor/useMentorQueries";
import { streamMentorMessage } from "@/services/mentor.service";
import { MENTOR_ROLE_SUGGESTIONS } from "@/constants/mentorSuggestions";
import { QUERY_KEYS } from "@/constants/queryKeys";
import MentorMarkdown from "./MentorMarkdown";
import {
  MENTOR_DEFAULT_TITLE,
  deriveConversationTitle,
  getConversationDisplayTitle,
  groupConversationsByRecency,
  loadTitleOverrides,
  saveTitleOverrides,
} from "@/utils/mentorConversation";

export default function MentorWindow({ isOpen, onClose, activeConvId, setActiveConvId }) {
  const { user } = useAuth();
  const userRole = user?.role || "STUDENT";

  const queryClient = useQueryClient();
  const { data: conversations = [], isLoading: isLoadingConvs } = useMentorConversations({ enabled: isOpen });
  const createConvMutation = useCreateMentorConversation();

  const [showSidebar, setShowSidebar] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [errorMessage, setErrorMessage] = useState(null);
  const [retryPayload, setRetryPayload] = useState(null);
  // Locally-derived titles for conversations whose backend title is still the
  // generic default (see src/utils/mentorConversation.js for why).
  const [titleOverrides, setTitleOverrides] = useState(() => loadTitleOverrides());

  const messagesEndRef = useRef(null);
  const abortControllerRef = useRef(null);

  const { data: messages = [], isLoading: isLoadingMessages } = useMentorMessages(activeConvId);

  const { today: todayConversations, previous: previousConversations } = useMemo(
    () => groupConversationsByRecency(conversations),
    [conversations]
  );

  // Restore the active conversation when the Mentor opens: keep it if one is
  // already set, otherwise fall back to the most recent conversation.
  useEffect(() => {
    if (!isOpen) return;
    if (!activeConvId && conversations.length > 0) {
      setActiveConvId(conversations[0].id);
    }
  }, [isOpen, conversations, activeConvId, setActiveConvId]);

  const resetTransientState = () => {
    setErrorMessage(null);
    setRetryPayload(null);
    setStreamingText("");
  };

  const recordFirstMessageTitle = (conversationId, firstMessage) => {
    setTitleOverrides((prev) => {
      if (prev[conversationId]) return prev;
      const next = { ...prev, [conversationId]: deriveConversationTitle(firstMessage) };
      saveTitleOverrides(next);
      return next;
    });
  };

  // Scroll to bottom on message or stream update
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, isStreaming]);

  // Clean up streaming abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleCreateNewConversation = async () => {
    try {
      resetTransientState();
      const res = await createConvMutation.mutateAsync(MENTOR_DEFAULT_TITLE);
      const newConv = res.data;
      if (newConv?.id) {
        setActiveConvId(newConv.id);
        setShowSidebar(false);
      }
    } catch (err) {
      setErrorMessage("Failed to start new conversation. Please try again.");
    }
  };

  const handleSelectConversation = (conversationId) => {
    setShowSidebar(false);
    if (conversationId === activeConvId) return;
    resetTransientState();
    setActiveConvId(conversationId);
  };

  const handleSend = async (customPrompt) => {
    const textToSend = (customPrompt || inputText).trim();
    if (!textToSend || isStreaming) return;

    // Capture before any conversation is created/switched: true whenever
    // this send will be the first message of its conversation, whether that
    // conversation is brand new or was pre-created via "+".
    const isFirstMessage = messages.length === 0;

    setErrorMessage(null);
    setRetryPayload(null);
    setInputText("");

    let currentConvId = activeConvId;

    // Ensure an active conversation exists
    if (!currentConvId) {
      try {
        const newRes = await createConvMutation.mutateAsync(MENTOR_DEFAULT_TITLE);
        currentConvId = newRes.data?.id;
        if (!currentConvId) {
          throw new Error("Could not create conversation");
        }
        setActiveConvId(currentConvId);
      } catch (err) {
        setErrorMessage("Could not initialize conversation. Please try again.");
        setInputText(textToSend);
        return;
      }
    }

    if (isFirstMessage) {
      recordFirstMessageTitle(currentConvId, textToSend);
    }

    // Prepare streaming state
    setIsStreaming(true);
    setStreamingText("");
    setRetryPayload(textToSend);

    // Create abort controller for client disconnects
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Optimistically update message cache with user message
    queryClient.setQueryData(
      [QUERY_KEYS.MENTOR_MESSAGES, currentConvId],
      (old = []) => [
        ...old,
        { id: `temp-user-${Date.now()}`, role: "USER", content: textToSend, createdAt: new Date().toISOString() },
      ]
    );

    try {
      await streamMentorMessage({
        conversationId: currentConvId,
        content: textToSend,
        onChunk: (token) => {
          setStreamingText((prev) => prev + token);
        },
        signal: abortController.signal,
      });

      // Refetch messages and invalidate conversations to sync DB state
      await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.MENTOR_MESSAGES, currentConvId] });
      await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.MENTOR_CONVERSATIONS] });

      setStreamingText("");
      setRetryPayload(null);
    } catch (err) {
      if (err.name === "AbortError") {
        console.log("Stream cancelled by user disconnect.");
      } else {
        setErrorMessage(err.message || "Failed to receive response. Click retry to try again.");
        setInputText(textToSend); // preserve user text for retry
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const suggestions = MENTOR_ROLE_SUGGESTIONS[userRole] || MENTOR_ROLE_SUGGESTIONS.STUDENT;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.25 }}
        className="
          fixed
          bottom-0
          right-0
          sm:bottom-6
          sm:right-6
          z-[9999]
          flex
          h-[100dvh]
          w-full
          sm:h-[650px]
          sm:w-[480px]
          flex-col
          rounded-none
          sm:rounded-2xl
          border
          border-slate-800/80
          bg-slate-950/95
          backdrop-blur-xl
          shadow-[0_20px_60px_rgba(0,0,0,0.8)]
          overflow-hidden
        "
      >
        {/* Top Glow Accent Bar */}
        <div className="h-[3px] bg-gradient-to-r from-indigo-500 via-purple-500 to-amber-500 w-full" />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3 bg-slate-900/60">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              title="Toggle History"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md">
                <Sparkles className="h-4 w-4 text-amber-200" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  AI Mentor
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {userRole}
                  </span>
                </h3>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleCreateNewConversation}
              disabled={createConvMutation.isPending || isStreaming}
              title="New Conversation"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              title="Close"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Main Content Body */}
        <div className="relative flex flex-1 overflow-hidden">
          {/* Conversation History Drawer / Sidebar */}
          <AnimatePresence>
            {showSidebar && (
              <motion.div
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ duration: 0.2 }}
                className="absolute inset-y-0 left-0 z-20 w-64 border-r border-slate-800 bg-slate-900/95 p-3 backdrop-blur-lg flex flex-col"
              >
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
                  <span className="text-xs font-semibold text-slate-300">History</span>
                  <button
                    onClick={() => setShowSidebar(false)}
                    className="text-slate-400 hover:text-white text-xs"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </div>

                <button
                  onClick={handleCreateNewConversation}
                  disabled={isStreaming}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 mb-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs font-medium hover:opacity-90 transition-opacity"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Chat
                </button>

                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  {isLoadingConvs ? (
                    <div className="flex justify-center p-4">
                      <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                    </div>
                  ) : conversations.length === 0 ? (
                    <p className="text-[11px] text-slate-500 text-center py-4">No previous chats</p>
                  ) : (
                    <>
                      {todayConversations.length > 0 && (
                        <div className="mb-3">
                          <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            Today
                          </p>
                          <div className="space-y-1.5">
                            {todayConversations.map((c) => (
                              <ConversationHistoryItem
                                key={c.id}
                                conversation={c}
                                isActive={activeConvId === c.id}
                                title={getConversationDisplayTitle(c, titleOverrides)}
                                onSelect={handleSelectConversation}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      {previousConversations.length > 0 && (
                        <div>
                          <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            Previous
                          </p>
                          <div className="space-y-1.5">
                            {previousConversations.map((c) => (
                              <ConversationHistoryItem
                                key={c.id}
                                conversation={c}
                                isActive={activeConvId === c.id}
                                title={getConversationDisplayTitle(c, titleOverrides)}
                                onSelect={handleSelectConversation}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Messages Area */}
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/40">
            {/* Scrollable Message List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {isLoadingMessages && messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 text-xs gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
                  Loading mentor session...
                </div>
              ) : messages.length === 0 && !streamingText ? (
                /* Empty state with prompt suggestions */
                <div className="flex flex-col items-center justify-center h-full text-center p-4">
                  <div className="h-12 w-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-3">
                    <Sparkles className="h-6 w-6 text-indigo-400" />
                  </div>
                  <h4 className="text-sm font-semibold text-slate-200 mb-1">
                    How can I assist your learning today?
                  </h4>
                  <p className="text-xs text-slate-400 max-w-xs mb-6">
                    Ask me questions about your course, learning progress, or quiz results.
                  </p>

                  <div className="w-full space-y-2 max-w-sm">
                    {suggestions.map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSend(item.prompt)}
                        className="w-full text-left p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 text-xs text-slate-300 hover:border-indigo-500/50 hover:text-white hover:bg-slate-800/80 transition-all flex items-center justify-between group"
                      >
                        <span>{item.label}</span>
                        <Sparkles className="h-3.5 w-3.5 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* Message Feed */
                <>
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex gap-2.5 ${m.role === "USER" ? "justify-end" : "justify-start"}`}
                    >
                      {m.role === "ASSISTANT" && (
                        <div className="h-7 w-7 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center shrink-0 mt-0.5">
                          <Bot className="h-4 w-4 text-indigo-300" />
                        </div>
                      )}
                      <div
                        className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${
                          m.role === "USER"
                            ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-br-none shadow-md shadow-indigo-600/10"
                            : "bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none"
                        }`}
                      >
                        {m.role === "ASSISTANT" ? (
                          <MentorMarkdown content={m.content} />
                        ) : (
                          <p className="whitespace-pre-wrap">{m.content}</p>
                        )}
                      </div>
                      {m.role === "USER" && (
                        <div className="h-7 w-7 rounded-lg bg-purple-600/30 border border-purple-500/40 flex items-center justify-center shrink-0 mt-0.5">
                          <User className="h-4 w-4 text-purple-300" />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Active SSE Streaming Output */}
                  {isStreaming && streamingText && (
                    <div className="flex gap-2.5 justify-start">
                      <div className="h-7 w-7 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="h-4 w-4 text-indigo-300 animate-pulse" />
                      </div>
                      <div className="max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none">
                        <MentorMarkdown content={streamingText} />
                      </div>
                    </div>
                  )}

                  {/* Typing Indicator */}
                  {isStreaming && !streamingText && (
                    <div className="flex gap-2.5 justify-start items-center">
                      <div className="h-7 w-7 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center shrink-0">
                        <Bot className="h-4 w-4 text-indigo-300 animate-spin" />
                      </div>
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl px-3 py-2 text-xs text-slate-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Error Notification Banner with Retry */}
            {errorMessage && (
              <div className="px-4 py-2 bg-red-500/10 border-t border-b border-red-500/20 flex items-center justify-between text-xs text-red-300">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="truncate">{errorMessage}</span>
                </div>
                {retryPayload && (
                  <button
                    onClick={() => handleSend(retryPayload)}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-200 text-[11px] font-medium transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry
                  </button>
                )}
              </div>
            )}

            {/* Input Bar */}
            <div className="p-3 border-t border-slate-800/80 bg-slate-900/60">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={isStreaming}
                  placeholder="Ask AI Mentor..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 disabled:opacity-50 transition-colors"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim() || isStreaming}
                  className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-md hover:opacity-90 disabled:opacity-40 transition-all shrink-0"
                >
                  {isStreaming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function ConversationHistoryItem({ conversation, isActive, title, onSelect }) {
  return (
    <button
      onClick={() => onSelect(conversation.id)}
      className={`w-full text-left p-2.5 rounded-xl text-xs transition-colors truncate ${
        isActive
          ? "bg-indigo-600/30 text-indigo-200 border border-indigo-500/40"
          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
      }`}
    >
      <p className="font-medium truncate">{title}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">
        {new Date(conversation.lastMessageAt || conversation.createdAt).toLocaleDateString()}
      </p>
    </button>
  );
}
