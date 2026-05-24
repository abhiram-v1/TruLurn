'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { ContextBadge } from '@/components/ui/ContextBadge'
import type { DoubtMessage } from '@/types'

export function DoubtChat({
  topicId,
  topicTitle,
  pageNumber,
  initialMessages,
}: {
  topicId: string
  topicTitle: string
  pageNumber: number
  initialMessages: DoubtMessage[]
}) {
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isSending])

  // Sync state if initialMessages changes
  useEffect(() => {
    setMessages(initialMessages)
  }, [initialMessages])

  // Auto-resize textarea
  function handleDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  // Submit on Enter (Shift+Enter = newline)
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitDoubt()
    }
  }

  async function submitDoubt(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault()
    const question = draft.trim()
    if (!question || isSending) return

    const userMessage: DoubtMessage = {
      id: `user-${Date.now()}`,
      topic_id: topicId,
      page_number: pageNumber,
      role: 'user',
      content: question,
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, userMessage])
    setDraft('')
    setIsSending(true)

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    try {
      const response = await fetch('/api/chat/doubt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicId,
          pageNumber,
          question,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to resolve doubt.')
      }

      const assistantMessage: DoubtMessage = {
        id: data.id || `assistant-${Date.now()}`,
        topic_id: topicId,
        page_number: pageNumber,
        role: 'assistant',
        content: data.content,
        created_at: new Date().toISOString(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      console.error(err)
      const errorMessage: DoubtMessage = {
        id: `error-${Date.now()}`,
        topic_id: topicId,
        page_number: pageNumber,
        role: 'assistant',
        content: 'I encountered an error trying to resolve your doubt. Please try again.',
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="chat-box">
      {/* Header */}
      <div className="chat-header">
        <span className="panel-label">Doubts</span>
        <ContextBadge topicTitle={topicTitle} pageNumber={pageNumber} />
      </div>

      {/* Messages */}
      <div className="messages">
        <div className="message system">
          Ask anything about this topic. I stay scoped to it.
        </div>
        {messages.map((msg) => (
          <div className={`message ${msg.role}`} key={msg.id}>
            {msg.content}
          </div>
        ))}
        {isSending && (
          <div className="message assistant typing" style={{ opacity: 0.6 }}>
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input — compact, Enter to send */}
      <form className="chat-form" onSubmit={submitDoubt}>
        <textarea
          ref={textareaRef}
          aria-label="Ask a doubt"
          placeholder="Ask a doubt…"
          rows={1}
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={handleKeyDown}
        />
        <button
          className="chat-submit button-subtle"
          type="submit"
          aria-label="Send"
          disabled={!draft.trim()}
        >
          ↵
        </button>
      </form>
    </div>
  )
}
