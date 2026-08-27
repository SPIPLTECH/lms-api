"use client";

import { Component } from "react";
import Markdown from "markdown-to-jsx";

/**
 * Renders AI Mentor assistant messages as Markdown.
 *
 * `disableParsingRawHTML` is the load-bearing security setting here: it stops
 * markdown-to-jsx from transcribing any raw HTML found in the LLM output into
 * real DOM nodes (e.g. <script>, <img onerror>), which is what would otherwise
 * let a prompt-injected response execute in the browser. Everything the LLM
 * writes is treated as literal Markdown/text, never as HTML.
 */
const MARKDOWN_OPTIONS = {
  disableParsingRawHTML: true,
  overrides: {
    h1: { component: "h3", props: { className: "text-sm font-semibold text-white mt-3 mb-1.5 first:mt-0" } },
    h2: { component: "h3", props: { className: "text-sm font-semibold text-white mt-3 mb-1.5 first:mt-0" } },
    h3: { component: "h3", props: { className: "text-xs font-semibold text-white mt-3 mb-1.5 first:mt-0" } },
    h4: { component: "h4", props: { className: "text-xs font-semibold text-slate-200 mt-2 mb-1 first:mt-0" } },
    p: { component: "p", props: { className: "mb-2 last:mb-0 leading-relaxed" } },
    strong: { component: "strong", props: { className: "font-semibold text-white" } },
    em: { component: "em", props: { className: "italic" } },
    ul: { component: "ul", props: { className: "list-disc pl-4 mb-2 last:mb-0 space-y-0.5" } },
    ol: { component: "ol", props: { className: "list-decimal pl-4 mb-2 last:mb-0 space-y-0.5" } },
    li: { component: "li", props: { className: "leading-relaxed" } },
    a: {
      component: "a",
      props: { className: "text-indigo-400 underline hover:text-indigo-300", target: "_blank", rel: "noopener noreferrer" },
    },
    code: { component: "code", props: { className: "bg-slate-800 rounded px-1 py-0.5 text-[11px] font-mono text-indigo-300 break-words" } },
    pre: {
      component: "pre",
      props: { className: "bg-slate-950 border border-slate-800 rounded-lg p-2 mb-2 last:mb-0 overflow-x-auto text-[11px] font-mono" },
    },
    blockquote: {
      component: "blockquote",
      props: { className: "border-l-2 border-slate-700 pl-2 mb-2 last:mb-0 italic text-slate-400" },
    },
    hr: { component: "hr", props: { className: "border-slate-800 my-2" } },
    table: { component: "table", props: { className: "w-full text-[11px] border-collapse mb-2 last:mb-0" } },
    th: { component: "th", props: { className: "border border-slate-800 px-1.5 py-1 text-left bg-slate-900" } },
    td: { component: "td", props: { className: "border border-slate-800 px-1.5 py-1" } },
  },
};

// Guards against a mid-stream chunk boundary producing markdown the compiler
// can't parse; falls back to plain text for just that render instead of
// crashing the whole message list.
class MarkdownErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.content !== this.props.content) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return <p className="whitespace-pre-wrap">{this.props.content}</p>;
    }
    return this.props.children;
  }
}

export default function MentorMarkdown({ content }) {
  const text = content || "";
  return (
    <MarkdownErrorBoundary content={text}>
      <Markdown options={MARKDOWN_OPTIONS}>{text}</Markdown>
    </MarkdownErrorBoundary>
  );
}
