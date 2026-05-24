'use client'

export function PageControls({ onRewrite }: { onRewrite: (type: 'simplify' | 'deeper' | 'example') => void }) {
  return (
    <div className="lesson-actions">
      <button className="button-quiet" type="button" onClick={() => onRewrite('simplify')}>
        Simplify
      </button>
      <button className="button-quiet" type="button" onClick={() => onRewrite('deeper')}>
        Go deeper
      </button>
      <button className="button-quiet" type="button" onClick={() => onRewrite('example')}>
        Add example
      </button>
    </div>
  )
}
