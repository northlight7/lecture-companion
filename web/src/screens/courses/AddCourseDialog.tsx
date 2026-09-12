/**
 * Making a course: one field, one dialog.
 *
 * The form that used to sit under the grid moved in here, and its behaviour
 * moved with it. The trim is the old trim, and the field error is the old error
 * line, written into the field's own `role="alert"` region rather than toasted,
 * including the 428 that opens the connect dialog everywhere else, so this does
 * not call the shared error handler. Both failure paths put focus back in the
 * field, and creating navigates straight to the new course.
 *
 * The dialog is Radix, so closing it returns focus to the `Add course` button
 * that opened it, and a title left behind in a closed dialog is cleared rather
 * than kept as a draft nobody asked for.
 */

import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";

import * as api from "@/lib/api";
import { hash, navigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AddCourseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setError(null);
      setCreating(false);
    }
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Give the course a title.");
      field.current?.focus();
      return;
    }
    setCreating(true);
    try {
      const course = await api.createCourse(trimmed);
      setTitle("");
      navigate(hash.course(course.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      field.current?.focus();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a course</DialogTitle>
          <DialogDescription>
            A title is the whole form. Files go in from inside the course.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-course-title">Title</Label>
            <Input
              id="new-course-title"
              ref={field}
              name="title"
              type="text"
              autoComplete="off"
              placeholder="Statistical Learning"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "new-course-error" : undefined}
            />
            {error ? (
              <p id="new-course-error" role="alert" className="text-ui font-medium text-bad">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={creating}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={creating}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
