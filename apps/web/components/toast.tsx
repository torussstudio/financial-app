import { useCallback, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

export type ToastTone = "success" | "error" | "warning" | "info";
export type ToastInput = { tone?: ToastTone; title: string; description?: string };
type ToastItem = Required<Pick<ToastInput, "title">> & { id: number; tone: ToastTone; description?: string; leaving?: boolean };

// Errors stay up longer so there is time to read the reason; three toasts at most keep the corner tidy.
const DURATION: Record<ToastTone, number> = { success: 4500, info: 5000, warning: 6500, error: 8000 };
const MAX_VISIBLE = 3;
const icons = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const dismiss = useCallback((id: number) => {
    setToasts(list => list.map(t => t.id === id ? { ...t, leaving: true } : t));
    setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), 180);
  }, []);
  const notify = useCallback((input: ToastInput) => {
    const id = ++nextId.current;
    const toast: ToastItem = { id, tone: input.tone ?? "success", title: input.title, description: input.description };
    setToasts(list => [...list, toast].slice(-MAX_VISIBLE));
  }, []);
  return { toasts, notify, dismiss };
}

export function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return <section className="toast-viewport" aria-label="Notifications">
    {toasts.map(t => {
      const Icon = icons[t.tone];
      const urgent = t.tone === "error" || t.tone === "warning";
      return <div key={t.id}
        className={"toast toast-" + t.tone + (t.leaving ? " leaving" : "")}
        role={urgent ? "alert" : "status"}
        aria-live={urgent ? "assertive" : "polite"}
        aria-atomic="true">
        <span className="toast-icon"><Icon size={17} strokeWidth={2.2}/></span>
        <div className="toast-body">
          <strong>{t.title}</strong>
          {t.description && <p>{t.description}</p>}
        </div>
        <button className="toast-close" aria-label="Dismiss notification" onClick={() => onDismiss(t.id)}><X size={14}/></button>
        {/* The countdown bar is the timer: it pauses while hovered or focused, and dismisses when it runs out. */}
        <i className="toast-progress" style={{ animationDuration: DURATION[t.tone] + "ms" }} onAnimationEnd={() => onDismiss(t.id)}/>
      </div>;
    })}
  </section>;
}
