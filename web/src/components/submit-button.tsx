"use client";

import { useFormStatus } from "react-dom";
import { LoadingOverlay } from "./loading-overlay";

export function Spinner({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

/**
 * A form's submit button that shows a spinner and locks itself while the form
 * is working, so a click never looks ignored and can't be sent twice.
 */
export function SubmitButton({
  children,
  pendingText,
  className = "btn",
  disabled,
}: {
  children: React.ReactNode;
  pendingText?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <>
      {/* Same top bar as page navigation: something is happening, wherever you look. */}
      {pending && <LoadingOverlay label={typeof pendingText === "string" ? pendingText : "Working…"} />}
      <button className={className} disabled={disabled || pending} aria-busy={pending}>
        {pending && <Spinner />}
        {pending ? (pendingText ?? children) : children}
      </button>
    </>
  );
}
