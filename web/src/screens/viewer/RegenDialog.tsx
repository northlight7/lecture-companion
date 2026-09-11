import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/** Must match the maxlength the previous dialog put on this field. */
const MAX_STEER_CHARS = 600;

/**
 * Explain again. One entry point in the viewer, one note from the reader about
 * what the last attempt got wrong, and then the choice the old dialog offered:
 * this slide, or every slide in the deck.
 *
 * A note the reader leaves empty is sent as an empty string and the backend
 * reads that as no note at all, which is the previous behaviour.
 */
export function RegenDialog({
  open,
  onOpenChange,
  running,
  disconnected,
  onConnect,
  onRun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  running: boolean;
  disconnected: boolean;
  onConnect: () => void;
  onRun: (wholeDeck: boolean, steer: string) => Promise<void>;
}) {
  const steer = useRef<HTMLTextAreaElement | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"slide" | "deck" | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote("");
    setError(null);
    setBusy(null);
  }, [open]);

  const run = async (wholeDeck: boolean) => {
    setError(null);
    setBusy(wholeDeck ? "deck" : "slide");
    try {
      await onRun(wholeDeck, note.trim());
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          steer.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Explain again</DialogTitle>
          <DialogDescription>
            The explanation is written from the slide, its image and this course&apos;s context. Say
            what the last one got wrong and it is taken into account. Leave this empty to simply try
            again.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="regen-steer">What should it do differently? (optional)</Label>
          <Textarea
            id="regen-steer"
            ref={steer}
            rows={3}
            maxLength={MAX_STEER_CHARS}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Explain the graph in more detail."
          />
        </div>

        {running ? (
          <p className="font-ui text-meta text-ink-muted">
            This course is being explained right now, so the whole deck cannot be restarted until it
            pauses.
          </p>
        ) : null}

        {disconnected ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-ui text-meta text-ink-muted">
              Not connected, so nothing can be written right now.
            </p>
            <Button type="button" variant="secondary" size="md" onClick={onConnect}>
              Connect
            </Button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="font-ui text-meta text-bad">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={busy !== null || running}
            onClick={() => void run(true)}
          >
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden />
            The whole deck
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={busy !== null}
            onClick={() => void run(false)}
          >
            {busy === "slide" ? <Spinner size="sm" label="" /> : null}
            This slide
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
