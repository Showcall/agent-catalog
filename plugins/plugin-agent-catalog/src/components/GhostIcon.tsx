/** The little shadow-agent mark — gives probe-discovered agents an identity. */
export const GhostIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    style={{ verticalAlign: 'text-bottom' }}
  >
    <path d="M12 2a8 8 0 0 0-8 8v11l2.7-2 2.65 2 2.65-2 2.65 2 2.65-2V10a8 8 0 0 0-8-8zm-2.6 7.4a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zm5.2 0a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z" />
  </svg>
);
