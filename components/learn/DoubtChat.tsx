'use client'

import {
  IconArrowsHorizontal,
  IconCodeDots,
  IconHistory,
  IconPlayerStop,
  IconPlus,
  IconSend,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ContextBadge } from '@/components/ui/ContextBadge'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import type { ChatConversation, DoubtMessage } from '@/types'
import type { UIAction } from '@/types/agent'

// Mirrors the server's title derivation (app/api/agent/message/route.ts) so a
// freshly-sent first message shows the right title immediately, without
// waiting on a refetch.
function deriveConversationTitle(message: string) {
  const clean = message.replace(/\s+/g, ' ').trim()
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean
}

export function DoubtChat({
  courseId,
  topicId,
  topicTitle,
  pageNumber,
  globalPageNumber,
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
  const [messages, setMessages] = useState<DoubtMessage[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(true)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [streamStatus, setStreamStatus] = useState('Thinking…')
  const [localContextByMessageId, setLocalContextByMessageId] = useState<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const historyMenuRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isSending])

  // Load one saved chat thread's messages. `null` means a fresh, not-yet-
  // created thread (the lazy "New chat" state) — nothing to fetch.
  const selectConversation = useCallback(async (conversationId: string | null) => {
    abortControllerRef.current?.abort()
    setActiveConversationId(conversationId)
    if (!conversationId) {
      setMessages([])
      return
    }
    setLoadingHistory(true)
    try {
      const res = await fetch(
        `/api/agent/message?courseId=${encodeURIComponent(courseId)}&conversationId=${encodeURIComponent(conversationId)}`,
      )
      if (!res.ok) throw new Error('Failed to load chat history')
      const data = await res.json()
      setMessages(Array.isArray(data.messages) ? data.messages : [])
    } catch (err) {
      console.error('[DoubtChat] Failed to load conversation history:', err)
    } finally {
      setLoadingHistory(false)
    }
  }, [courseId])

  // On mount (and whenever the course changes) load the saved-thread list and
  // open the most recently active one.
  useEffect(() => {
    let cancelled = false
    async function init() {
      setConversationsLoading(true)
      try {
        const res = await fetch(`/api/chat/conversations?courseId=${encodeURIComponent(courseId)}`)
        if (!res.ok) throw new Error('Failed to load chat threads')
        const data = await res.json()
        if (cancelled) return
        const list: ChatConversation[] = Array.isArray(data.conversations) ? data.conversations : []
        setConversations(list)
        if (list.length > 0) {
          await selectConversation(list[0].id)
        } else {
          setActiveConversationId(null)
          setMessages([])
        }
      } catch (err) {
        console.error('[DoubtChat] Failed to load chat threads:', err)
      } finally {
        if (!cancelled) setConversationsLoading(false)
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [courseId, selectConversation])

  // Close the saved-chats dropdown when clicking outside it.
  useEffect(() => {
    if (!historyOpen) return
    function onOutside(e: MouseEvent) {
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node)) {
        setHistoryOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [historyOpen])

  function startNewConversation() {
    abortControllerRef.current?.abort()
    setHistoryOpen(false)
    setActiveConversationId(null)
    setMessages([])
  }

  async function deleteConversation(conversationId: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (conversationId === 'legacy') return

    const previous = conversations
    const remaining = previous.filter((c) => c.id !== conversationId)
    setConversations(remaining)

    try {
      const res = await fetch(`/api/chat/conversations?conversationId=${encodeURIComponent(conversationId)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        setConversations(previous)
        return
      }
      if (activeConversationId === conversationId) {
        if (remaining.length > 0) {
          await selectConversation(remaining[0].id)
        } else {
          setActiveConversationId(null)
          setMessages([])
        }
      }
    } catch {
      setConversations(previous)
    }
  }

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

  // Reflects a just-sent message's effect on the thread list without waiting
  // for a refetch: sets the title on a thread's first message, bumps recency.
  function touchConversationLocally(conversationId: string, message: string) {
    setConversations((prev) => {
      const next = prev.map((c) => (
        c.id === conversationId
          ? { ...c, title: c.title ?? deriveConversationTitle(message), updatedAt: new Date().toISOString() }
          : c
      ))
      const idx = next.findIndex((c) => c.id === conversationId)
      if (idx <= 0) return next
      const [item] = next.splice(idx, 1)
      return [item, ...next]
    })
  }

  async function submitMessage(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault()
    const message = draft.trim()
    if (!message || isSending) return

    // Lazily create the thread on the first message — an unused "New chat"
    // never becomes a saved row.
    let conversationId = activeConversationId
    const isNewConversation = !conversationId
    if (!conversationId) {
      try {
        const res = await fetch('/api/chat/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId }),
        })
        const data = await res.json()
        if (!res.ok || !data.conversation) throw new Error(data.error || 'Could not start a new chat.')
        conversationId = data.conversation.id as string
        setActiveConversationId(conversationId)
        setConversations((prev) => [data.conversation, ...prev])
      } catch (err) {
        console.error('[DoubtChat] Failed to start a new chat:', err)
        return
      }
    }
    touchConversationLocally(conversationId, message)

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
    const assistantMessageId = `assistant-stream-${Date.now()}`
    const pendingAssistant: DoubtMessage = {
      id: assistantMessageId,
      topic_id: topicId,
      page_number: pageNumber,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, userMessage, pendingAssistant])
    if (attachedContext) {
      setLocalContextByMessageId((prev) => ({ ...prev, [userMessageId]: attachedContext }))
      onClearSelectedContext?.()
    }
    setDraft('')
    setIsSending(true)
    setStreamingMessageId(assistantMessageId)
    setStreamStatus('Thinking…')

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
          conversationId,
          stream: true,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Agent failed to respond.')
      }
      if (!response.body) throw new Error('The agent stream did not start.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')
          const dataLine = frame.split('\n').find((line) => line.startsWith('data:'))
          if (!dataLine) continue
          const event = JSON.parse(dataLine.slice(5).trim()) as {
            type?: string
            id?: string
            content?: string
            delta?: string
            message?: string
            error?: string
            uiAction?: UIAction | null
          }

          if (event.type === 'status') {
            setStreamStatus(event.message || 'Thinking…')
          } else if (event.type === 'delta' && event.delta) {
            setStreamStatus('')
            setMessages((prev) => prev.map((item) => (
              item.id === assistantMessageId
                ? { ...item, content: `${item.content}${event.delta}` }
                : item
            )))
          } else if (event.type === 'done') {
            setMessages((prev) => prev.map((item) => (
              item.id === assistantMessageId
                ? {
                    ...item,
                    id: event.id || item.id,
                    content: event.content || item.content || 'I could not formulate a response.',
                  }
                : item
            )))
            if (event.uiAction) executeUIAction(event.uiAction)
          } else if (event.type === 'error') {
            throw new Error(event.error || 'Agent failed to respond.')
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setMessages((prev) => prev.map((item) => (
          item.id === assistantMessageId && !item.content ? { ...item, content: 'Stopped.' } : item
        )))
        return
      }
      console.error(err)
      setMessages((prev) => prev.map((item) => (
        item.id === assistantMessageId
          ? { ...item, content: 'I encountered an error. Please try again.' }
          : item
      )))
    } finally {
      setIsSending(false)
      setStreamingMessageId(null)
      setStreamStatus('Thinking…')
      abortControllerRef.current = null

      // The server names a brand-new thread from this exchange in the
      // background (an AI call, not instant) — refresh once it's had time to
      // land so the truncated placeholder title gets swapped for the real one.
      if (isNewConversation) {
        window.setTimeout(() => {
          fetch(`/api/chat/conversations?courseId=${encodeURIComponent(courseId)}`)
            .then((res) => res.ok ? res.json() : null)
            .then((data) => {
              if (Array.isArray(data?.conversations)) setConversations(data.conversations)
            })
            .catch(() => {})
        }, 1800)
      }
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
            className="panel-toggle"
            type="button"
            onClick={startNewConversation}
            aria-label="Start a new chat"
            title="New chat"
          >
            <IconPlus aria-hidden="true" size={16} stroke={1.9} />
          </button>
          <div className="chat-history" ref={historyMenuRef}>
            <button
              className="panel-toggle"
              type="button"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-label="Saved chats"
              aria-expanded={historyOpen}
              title="Saved chats"
            >
              <IconHistory aria-hidden="true" size={16} stroke={1.8} />
            </button>
            {historyOpen ? (
              <div className="chat-history-menu" role="menu">
                <div className="chat-history-head">Saved chats</div>
                {conversationsLoading ? (
                  <div className="chat-history-empty">Loading…</div>
                ) : conversations.length === 0 ? (
                  <div className="chat-history-empty">No saved chats yet.</div>
                ) : (
                  conversations.map((conversation) => (
                    <div
                      key={conversation.id}
                      className={`chat-history-item ${conversation.id === activeConversationId ? 'is-active' : ''}`}
                    >
                      <button
                        className="chat-history-item-select"
                        type="button"
                        role="menuitem"
                        onClick={() => { void selectConversation(conversation.id); setHistoryOpen(false) }}
                      >
                        {conversation.title || 'New chat'}
                      </button>
                      {conversation.id !== 'legacy' ? (
                        <button
                          className="chat-history-item-delete"
                          type="button"
                          aria-label={`Delete "${conversation.title || 'New chat'}"`}
                          title="Delete this chat"
                          onClick={(e) => void deleteConversation(conversation.id, e)}
                        >
                          <IconTrash aria-hidden="true" size={13} stroke={1.8} />
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
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
          <div className={`message ${msg.role} ${msg.id === streamingMessageId ? 'streaming' : ''}`} key={msg.id}>
            {msg.topic_title && msg.topic_id !== topicId ? (
              <span className="message-context">
                {msg.topic_title}
                {msg.page_number ? ` · p${msg.page_number}` : ''}
              </span>
            ) : null}
            {msg.role === 'assistant' ? (
              msg.content ? (
                <MarkdownContent className="chat-md">{msg.content}</MarkdownContent>
              ) : msg.id === streamingMessageId ? (
                <span className="chat-stream-status">{streamStatus || 'Writing…'}</span>
              ) : null
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
