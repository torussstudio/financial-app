"use client";
import { useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  loading?: boolean;
  loadingText?: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => unknown;
};

export function ActionButton({ loading = false, loadingText, disabled, onClick, children, ...props }: Props) {
  const [pending, setPending] = useState(false);
  const isLoading = loading || pending;
  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled || isLoading || !onClick) return;
    try {
      const result = onClick(event);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        setPending(true);
        await result;
      }
    } catch {
      // The owning page handles and displays the action error.
    } finally {
      setPending(false);
    }
  };

  return <button {...props} disabled={disabled || isLoading} aria-busy={isLoading || undefined} onClick={handleClick}>
    {isLoading && <LoaderCircle size={15} className="button-spinner" aria-hidden="true"/>}
    {isLoading && loadingText ? loadingText : children}
  </button>;
}
