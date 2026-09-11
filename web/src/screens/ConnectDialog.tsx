import { useEffect, useRef, useState } from "react";

import * as api from "@/lib/api";
import { useStore } from "@/state/store";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Where the reader puts their DeepSeek key.
 *
 * The key is typed, tested against the API once, and then stored by the server
 * in the operating system keyring. It is never written into this project, never
 * logged, and never held anywhere in this component after the request returns:
 * the input is cleared on success and on close.
 */
export function ConnectDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { connection, refreshConnection } = useStore();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  // A key left sitting in a detached input is still a key on screen.
  useEffect(() => {
    if (!open) {
      setKey("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (open) void refreshConnection();
  }, [open, refreshConnection]);

  const state = (() => {
    if (!connection) {
      return "The server is not answering, so the key cannot be checked right now.";
    }
    if (connection.fake) {
      return "Offline demo mode is on, so no key is needed. Explanations come from the stub client. Unset LC_FAKE_MODEL to use the real model.";
    }
    if (connection.connected) {
      return `Connected with key ${connection.hint}, using ${connection.model}. Paste a new key below to replace it.`;
    }
    return "Paste your DeepSeek key. It is tested before anything is stored, and explanations cannot be generated until it works.";
  })();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = key.trim();
    if (!value) {
      setError("Paste a key first.");
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveConnection(value);
      if (result.connected) {
        setKey("");
        await refreshConnection();
        onOpenChange(false);
        toast(`Connected. Key ${result.hint} is in your keyring.`);
      } else {
        setError(result.detail || "That key was rejected.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Connect to DeepSeek</DialogTitle>
          <DialogDescription>{state}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api-key">API key</Label>
            <Input
              id="api-key"
              ref={input}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "api-key-error" : "api-key-help"}
            />
            <p id="api-key-help" className="text-meta text-ink-faint">
              The key is tested once, then stored in your operating system
              keyring. It is never written into this project and never sent
              anywhere but DeepSeek.
            </p>
            {error ? (
              <p id="api-key-error" role="alert" className="text-meta text-bad">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {connection?.hint ? (
              <ForgetKey onForgotten={() => onOpenChange(false)} />
            ) : (
              <span />
            )}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Testing" : "Test and save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one destructive control in the app that cannot be undone: the key is
 * removed from the machine-global keyring and a deleted DeepSeek key is gone
 * for good. The previous frontend did this on a single unguarded click, which
 * is why it is behind a confirmation here.
 */
function ForgetKey({ onForgotten }: { onForgotten: () => void }) {
  const { refreshConnection } = useStore();
  const [busy, setBusy] = useState(false);

  async function forget() {
    setBusy(true);
    try {
      await api.forgetConnection();
      await refreshConnection();
      onForgotten();
      toast("Key removed from the keyring.");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="danger" disabled={busy}>
          Forget key
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Forget the stored key?</AlertDialogTitle>
          <AlertDialogDescription>
            The key is deleted from your operating system keyring. This cannot
            be undone, and a deleted DeepSeek key cannot be recovered. You would
            need to make a new one before the app can explain anything again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={forget}>Delete the key</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
