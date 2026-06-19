'use client'

import { useId, useState } from 'react'
import { IconZoomScan, IconPhotoExclamation } from '@tabler/icons-react'
import { ImageViewer } from './ImageViewer'

interface LessonImageProps {
  src: string
  alt?: string
  /** Optional caption + figure label (from source metadata or markdown title). */
  caption?: string
  figureLabel?: string
  /** Intrinsic dimensions, when known, to reserve space and avoid layout shift. */
  width?: number | null
  height?: number | null
  /** Used to register a scroll/highlight anchor for "See Figure N" references. */
  anchorId?: string
}

/**
 * Production-quality lesson image. Guarantees:
 *  - never cropped (object-fit: contain), never distorted (aspect ratio preserved)
 *  - never overflows its container or causes horizontal scroll (max-width: 100%)
 *  - handles extreme aspect ratios (very wide / very tall) via bounded height
 *  - graceful loading shimmer + error fallback
 *  - click / Enter / Space opens the advanced fullscreen viewer
 */
export function LessonImage({
  src,
  alt,
  caption,
  figureLabel,
  width,
  height,
  anchorId,
}: LessonImageProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [open, setOpen] = useState(false)
  const reactId = useId()
  const id = anchorId ?? `figure-${reactId.replace(/:/g, '')}`

  // Derive an orientation hint so CSS can bound extreme ratios sensibly.
  const ratio = width && height ? width / height : null
  const orientation = ratio == null ? '' : ratio >= 2.2 ? 'is-wide' : ratio <= 0.5 ? 'is-tall' : 'is-regular'

  const label = figureLabel || alt
  const showCaption = Boolean(caption || figureLabel)

  if (status === 'error') {
    return (
      <figure className="lesson-figure is-error" id={id}>
        <div className="lesson-figure-fallback">
          <IconPhotoExclamation size={20} stroke={1.6} aria-hidden="true" />
          <span>{label ? `Image unavailable: ${label}` : 'Image unavailable'}</span>
        </div>
        {showCaption && (
          <figcaption className="lesson-figcaption">
            {figureLabel && <strong>{figureLabel}. </strong>}
            {caption}
          </figcaption>
        )}
      </figure>
    )
  }

  return (
    <figure className={`lesson-figure ${orientation}`.trim()} id={id}>
      <button
        type="button"
        className={`lesson-figure-frame${status === 'loading' ? ' is-loading' : ''}`}
        onClick={() => setOpen(true)}
        aria-label={label ? `Expand image: ${label}` : 'Expand image'}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="lesson-figure-img"
          src={src}
          alt={alt ?? label ?? ''}
          loading="lazy"
          decoding="async"
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('error')}
        />
        <span className="lesson-figure-zoom" aria-hidden="true">
          <IconZoomScan size={16} stroke={1.8} />
        </span>
      </button>
      {showCaption && (
        <figcaption className="lesson-figcaption">
          {figureLabel && <strong>{figureLabel}. </strong>}
          {caption}
        </figcaption>
      )}
      {open && (
        <ImageViewer
          source={{ url: src, alt, caption, figureLabel }}
          onClose={() => setOpen(false)}
        />
      )}
    </figure>
  )
}
