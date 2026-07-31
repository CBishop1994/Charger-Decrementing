import { useCallback, useState } from "react";

export type Toast = {
  id: number;
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive";
};

let nextId = 1;

export function useToastState() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: Omit<Toast, "id">) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { ...input, id }]);
      window.setTimeout(() => dismiss(id), 4200);
      return id;
    },
    [dismiss],
  );

  return { toasts, toast, dismiss };
}
