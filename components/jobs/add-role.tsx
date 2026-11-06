"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { addRoleAction } from "@/app/(app)/jobs/actions";
import { applyServerErrors, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { callAction } from "@/lib/call-action";
import {
  addRoleSchema,
  type AddRole,
  type AddRoleInput,
} from "@/lib/schemas/added-role";

// Add a role: for a posting the searches didn't find, such as one a friend
// sent or one on LinkedIn. The link alone is enough where the app can read
// the page; the posting's text covers the sites it can't.

const EMPTY: AddRoleInput = { url: "", text: "" };

export function AddRole() {
  const [open, setOpen] = useState(false);
  const form = useForm<AddRoleInput, unknown, AddRole>({
    resolver: zodResolver(addRoleSchema),
    defaultValues: EMPTY,
  });
  const { control, formState } = form;

  const submit = form.handleSubmit(async (values) => {
    const result = await callAction(() => addRoleAction(values));
    if (!result.ok) {
      applyServerErrors(form.setError, result.errors);
      return;
    }
    form.reset(EMPTY);
    setOpen(false);
  });
  const serverError = formState.errors.root?.server?.message;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset(EMPTY);
      }}
    >
      <DialogTrigger render={<Button variant="outline" className="bg-card" />}>
        <PlusIcon aria-hidden data-icon="inline-start" />
        Add a role
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a role</DialogTitle>
          <DialogDescription>
            For a posting the searches didn&apos;t find. Claude reads it, checks
            it&apos;s open to you and scores it, then makes its kit.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            form.clearErrors();
            return submit(event);
          }}
        >
          <FieldGroup>
            <TextField
              control={control}
              name="url"
              label="Link to the posting"
              type="url"
              autoComplete="off"
              placeholder="https://jobs.example.com/senior-frontend-engineer"
            />
            <TextField
              control={control}
              name="text"
              label="The posting's text (optional)"
              description="Needed where apps can't read the page, such as LinkedIn or Indeed, or a posting behind a sign-in. Copy the whole posting from the page."
              multiline
              rows={6}
              placeholder="Paste the posting here"
              inputClassName="max-h-64"
            />
          </FieldGroup>
          {serverError ? (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? (
                <Spinner aria-hidden data-icon="inline-start" />
              ) : (
                <PlusIcon aria-hidden data-icon="inline-start" />
              )}
              {formState.isSubmitting ? "Adding…" : "Add role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
