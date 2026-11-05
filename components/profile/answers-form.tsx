"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";

import { saveAnswersAction } from "@/app/(app)/profile/actions";
import { TextField, useServerSubmit } from "@/components/form-fields";
import { SaveBar } from "@/components/profile/save-bar";
import { FieldGroup } from "@/components/ui/field";
import { answersSchema, newFactId, type Answers } from "@/lib/schemas/profile";

import { EmptyList, FormSection, ListItem } from "./form-parts";

export function AnswersForm({ defaultValues }: { defaultValues: Answers }) {
  const form = useForm<Answers>({
    resolver: zodResolver(answersSchema),
    defaultValues,
  });
  const { control } = form;
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "extra",
    keyName: "rhfKey",
  });

  const { onSubmit, savedAt } = useServerSubmit(form, saveAnswersAction);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormSection
        title="Common questions"
        description="Reused in every apply kit, so you can copy them into application forms."
      >
        <FieldGroup>
          <TextField
            control={control}
            name="noticePeriod"
            label="Notice period"
            placeholder="One month"
          />
          <TextField
            control={control}
            name="workAuthorization"
            label="Work authorization"
            description="How you can be hired, for example as a contractor or through an employer of record."
            multiline
            rows={3}
          />
        </FieldGroup>
      </FormSection>

      <FormSection
        title="Links"
        description="Used on application forms and at the top of new CVs and cover letters, in place of the same link on your profile."
      >
        <FieldGroup className="grid gap-4 sm:grid-cols-3">
          <TextField
            control={control}
            name="links.linkedin"
            label="LinkedIn"
            type="url"
            placeholder="https://www.linkedin.com/in/…"
          />
          <TextField
            control={control}
            name="links.github"
            label="GitHub"
            type="url"
            placeholder="https://github.com/…"
          />
          <TextField
            control={control}
            name="links.portfolio"
            label="Portfolio or website"
            type="url"
            placeholder="https://"
          />
        </FieldGroup>
      </FormSection>

      <FormSection
        title="Other answers"
        description="Questions you're asked often, with the answer you want to give."
        addLabel="Add question"
        onAdd={() => append({ id: newFactId("qa"), question: "", answer: "" })}
      >
        {fields.length === 0 && <EmptyList>No other answers yet.</EmptyList>}
        {fields.map((field, index) => (
          <ListItem
            key={field.rhfKey}
            heading={`Question ${index + 1}`}
            index={index}
            count={fields.length}
            onMove={move}
            onRemove={remove}
            removeLabel={`Remove question ${index + 1}`}
          >
            <TextField
              control={control}
              name={`extra.${index}.question`}
              label="Question"
            />
            <TextField
              control={control}
              name={`extra.${index}.answer`}
              label="Answer"
              multiline
              rows={3}
            />
          </ListItem>
        ))}
      </FormSection>

      <SaveBar form={form} savedAt={savedAt} label="Save answers" />
    </form>
  );
}
