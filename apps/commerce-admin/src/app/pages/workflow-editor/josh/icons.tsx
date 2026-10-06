/** Stand-in for react-icons/md MdOutlineClose (the only icon the editor uses). */
export function MdOutlineClose({ className, size = 18, ...rest }: { className?: string; size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" aria-hidden {...rest}>
      <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}
