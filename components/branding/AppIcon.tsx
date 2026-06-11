import Image from 'next/image'

export function AppIcon({
  size = 24,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={className}
      height={size}
      priority
      src="/trulurn-icon.svg"
      width={size}
    />
  )
}
