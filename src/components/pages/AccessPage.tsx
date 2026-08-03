import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  UserPlus,
} from "lucide-react";
import { api, type ApprovedEmail, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SetupRequiredBanner } from "@/components/SetupRequiredBanner";
import { BlurFade } from "@/components/ui/blur-fade";

type ToastFn = (t: {
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive";
}) => void;

export function AccessPage({ onToast }: { onToast: ToastFn }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ApprovedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const me = rows.find(
    (r) => r.email.toLowerCase() === (user?.email ?? "").toLowerCase(),
  );
  const isAdmin = Boolean(me?.is_admin);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ApprovedEmail[]>("/api/approved-emails");
      setRows(data);
    } catch (err) {
      setError(err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setSaving(true);
    try {
      await api.post<ApprovedEmail>("/api/approved-emails", {
        email: email.trim(),
        name: name.trim(),
        is_admin: makeAdmin,
      });
      setEmail("");
      setName("");
      setMakeAdmin(false);
      onToast({
        title: "Access granted",
        description: `${email.trim().toLowerCase()} can now sign in.`,
        variant: "success",
      });
      await load();
    } catch (err) {
      onToast({
        title: "Could not add email",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleAdmin(row: ApprovedEmail) {
    if (!isAdmin) return;
    setBusyId(row.id);
    try {
      await api.patch<ApprovedEmail>(`/api/approved-emails/${row.id}`, {
        is_admin: !row.is_admin,
      });
      onToast({
        title: row.is_admin ? "Admin removed" : "Admin granted",
        description: row.email,
        variant: "success",
      });
      await load();
    } catch (err) {
      onToast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: ApprovedEmail) {
    if (!isAdmin) return;
    if (
      !window.confirm(
        `Remove access for ${row.email}? They will not be able to sign in.`,
      )
    ) {
      return;
    }
    setBusyId(row.id);
    try {
      await api.delete(`/api/approved-emails/${row.id}`);
      onToast({
        title: "Access removed",
        description: row.email,
        variant: "success",
      });
      await load();
    } catch (err) {
      onToast({
        title: "Could not remove",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  if (error instanceof ApiError && error.code === "SETUP_REQUIRED") {
    return <SetupRequiredBanner error={error} onRetry={load} />;
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <BlurFade delay={0.04}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Team access
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Only listed Gmail addresses can sign in with Google.
              {isAdmin
                ? " You can add or remove teammates."
                : " Ask an admin to change the list."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </BlurFade>

      {isAdmin ? (
        <BlurFade delay={0.08}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <UserPlus className="h-4 w-4 text-primary" />
                Approve a Google email
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleAdd}
                className="grid gap-4 sm:grid-cols-[1.4fr_1fr_auto_auto] sm:items-end"
              >
                <div className="space-y-2">
                  <Label htmlFor="approve-email">Email</Label>
                  <Input
                    id="approve-email"
                    type="email"
                    required
                    placeholder="teammate@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="approve-name">Display name</Label>
                  <Input
                    id="approve-name"
                    placeholder="Optional"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <label className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-foreground"
                    checked={makeAdmin}
                    onChange={(e) => setMakeAdmin(e.target.checked)}
                  />
                  Admin
                </label>
                <Button type="submit" disabled={saving || !email.trim()}>
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Add
                </Button>
              </form>
            </CardContent>
          </Card>
        </BlurFade>
      ) : null}

      <BlurFade delay={0.12}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4 text-primary" />
              Approved accounts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading access list…
              </div>
            ) : rows.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                No approved emails yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Added by</TableHead>
                      {isAdmin ? (
                        <TableHead className="text-right">Actions</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const isMe =
                        row.email.toLowerCase() ===
                        (user?.email ?? "").toLowerCase();
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            {row.email}
                            {isMe ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                (you)
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.name || "—"}
                          </TableCell>
                          <TableCell>
                            {row.is_admin ? (
                              <Badge variant="default">Admin</Badge>
                            ) : (
                              <Badge variant="secondary">Member</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.created_by || "—"}
                          </TableCell>
                          {isAdmin ? (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={busyId === row.id}
                                  onClick={() => void toggleAdmin(row)}
                                >
                                  {row.is_admin ? "Remove admin" : "Make admin"}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={busyId === row.id || isMe}
                                  onClick={() => void remove(row)}
                                  aria-label={`Remove ${row.email}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </BlurFade>
    </div>
  );
}
