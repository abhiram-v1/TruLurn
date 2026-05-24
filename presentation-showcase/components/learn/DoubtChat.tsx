'use client'

import { FormEvent, useState } from 'react'
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

  function submitDoubt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = draft.trim()
    if (!question) return

    const userMessage: DoubtMessage = {
      id: `local-user-${Date.now()}`,
      topic_id: topicId,
      page_number: pageNumber,
      role: 'user',
      content: question,
      created_at: new Date().toISOString(),
    }

    const offTopic = /\b(gradient descent|neural|transformer|backprop|regularization)\b/i.test(question)
    const assistantMessage: DoubtMessage = {
      id: `local-assistant-${Date.now()}`,
      topic_id: topicId,
      page_number: pageNumber,
      role: 'assistant',
      content: offTopic
        ? `That comes later. Stay focused on ${topicTitle} for now.`
        : 'Good doubt. In this page, focus on the mechanism: inputs create a prediction, the prediction is compared with reality, and the error tells us whether the current line is useful.',
      created_at: new Date().toISOString(),
    }

    setMessages((current) => [...current, userMessage, assistantMessage])
    setDraft('')
  }

  return (
    <div className="chat-box">
      <ContextBadge topicTitle={topicTitle} pageNumber={pageNumber} />
      <div className="messages">
        {messages.map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            <div className="message-role">{message.role}</div>
            {message.content}
          </div>
        ))}
      </div>
      <form className="chat-form" onSubmit={submitDoubt}>
        <textarea
          aria-label="Ask a doubt"
          placeholder="Ask only about this page..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="button" type="submit">
          Ask
        </button>
      </form>
    </div>
  )
}
