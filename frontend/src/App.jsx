import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const markdownComponents = {
  p: ({ children }) => <p className="mb-2 leading-7">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-bold text-white">{children}</strong>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  table: ({ children }) => (
    <div className="my-4 w-full overflow-x-auto rounded-lg border border-gray-600">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-700">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-gray-600 px-3 py-2 font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-gray-600 px-3 py-2 align-top">{children}</td>
  ),
  br: () => <br />,
};

function App() {
  const [file, setFile] = useState(null);
  const [uploaded, setUploaded] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [conversationId, setConversationId] = useState(
    () => localStorage.getItem("ai_portfolio_conversation_id") || "default"
  );
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;

    async function loadChatHistory() {
      try {
        const response = await fetch(
          `${API_URL}/chat/history/${encodeURIComponent(conversationId)}`
        );

        if (!response.ok) {
          if (!cancelled && response.status !== 400) {
            setError("Could not load chat history. Check the backend.");
          }
          return;
        }

        const data = await response.json();
        if (cancelled) return;

        setMessages(
          (data.messages || []).map((message) => ({
            role: message.role,
            text: message.content,
          }))
        );
        setUploaded(true);
        setError("");
      } catch (err) {
        if (!cancelled) {
          console.error("Could not load chat history:", err);
        }
      }
    }

    loadChatHistory();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function handleUpload() {
    if (!file) {
      setError("Please choose a PDF or DOCX file first.");
      return;
    }

    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_URL}/upload/resume`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Resume upload failed.");
      }

      // Start a fresh conversation for the newly uploaded resume.
      const newId = crypto.randomUUID();
      localStorage.setItem("ai_portfolio_conversation_id", newId);
      setConversationId(newId);
      setUploaded(true);
      setMessages([
        {
          role: "assistant",
          text: `Resume uploaded successfully! Candidate: ${
            data.profile?.name || "Candidate"
          }. You can now ask questions.`,
        },
      ]);
    } catch (err) {
      setError(err.message || "Could not connect to the backend.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSend(event, suggestedQuestion = null) {
    event?.preventDefault();

    const text = (suggestedQuestion ?? question).trim();
    if (!text || !uploaded || sending) return;

    const previousMessages = messages;

    setSending(true);
    setError("");
    setQuestion("");

    setMessages((previous) => [
      ...previous,
      { role: "user", text },
      { role: "assistant", text: "" },
    ]);

    try {
      const response = await fetch(`${API_URL}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          conversation_id: conversationId,
          history: previousMessages.map((message) => ({
            role: message.role,
            content: message.text,
          })),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Chat request failed.");
      }

      if (!response.body) {
        throw new Error("Streaming is not supported by this response.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      function updateAssistantMessage(chunkText) {
        setMessages((previous) => {
          const updated = [...previous];
          const last = updated.length - 1;

          if (last >= 0 && updated[last].role === "assistant") {
            updated[last] = {
              ...updated[last],
              text: updated[last].text + chunkText,
            };
          }

          return updated;
        });
      }

      function processLine(line) {
        if (!line.trim()) return;
        const chunk = JSON.parse(line);

        if (chunk.error) {
          throw new Error(chunk.error);
        }

        if (chunk.text) {
          updateAssistantMessage(chunk.text);
        }
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          processLine(line);
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        processLine(buffer);
      }
    } catch (err) {
      setError(err.message || "Could not connect to the backend.");
      setMessages((previous) => {
        const last = previous[previous.length - 1];
        if (last?.role === "assistant" && !last.text) {
          return previous.slice(0, -2);
        }
        return previous;
      });
    } finally {
      setSending(false);
    }
  }

  function handleFileChange(event) {
    const selectedFile = event.target.files?.[0] || null;
    setFile(selectedFile);
    setUploaded(false);
    setMessages([]);
    setError("");
  }

  function handleNewChat() {
    if (sending || uploading) return;

    const newId = crypto.randomUUID();
    localStorage.setItem("ai_portfolio_conversation_id", newId);
    setConversationId(newId);
    setMessages([]);
    setQuestion("");
    setError("");
  }

  async function handleLoadHistory() {
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/chat/history/${encodeURIComponent(conversationId)}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not load chat history.");
      }

      setMessages(
        (data.messages || []).map((message) => ({
          role: message.role,
          text: message.content,
        }))
      );
      setUploaded(true);
    } catch (err) {
      setError(err.message || "Could not load chat history.");
    }
  }

  return (
    <div className="h-screen overflow-hidden bg-[#080b19] text-slate-100">
      <div className="flex h-full min-h-0">
        {/* Sidebar */}
        <aside className="hidden h-full w-[285px] shrink-0 flex-col overflow-y-auto border-r border-indigo-950 bg-[#0b1020] p-6 md:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-700 text-lg font-black shadow-lg shadow-indigo-600/30">
              AI
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                AI <span className="text-indigo-400">Portfolio</span>
              </h1>
              <p className="mt-1 text-xs text-slate-400">Your resume, powered by AI</p>
            </div>
          </div>

          <div className="mt-9">
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Workspace
            </p>

            <button
              type="button"
              onClick={handleNewChat}
              disabled={sending || uploading}
              className="flex w-full items-center gap-3 rounded-xl border border-indigo-400/20 bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-left font-medium shadow-lg shadow-indigo-950/40 transition hover:brightness-110 disabled:opacity-40"
            >
              <span>＋</span>
              New Chat
            </button>

            <a
              href="#resume-upload"
              className="mt-2 flex items-center gap-3 rounded-xl px-4 py-3 text-slate-300 transition hover:bg-slate-800/70 hover:text-white"
            >
              <span>↥</span>
              Upload Resume
            </a>

            <button
              type="button"
              onClick={handleLoadHistory}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-slate-300 transition hover:bg-slate-800/70 hover:text-white"
            >
              <span>◷</span>
              Current Chat History
            </button>
          </div>

          {/* Resume upload card */}
          <div
            id="resume-upload"
            className="mt-9 rounded-2xl border border-indigo-400/20 bg-gradient-to-b from-indigo-950/60 to-slate-900/70 p-4"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/25 text-xl">
                ▤
              </div>
              <div>
                <h2 className="text-sm font-semibold">Resume Upload</h2>
                <p className="mt-1 text-xs text-slate-400">PDF or DOCX</p>
              </div>
            </div>

            <label
              htmlFor="resume-file"
              className="mt-4 block cursor-pointer rounded-xl border border-dashed border-indigo-400/40 bg-slate-950/50 p-5 text-center transition hover:border-indigo-300 hover:bg-indigo-950/40"
            >
              <span className="text-2xl text-indigo-300">↥</span>
              <span className="mt-2 block text-sm text-slate-300">Choose a resume</span>
              <span className="mt-1 block text-xs text-slate-500">Select PDF or DOCX</span>
              <input
                id="resume-file"
                type="file"
                accept=".pdf,.docx"
                onChange={handleFileChange}
                className="mt-3 block w-full text-xs text-slate-400 file:mr-2 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:font-medium file:text-white"
              />
            </label>

            <p className="mt-3 break-all text-xs text-slate-400">
              {file ? file.name : "No file selected"}
            </p>

            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || !file}
              className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uploading ? "Uploading..." : "Upload Resume"}
            </button>

            {uploaded && (
              <p className="mt-3 text-xs text-emerald-400">✓ Resume ready for chat</p>
            )}
          </div>

          <div className="mt-auto flex items-center gap-3 border-t border-slate-800 pt-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 font-bold">
              AI
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">Candidate Workspace</p>
              <p className="mt-1 text-xs text-slate-500">Resume assistant</p>
            </div>
            <span className="ml-auto h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </div>
        </aside>

        {/* Main workspace */}
        <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col p-3 sm:p-5 lg:p-7">
          <header className="flex shrink-0 items-center justify-between gap-3 px-2 pb-5 sm:px-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                Candidate Workspace
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Ask about skills, projects and experience.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-4 py-2 sm:flex">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-medium text-emerald-300">AI Assistant</span>
              </span>
              <button
                type="button"
                onClick={handleNewChat}
                disabled={sending || uploading}
                className="rounded-xl border border-indigo-400/30 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-indigo-500/10 disabled:opacity-40 md:hidden"
              >
                + New
              </button>
            </div>
          </header>

          {/* Chat panel */}
          <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-indigo-400/15 bg-[#0d1225] shadow-2xl shadow-indigo-950/20">
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-indigo-700/20 via-violet-800/5 to-transparent" />

            <div className="relative flex shrink-0 items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-4 sm:px-7">
              <div>
                <h3 className="font-semibold">Resume Conversation</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Answers grounded in the uploaded profile
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-400">
                  {messages.length} messages
                </span>
                <button
                  type="button"
                  onClick={handleNewChat}
                  disabled={sending || uploading}
                  className="hidden rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-40 sm:inline-flex"
                >
                  + New Chat
                </button>
              </div>
            </div>

            {/* Only this message area scrolls */}
            <div className="relative min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-7">
              {messages.length === 0 && (
                <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center sm:py-24">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/30 to-violet-600/20 text-3xl text-indigo-300 ring-1 ring-indigo-400/30">
                    ✧
                  </div>
                  <h3 className="mt-6 text-xl font-semibold">Your resume, ready to talk</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    Upload your resume, then ask questions about your projects, skills,
                    education and experience.
                  </p>
                  {!uploaded && (
                    <a
                      href="#resume-upload"
                      className="mt-6 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold transition hover:bg-indigo-500 md:hidden"
                    >
                      Go to resume upload
                    </a>
                  )}
                  {uploaded && (
                    <p className="mt-4 text-xs text-slate-500">
                      Start a new conversation or choose a suggested question below.
                    </p>
                  )}
                </div>
              )}

              {messages.map((message, index) => (
                <div
                  key={`${conversationId}-${index}`}
                  className={`flex items-start gap-3 ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {message.role !== "user" && (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-700 text-lg shadow-lg shadow-indigo-950/40">
                      ✧
                    </div>
                  )}

                  <div
                    className={`max-w-[88%] min-w-0 break-words rounded-2xl px-4 py-3.5 text-sm leading-7 sm:max-w-[75%] ${
                      message.role === "user"
                        ? "whitespace-pre-wrap rounded-br-md bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-950/30"
                        : "rounded-tl-md border border-indigo-400/10 bg-slate-800/70 text-slate-200"
                    }`}
                  >
                    {message.role === "user" ? (
                      message.text
                    ) : (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {message.text}
                      </ReactMarkdown>
                    )}
                  </div>
                </div>
              ))}

              {sending && (
                <div className="flex items-center gap-3 text-sm text-slate-400">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-300">
                    ✧
                  </div>
                  <div className="rounded-full border border-slate-700 bg-slate-900 px-4 py-3">
                    <span className="mr-2 animate-pulse text-indigo-400">● ● ●</span>
                    AI is thinking...
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {uploaded && (
              <div className="relative z-10 shrink-0 px-4 pt-3 sm:px-7">
                <p className="mb-2 text-xs text-slate-400">Try asking</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    "Summarize my resume",
                    "What are my top skills?",
                    "Explain my projects",
                    "What skills should I improve?",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => handleSend(null, suggestion)}
                      disabled={!uploaded || sending}
                      className="rounded-full border border-indigo-400/30 bg-slate-900 px-3 py-2 text-xs text-slate-300 transition hover:border-indigo-400 hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <p className="relative z-10 mx-4 mb-3 mt-2 shrink-0 rounded-xl border border-red-500/20 bg-red-950/40 p-3 text-sm text-red-300 sm:mx-7">
                {error}
              </p>
            )}

            {/* Message composer stays at the bottom */}
            <div className="relative shrink-0 border-t border-slate-800/80 bg-slate-950/30 p-4 sm:p-6">
              <form
                onSubmit={handleSend}
                className="flex items-center gap-3 rounded-2xl border border-indigo-500/40 bg-[#11172d] p-2 shadow-lg shadow-indigo-950/30 transition focus-within:border-indigo-400 focus-within:shadow-indigo-900/20"
              >
                <span className="hidden pl-2 text-xl text-slate-500 sm:inline">↗</span>
                <input
                  type="text"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder={
                    uploaded
                      ? "Ask anything about your resume..."
                      : "Upload a resume to start chatting..."
                  }
                  disabled={!uploaded || sending}
                  className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm text-white outline-none placeholder:text-slate-500 disabled:cursor-not-allowed"
                />
                <button
                  type="submit"
                  disabled={!uploaded || sending || !question.trim()}
                  aria-label="Send message"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-lg text-white shadow-lg shadow-indigo-950/50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ➤
                </button>
              </form>
              <p className="mt-3 text-center text-xs text-slate-500">
                AI responses are based on the candidate profile provided.
              </p>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
