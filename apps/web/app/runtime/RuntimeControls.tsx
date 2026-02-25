"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AssetId, OpType } from "@domain/types";
import type { OperationMatrix, OperationSelection } from "../shared/operations";

interface RuntimeControlsProps {
  assets: AssetId[];
  operationChoices: OperationSelection[];
  operationsMatrix: OperationMatrix;
  selectedOperation: OperationSelection;
  selectedFrom: AssetId | null;
  selectedTo: AssetId | null;
}

const INVALID_COLOR = "#ff5f6d";

export function RuntimeControls({
  assets,
  operationChoices,
  operationsMatrix,
  selectedOperation,
  selectedFrom,
  selectedTo,
}: RuntimeControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [operationValue, setOperationValue] = useState<OperationSelection>(selectedOperation);
  const [fromValue, setFromValue] = useState<AssetId | "">(selectedFrom ?? "");
  const [toValue, setToValue] = useState<AssetId | "">(selectedTo ?? "");

  useEffect(() => {
    setOperationValue(selectedOperation);
  }, [selectedOperation]);

  useEffect(() => {
    setFromValue(selectedFrom ?? "");
  }, [selectedFrom]);

  useEffect(() => {
    setToValue(selectedTo ?? "");
  }, [selectedTo]);

  const makeUrl = useCallback(
    (next: { op?: OperationSelection; from?: AssetId | ""; to?: AssetId | "" | null }) => {
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

      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, searchParams],
  );

  const navigate = useCallback(
    (update: { op?: OperationSelection; from?: AssetId | ""; to?: AssetId | "" | null }) => {
      router.replace(makeUrl(update), { scroll: false });
    },
    [makeUrl, router],
  );

  const fromOptionIsValid = useCallback(
    (asset: AssetId, op: OperationSelection) => {
      const row = operationsMatrix[asset];
      if (!row) return false;
      if (op === "auto") {
        return Object.keys(row).length > 0;
      }
      return Object.values(row).some((ops) => ops.includes(op as OpType));
    },
    [operationsMatrix],
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

      navigate({ op: nextOp, to: nextTo || null });
    },
    [fromValue, navigate, toOptionIsValid, toValue],
  );

  const handleFromChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextFrom = event.target.value as AssetId | "";
      setFromValue(nextFrom);
      setToValue("");
      navigate({ from: nextFrom, to: null });
    },
    [navigate],
  );

  const handleToChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextTo = event.target.value as AssetId | "";
      setToValue(nextTo);
      navigate({ to: nextTo || null });
    },
    [navigate],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      navigate({ op: operationValue, from: fromValue, to: toValue || null });
    },
    [fromValue, navigate, operationValue, toValue],
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

        <button type="submit" style={{ padding: "8px 16px" }}>
          Inspect
        </button>
      </div>
    </form>
  );
}
