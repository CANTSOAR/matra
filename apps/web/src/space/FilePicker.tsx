import { useRef, useState } from 'react';
import { COPY } from './copy';

/** A real button that opens the file chooser (keyboard friendly); the input itself stays out of the way. */
export function FilePicker({
  onFiles,
  className = 'space-btn space-btn-secondary',
  label = COPY.start.files,
  icon,
}: {
  onFiles: (files: File[]) => Promise<void> | void;
  className?: string;
  label?: string;
  icon?: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className={className} disabled={busy} aria-busy={busy || undefined} onClick={() => ref.current?.click()}>
        {icon}
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        aria-label={COPY.files.inputLabel}
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (!files.length) return;
          setBusy(true);
          try {
            await onFiles(files);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
