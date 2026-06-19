'use client'

import {
  IconArrowsHorizontal,
  IconCodeDots,
  IconPlayerStop,
  IconSend,
  IconX,
} from '@tabler/icons-react'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ContextBadge } from '@/components/ui/ContextBadge'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import type { DoubtMessage } from '@/types'
import type { UIAction } from '@/types/agent'

export function DoubtChat({
  courseId,
  topicId,
  topicTitle,
  pageNumber,
  globalPageNumber,
  initialMessages,
  expanded = false,
  onExpandedChange,
  draftSeed,
  selectedContext,
  onClearSelectedContext,
  onRegenerate,
  onGenerateCustomPage,
}: {
  courseId: string
  topicId: string
  topicTitle: string
  pageNumber: number
  globalPageNumber?: number
  initialMessages: DoubtMessage[]
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  draftSeed?: {
    id: number
    value: string
  } | null
  selectedContext?: {
    id: number
    text: string
  } | null
  onClearSelectedContext?: () => void
  onRegenerate?: (approach?: string) => void
  onGenerateCustomPage?: (instruction: string, targetPageNumber: number) => void
}) {
  const router = useRouter()
  const [messages, setMessages] = useState<DoubtMessage[]>(initialMessages || [])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [localContextByMessageId, setLocalContextByMessageId] = useState<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isSending])

  useEffect(() => {
    let active = true
    async function loadHistory() {
      if (initialMessages && initialMessages.length > 0) {
        setMessages(initialMessages)
        return
      }
      setLoadingHistory(true)
      try {
        const res = await fetch(`/api/agent/message?courseId=${encodeURIComponent(courseId)}`)
        if (!res.ok) throw new Error('Failed to load chat history')
        const data = await res.json()
        if (active && data.messages) {
          setMessages(data.messages)
        }
      } catch (err) {
        console.error('[DoubtChat] Failed to load chat history:', err)
      } finally {
        if (active) setLoadingHistory(false)
      }
    }
    loadHistory()

    return () => {
      active = false
    }
    // Chat history belongs to the course conversation, not the current lesson
    // page. Page context updates must not reload or reset the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  useEffect(() => {
    if (!initialMessages || initialMessages.length === 0) return
    setMessages((current) => {
      // Merge server messages with any client-only messages not yet in the DB.
      // This prevents messages from being wiped on router.refresh() — action
      // responses and their corresponding user messages are never stored to DB,
      // so a naive replace would make them disappear after a page regeneration.
      const serverIds = new Set(initialMessages.map((m) => m.id))
      const clientOnly = current.filter((m) => !serverIds.has(m.id))
      return clientOnly.length > 0
        ? [...initialMessages, ...clientOnly]
        : initialMessages
    })
  }, [initialMessages])

  useEffect(() => {
    if (!draftSeed) return

    setDraft(draftSeed.value)
    onExpandedChange?.(true)

    window.setTimeout(() => {
      const textarea = textareaRef.current
      if (!textarea) return

      textarea.focus()
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    }, 80)
  }, [draftSeed, onExpandedChange])

  useEffect(() => {
    if (!selectedContext) return

    onExpandedChange?.(true)
    window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 80)
  }, [selectedContext, onExpandedChange])

  function contextPreview(text: string, max = 96) {
    const clean = text.replace(/\s+/g, ' ').trim()
    return clean.length > max ? `${clean.slice(0, max)}...` : clean
  }

  function handleDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitMessage()
    }
  }

  function executeUIAction(action: UIAction) {
    switch (action.action) {
      case 'open_quiz':
        router.push(`/quiz/${encodeURIComponent(action.topicId)}`)
        break
      case 'next_topic':
      case 'prev_topic':
      case 'navigate_to_topic':
        router.push(`/learn/${courseId}/${encodeURIComponent(action.topicId)}`)
        break
      case 'regenerate_page':
        onRegenerate?.(action.approach)
        break
      case 'generate_custom_page':
        onGenerateCustomPage?.(action.instruction, action.targetPageNumber)
        break
    }
  }

  function stopMessage() {
    abortControllerRef.current?.abort()
  }

  async function submitMessage(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault()
    const message = draft.trim()
    if (!message || isSending) return

    const controller = new AbortController()
    abortControllerRef.current = controller

    const attachedContext = selectedContext?.text.trim() || null
    const userMessageId = `user-${Date.now()}`
    const userMessage: DoubtMessage = {
      id: userMessageId,
      topic_id: topicId,
      page_number: pageNumber,
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, userMessage])
    if (attachedContext) {
      setLocalContextByMessageId((prev) => ({ ...prev, [userMessageId]: attachedContext }))
      onClearSelectedContext?.()
    }
    setDraft('')
    setIsSending(true)

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    try {
      const response = await fetch('/api/agent/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId,
          topicId,
          pageNumber,
          message,
          selectedContext: attachedContext,
        }),
        signal: controller.signal,
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Agent failed to respond.')
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

      if (data.uiAction) {
        executeUIAction(data.uiAction)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error(err)
      const errorMessage: DoubtMessage = {
        id: `error-${Date.now()}`,
        topic_id: topicId,
        page_number: pageNumber,
        role: 'assistant',
        content: 'I encountered an error. Please try again.',
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsSending(false)
      abortControllerRef.current = null
    }
  }

  return (
    <div
      className={`chat-box ${expanded ? 'expanded' : ''}`}
      onFocusCapture={() => onExpandedChange?.(true)}
    >
      <div className="chat-header">
        <span className="panel-label">Agent</span>
        <div className="chat-header-actions">
          <ContextBadge topicTitle={topicTitle} pageNumber={pageNumber} globalPageNumber={globalPageNumber} />
          <button
            className="panel-toggle chat-expand-toggle"
            type="button"
            onClick={() => onExpandedChange?.(!expanded)}
            aria-label={expanded ? 'Reduce agent panel' : 'Expand agent panel'}
            aria-pressed={expanded}
            title={expanded ? 'Reduce agent panel' : 'Expand agent panel'}
          >
            <IconArrowsHorizontal aria-hidden="true" size={17} stroke={1.8} />
          </button>
        </div>
      </div>

      <div className="messages">
        <div className="message system">
          Ask anything, request a quiz, or say &quot;give me another page on examples&quot; or &quot;go deeper&quot;.
        </div>
        {loadingHistory && messages.length === 0 ? (
          <div className="message assistant typing" style={{ opacity: 0.6 }}>
            Loading history...
          </div>
        ) : null}
        {messages.map((msg) => (
          <div className={`message ${msg.role}`} key={msg.id}>
            {msg.topic_title && msg.topic_id !== topicId ? (
              <span className="message-context">
                {msg.topic_title}
                {msg.page_number ? ` · p${msg.page_number}` : ''}
              </span>
            ) : null}
            {msg.role === 'assistant' ? (
              <MarkdownContent className="chat-md">{msg.content}</MarkdownContent>
            ) : (
              <>
                {localContextByMessageId[msg.id] ? (
                  <span className="message-attached-context">
                    <IconCodeDots aria-hidden="true" size={13} stroke={1.8} />
                    <span>
                      <strong>Selected passage</strong>
                      <small>{contextPreview(localContextByMessageId[msg.id], 72)}</small>
                    </span>
                  </span>
                ) : null}
                <p className="message-user-text">{msg.content}</p>
              </>
            )}
          </div>
        ))}
        {isSending ? (
          <div className="message assistant typing" style={{ opacity: 0.6 }}>
            Thinking...
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <form className="chat-form" onSubmit={submitMessage}>
        {selectedContext ? (
          <div className="chat-context-chip">
            <IconCodeDots aria-hidden="true" size={15} stroke={1.8} />
            <span>
              <strong>Selected passage</strong>
              <small>{contextPreview(selectedContext.text)}</small>
            </span>
            <button
              type="button"
              aria-label="Remove selected passage"
              onClick={onClearSelectedContext}
            >
              <IconX aria-hidden="true" size={14} stroke={2} />
            </button>
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          aria-label="Message the agent"
          placeholder="Ask a question or give an instruction..."
          rows={1}
          value={draft}
          onChange={handleDraftChange}
          onFocus={() => onExpandedChange?.(true)}
          onKeyDown={handleKeyDown}
        />
        {isSending ? (
          <button
            className="chat-stop"
            type="button"
            aria-label="Stop"
            title="Stop"
            onClick={stopMessage}
          >
            <IconPlayerStop aria-hidden="true" size={15} stroke={1.8} />
          </button>
        ) : (
          <button
            className="chat-submit button-subtle"
            type="submit"
            aria-label="Send"
            disabled={!draft.trim()}
          >
            <IconSend aria-hidden="true" size={17} stroke={1.8} />
          </button>
        )}
      </form>
    </div>
  )
}
