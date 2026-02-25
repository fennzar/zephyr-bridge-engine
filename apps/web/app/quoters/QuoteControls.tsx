"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AssetId, OpType } from "@domain/types";
import type { OperationMatrix, OperationSelection } from "../shared/operations";

interface QuoteControlsProps {
  assets: AssetId[];
  operationChoices: OperationSelection[];
  operationsMatrix: OperationMatrix;
  selectedOperation: OperationSelection;
  selectedFrom: AssetId | null;
  selectedTo: AssetId | null;
  amountValue: string;
  amountPlaceholder?: string;
  amountMode: "in" | "out";
}

const INVALID_COLOR = "#ff5f6d";

export function QuoteControls({
  assets,
  operationChoices,
  operationsMatrix,
  selectedOperation,
  selectedFrom,
  selectedTo,
  amountValue: initialAmount,
  amountPlaceholder,
  amountMode,
}: QuoteControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [operationValue, setOperationValue] = useState<OperationSelection>(selectedOperation);
  const [fromValue, setFromValue] = useState<AssetId | "">(selectedFrom ?? "");
  const [toValue, setToValue] = useState<AssetId | "">(selectedTo ?? "");
  const [amountValue, setAmountValue] = useState(initialAmount);
  const [modeValue, setModeValue] = useState<"in" | "out">(amountMode);

  useEffect(() => {
    setOperationValue(selectedOperation);
  }, [selectedOperation]);

  useEffect(() => {
    setFromValue(selectedFrom ?? "");
  }, [selectedFrom]);

  useEffect(() => {
    setToValue(selectedTo ?? "");
  }, [selectedTo]);

  useEffect(() => {
    setAmountValue(initialAmount);
  }, [initialAmount]);

  useEffect(() => {
    setModeValue(amountMode);
  }, [amountMode]);

  const makeUrl = useCallback(
    (next: {
      op?: OperationSelection;
      from?: AssetId | "";
      to?: AssetId | "" | null;
      amount?: string | null;
      side?: "in" | "out" | null;
    }) => {
      const params = new URLSearchParams(searchParams.toString());

      if ("op" in next) {
        const op = next.op;
        if (!op || op === "auto") {
          params.delete("op");
        } else {
          params.set("op", op);
        }
      }

      if ("from" in next) {
        const from = next.from;
        if (from) {
          params.set("from", from);
        } else {
          params.delete("from");
        }
      }

      if ("to" in next) {
        const to = next.to;
        if (!to) {
          params.delete("to");
        } else {
          params.set("to", to);
        }
      }

      if ("amount" in next) {
        const amount = next.amount;
        if (!amount) {
          params.delete("amount");
        } else {
          params.set("amount", amount);
        }
      }

      if ("side" in next) {
        const side = next.side;
        if (!side || side === "in") {
          params.delete("side");
        } else {
          params.set("side", side);
        }
      }

      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, searchParams],
  );

  const navigate = useCallback(
    (update: {
      op?: OperationSelection;
      from?: AssetId | "";
      to?: AssetId | "" | null;
      amount?: string | null;
      side?: "in" | "out" | null;
    }) => {
      router.replace(makeUrl(update), { scroll: false });
    },
    [makeUrl, router],
  );

  const operationsFromTo = useCallback(
    (from: AssetId | "", to: AssetId): OpType[] => {
      if (!from) return [];
      const row = operationsMatrix[from as AssetId];
      if (!row) return [];
      return row[to] ?? [];
    },
    [operationsMatrix],
  );

  const toOptionIsValid = useCallback(
    (target: AssetId, from: AssetId | "", op: OperationSelection) => {
      if (!from) return true;
      const ops = operationsFromTo(from, target);
      if (ops.length === 0) return false;
      if (op === "auto") return true;
      return ops.includes(op as OpType);
    },
    [operationsFromTo],
  );

  const toOptionLabel = useCallback(
    (target: AssetId, from: AssetId | "", op: OperationSelection) => {
      const ops = operationsFromTo(from, target);
      if (ops.length === 0) return target;
      if (op === "auto") {
        return `${target} (${ops.join(", ")})`;
      }
      return target;
    },
    [operationsFromTo],
  );

  const fromOptionIsValid = useCallback(
    (asset: AssetId, op: OperationSelection) => {
      const row = operationsMatrix[asset];
      if (!row) return false;
      if (op === "auto") {
        return Object.values(row).some((ops) => ops.length > 0);
      }
      return Object.values(row).some((ops) => ops.includes(op as OpType));
    },
    [operationsMatrix],
  );

  const handleOperationChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextOp = event.target.value as OperationSelection;
      setOperationValue(nextOp);

      let nextTo: AssetId | "" = toValue;
      if (toValue) {
        const valid = toOptionIsValid(toValue, fromValue, nextOp);
        if (!valid) {
          nextTo = "";
          setToValue("");
        }
      }

      navigate({ op: nextOp, to: nextTo || null, side: modeValue });
    },
    [fromValue, modeValue, navigate, toOptionIsValid, toValue],
  );

  const handleFromChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextFrom = event.target.value as AssetId | "";
      setFromValue(nextFrom);
      setToValue("");
      setAmountValue("");
      navigate({ from: nextFrom, to: null, amount: null, side: modeValue });
    },
    [modeValue, navigate],
  );

  const handleToChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextTo = event.target.value as AssetId | "";
      setToValue(nextTo);
      navigate({ to: nextTo || null, side: modeValue });
    },
    [modeValue, navigate],
  );

  const handleAmountChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setAmountValue(event.target.value);
  }, []);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      navigate({
        op: operationValue,
        from: fromValue,
        to: toValue || null,
        amount: amountValue.trim() ? amountValue.trim() : null,
        side: modeValue,
      });
    },
    [amountValue, fromValue, modeValue, navigate, operationValue, toValue],
  );

  const fromOptions = useMemo(
    () =>
      assets.map((asset) => ({
        asset,
        valid: fromOptionIsValid(asset, operationValue),
      })),
    [assets, fromOptionIsValid, operationValue],
  );

  const toOptions = useMemo(
    () =>
      assets.map((asset) => ({
        asset,
        valid: toOptionIsValid(asset, fromValue, operationValue),
        label: toOptionLabel(asset, fromValue, operationValue),
      })),
    [assets, fromValue, operationValue, toOptionIsValid, toOptionLabel],
  );

  return (
    <form
      method="get"
      onSubmit={handleSubmit}
      style={{ display: "grid", gap: 12, background: "#101621", border: "1px solid #1f2b3a", borderRadius: 8, padding: 16 }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span>From Asset</span>
          <select
            name="from"
            value={fromValue}
            onChange={handleFromChange}
            style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
            required
          >
            <option value="" disabled>
              Select asset
            </option>
            {fromOptions.map(({ asset, valid }) => (
              <option key={asset} value={asset} style={valid ? undefined : { color: INVALID_COLOR }}>
                {asset}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span>Operation</span>
          <select
            name="op"
            value={operationValue}
            onChange={handleOperationChange}
            style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
          >
            {operationChoices.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span>To Asset</span>
          <select
            name="to"
            value={toValue}
            onChange={handleToChange}
            disabled={!fromValue}
            style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
            required
          >
            <option value="" disabled>
              Select asset
            </option>
            {toOptions.map(({ asset, valid, label }) => (
              <option key={asset} value={asset} style={valid ? undefined : { color: INVALID_COLOR }}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span>Quote Mode</span>
          <select
            name="side"
            value={modeValue}
            onChange={(event) => {
              const nextMode = (event.target.value as "in" | "out") || "in";
              setModeValue(nextMode);
              navigate({ side: nextMode, amount: amountValue.trim() ? amountValue.trim() : null, to: toValue || null, from: fromValue || "", op: operationValue });
            }}
            style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
          >
            <option value="in">Exact In</option>
            <option value="out">Exact Out</option>
          </select>
        </label>

        <label style={{ display: "grid", gap: 4, minWidth: 220 }}>
          <span>{modeValue === "in" ? "Amount In (decimal)" : "Target Amount Out (decimal)"}</span>
          <input
            type="text"
            name="amount"
            value={amountValue}
            onChange={handleAmountChange}
            placeholder={amountPlaceholder ?? "e.g. 1.0"}
            style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
          />
        </label>

        <button type="submit" style={{ padding: "8px 16px" }}>
          Quote
        </button>
      </div>
    </form>
  );
}
