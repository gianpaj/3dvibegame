import { useEffect, useState } from "react";

interface SessionController<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

export function useSession<T>(controller: SessionController<T>): T {
  const [snapshot, setSnapshot] = useState<T>(() => controller.getSnapshot());

  useEffect(() => {
    const unsubscribe = controller.subscribe(() => setSnapshot(controller.getSnapshot()));
    return () => {
      unsubscribe();
    };
  }, [controller]);

  return snapshot;
}
