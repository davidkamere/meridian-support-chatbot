"use client";

import { FormEvent, useMemo, useState } from "react";
import { ChatMessage } from "@/components/chat-message";
import { Composer } from "@/components/composer";
import { EmptyState } from "@/components/empty-state";
import { INITIAL_MESSAGES } from "@/lib/constants";
import type { ChatApiResponse, ChatTurn, Message, VerifiedSession } from "@/lib/types";

const HISTORY_LIMIT = 8;

export function ChatShell() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [verifiedSession, setVerifiedSession] = useState<VerifiedSession | null>(null);

  const hasConversation = useMemo(() => messages.length > INITIAL_MESSAGES.length, [messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) {
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: buildHistory(messages),
          verifiedSession,
        }),
      });

      const payload = (await response.json()) as ChatApiResponse;
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: payload.message,
        products: payload.products,
      };

      if (payload.verifiedSession) {
        setVerifiedSession(payload.verifiedSession);
      }

      setMessages((current) => [...current, assistantMessage]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "I couldn’t reach Meridian’s catalog service just now. Please try again in a moment.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <main className="page-shell">
      <div className="app-frame app-frame-single">
        <section className="chat-panel">
          <div className="chat-header">
            <div>
              <h1 className="chat-title">Meridian Catalog Assistant</h1>
              {verifiedSession ? (
                <p className="chat-subtitle">Verified for {verifiedSession.email}</p>
              ) : null}
            </div>
          </div>

          <div className="message-scroll">
            {messages.length === INITIAL_MESSAGES.length ? <EmptyState /> : null}
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {isLoading ? (
              <div className="message-bubble message-assistant">
                <span className="message-role">assistant</span>
                <p className="message-text">Looking through Meridian’s catalog...</p>
              </div>
            ) : null}
          </div>

          <Composer
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            isLoading={isLoading}
          />
        </section>
      </div>
    </main>
  );
}

function buildHistory(messages: Message[]): ChatTurn[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-HISTORY_LIMIT)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}
