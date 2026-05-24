'use client'

export function PageControls({ onRewrite }: { onRewrite: (type: 'simplify' | 'deeper' | 'example') => void }) {
  return (
    <div className="lesson-actions">
      <button className="lesson-action-button" type="button" onClick={() => onRewrite('simplify')}>
        Simplify
      </button>
      <button className="lesson-action-button" type="button" onClick={() => onRewrite('deeper')}>
        Go deeper
      </button>
      <button className="lesson-action-button" type="button" onClick={() => onRewrite('example')}>
        Add example
      </button>
      <button className="lesson-action-button" type="button" disabled>
        Export
      </button>
    </div>
  )
}
