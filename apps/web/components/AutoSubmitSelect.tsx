"use client";

import { useCallback } from "react";
import type { ChangeEventHandler, SelectHTMLAttributes } from "react";

type AutoSubmitSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  clearFields?: string[];
};

export function AutoSubmitSelect({ onChange, clearFields, ...rest }: AutoSubmitSelectProps) {
  const handleChange = useCallback<ChangeEventHandler<HTMLSelectElement>>(
    (event) => {
      if (clearFields?.length) {
        const form = event.currentTarget.form;
        if (form) {
          for (const name of clearFields) {
            const element = form.elements.namedItem(name);
            if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
              element.value = "";
            }
          }
        }
      }

      onChange?.(event);
      event.currentTarget.form?.requestSubmit();
    },
    [clearFields, onChange],
  );

  return <select {...rest} onChange={handleChange} />;
}
