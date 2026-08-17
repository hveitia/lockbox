"use client";

import { useEffect, useRef } from "react";

/** A modal built on <dialog> so focus trapping and Esc come from the platform. */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-label={title}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-sm border border-ink-line bg-ink-raised p-0 text-parchment backdrop:bg-ink/80"
    >
      <div className="p-6">
        <h2 className="font-display text-2xl font-semibold">{title}</h2>
        <div className="mt-1 mb-5 h-px w-full bg-brass/40" />
        {children}
      </div>
    </dialog>
  );
}
