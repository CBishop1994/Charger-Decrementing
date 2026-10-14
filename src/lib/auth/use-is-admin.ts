import { useCallback, useEffect, useState } from "react";
import { api, type ApprovedEmail } from "@/lib/api";
import { useAuth } from "@/lib/auth/use-auth";

/**
 * Whether the signed-in user is an app admin.
 * Uses approved_emails.is_admin; destage `dev@localhost` is always admin.
 */
export function useIsAdmin() {
  const { user, status } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (status !== "authenticated" || !user?.email) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    if (user.email.toLowerCase() === "dev@localhost") {
      setIsAdmin(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const emails = await api
        .get<ApprovedEmail[]>("/api/approved-emails")
        .catch(() => [] as ApprovedEmail[]);
      const me = emails.find(
        (r) => r.email.toLowerCase() === user.email!.toLowerCase(),
      );
      setIsAdmin(Boolean(me?.is_admin));
    } catch {
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  }, [status, user?.email]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { isAdmin, loading, refresh };
}
