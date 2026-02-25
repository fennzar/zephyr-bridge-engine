"use client";

import { useState } from "react";
import type { ReactNode } from "react";

interface CollapsibleProps {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function Collapsible({ summary, children, defaultOpen = false }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ border: "1px solid #1f2b3a", borderRadius: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "transparent",
          color: "#d1e4ff",
          border: "none",
          padding: "10px 12px",
          fontSize: 13,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
        }}
      >
        <span>{summary}</span>
        <span style={{ opacity: 0.65, fontSize: 12 }}>{open ? "−" : "+"}</span>
      </button>
      {open ? <div style={{ padding: 12 }}>{children}</div> : null}
    </div>
  );
}
