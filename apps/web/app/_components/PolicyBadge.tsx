export function PolicyBadge({ ok }: { ok: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: ok ? "#16c784" : "#f45b69",
          boxShadow: `0 0 6px ${ok ? "rgba(22,199,132,0.6)" : "rgba(244,91,105,0.5)"}`,
        }}
      />
      <span style={{ fontSize: 12, letterSpacing: 0.3 }}>
        {ok ? "Enabled" : "Disabled"}
      </span>
    </span>
  );
}
