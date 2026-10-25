import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, ApiError, type BridgeMachine } from "@/lib/api";
import { Copy, Plus } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const DOCS_URL = "https://github.com/dzulfikar08/atur/blob/master/docs/bridge.md";
const installCommand = (token: string) =>
  `curl -fsSL https://diatur.com/install-bridge.sh | sh -s -- ${token}`;

/** The API answers `{ "error": "..." }`; ApiError carries the raw body text. */
function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 402) return "A Solo or Team plan is required to connect a machine.";
    try {
      const body = JSON.parse(err.message) as { error?: string };
      if (body.error) return body.error;
    } catch {
      /* not JSON */
    }
  }
  return "Something went wrong. Try again.";
}

function lastSeen(m: BridgeMachine): string {
  if (m.online) return "Connected now";
  if (!m.last_seen_at) return "Never connected";
  return `Last seen ${new Date(m.last_seen_at).toLocaleString()}`;
}

function copy(text: string, what: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error("Could not copy. Select the text and copy it by hand."),
  );
}

/** Shown once, right after creation: the token is never retrievable again. */
function NewMachineToken({
  machine,
  token,
  onDone,
}: {
  machine: BridgeMachine;
  token: string;
  onDone: () => void;
}) {
  const command = installCommand(token);
  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="text-base">Connect {machine.name}</CardTitle>
        <CardDescription>
          Run this on the machine. The token is shown once; close this and it is gone. If you lose
          it, revoke the machine and add it again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
          <code>{command}</code>
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => copy(command, "Install command")}>
            <Copy className="mr-1 h-4 w-4" /> Copy command
          </Button>
          <Button variant="outline" size="sm" onClick={() => copy(token, "Token")}>
            <Copy className="mr-1 h-4 w-4" /> Copy token only
          </Button>
          <Button size="sm" onClick={onDone}>
            Done
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Runs on Linux and macOS. Works with herdr, tmux or Muxy.{" "}
          <a href={DOCS_URL} target="_blank" rel="noreferrer" className="underline">
            Setup guide
          </a>
        </p>
      </CardContent>
    </Card>
  );
}

function MachineRow({ machine }: { machine: BridgeMachine }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const revoke = useMutation({
    mutationFn: () => api.revokeMachine(machine.id),
    onSuccess: () => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ["machines"] });
      toast.success(`${machine.name} revoked`);
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const detail = [machine.hostname, machine.backend, lastSeen(machine)].filter(Boolean).join(" · ");

  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2.5">
      <span
        role="img"
        aria-label={machine.online ? "Online" : "Offline"}
        className={cn(
          "h-2.5 w-2.5 shrink-0 rounded-full",
          machine.online ? "bg-[var(--state-green)]" : "bg-muted-foreground/40",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{machine.name}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      {confirming ? (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="destructive"
            size="sm"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate()}
          >
            {revoke.isPending ? "Revoking..." : "Revoke"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Revoke
        </Button>
      )}
    </div>
  );
}

export default function MachinesPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ machine: BridgeMachine; token: string } | null>(null);

  const { data: machines, isLoading } = useQuery({
    queryKey: ["machines"],
    queryFn: api.listMachines,
    // Online dots follow the machine coming and going.
    refetchInterval: 10_000,
  });

  const create = useMutation({
    mutationFn: () => api.createMachine(name.trim()),
    onSuccess: (res) => {
      setCreated(res);
      setAdding(false);
      setName("");
      void qc.invalidateQueries({ queryKey: ["machines"] });
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold">Machines</h1>
        <p className="text-sm text-muted-foreground">
          Connect your own computer to see and drive its terminal agents from the web and the app.
          The machine dials out to Atur, so there is nothing to open on your network.
        </p>
      </div>

      {created && (
        <NewMachineToken
          machine={created.machine}
          token={created.token}
          onDone={() => setCreated(null)}
        />
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Your machines</CardTitle>
            <CardDescription>
              Runs on Linux and macOS. Works with herdr, tmux or Muxy.{" "}
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className="underline">
                Setup guide
              </a>
            </CardDescription>
          </div>
          {!adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Connect a machine
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {adding && (
            <form
              className="space-y-2 rounded-md border border-dashed p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) create.mutate();
              }}
            >
              <label htmlFor="machine-name" className="text-sm font-medium">
                Machine name
              </label>
              <div className="flex gap-2">
                <Input
                  id="machine-name"
                  autoFocus
                  value={name}
                  maxLength={64}
                  placeholder="Work laptop"
                  onChange={(e) => setName(e.target.value)}
                />
                <Button type="submit" disabled={!name.trim() || create.isPending}>
                  {create.isPending ? "Creating..." : "Create"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAdding(false);
                    create.reset();
                  }}
                >
                  Cancel
                </Button>
              </div>
              {create.isError && (
                <p className="text-sm text-destructive">
                  {errorText(create.error)}{" "}
                  {create.error instanceof ApiError && create.error.status === 402 && (
                    <Link to="/billing" className="underline">
                      See plans
                    </Link>
                  )}
                </p>
              )}
            </form>
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : machines && machines.length > 0 ? (
            machines.map((m) => <MachineRow key={m.id} machine={m} />)
          ) : (
            !adding && (
              <p className="text-sm text-muted-foreground">
                No machines yet. Connect one to see its terminal panes here.
              </p>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
