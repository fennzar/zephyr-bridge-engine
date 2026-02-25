import type { InventoryBalances } from "@domain/pathing";
import type { AssetId } from "@domain/types";
import type { ArbLegs } from "@domain/arbitrage/routing";

import type { ArbPlanStep, InventoryRequirement } from "./types.plan";
import { formatBalance, appendNote } from "./planner.utils";
import type { buildCloseVariants } from "./planner.stages";

export function annotatePreparationInventory(
  entries: Array<{ step: ArbPlanStep; inventoryLimited: boolean }>,
  needAsset: AssetId | undefined,
  requiredAmount: number,
  inventory: InventoryBalances | undefined,
  inventoryNotes: Set<string>,
): boolean {
  if (!needAsset || !Number.isFinite(requiredAmount) || requiredAmount <= 0 || entries.length === 0) {
    return entries.some((entry) => entry.inventoryLimited);
  }
  const available = inventory?.[needAsset];
  if (available == null || !Number.isFinite(available)) {
    const message = `Inventory snapshot unavailable for ${needAsset}.`;
    entries.forEach((entry) => {
      entry.step.notes = appendNote(entry.step.notes, message);
    });
    inventoryNotes.add(message);
    return entries.some((entry) => entry.inventoryLimited);
  }

  const shortfall = requiredAmount - available;
  if (shortfall > 1e-9) {
    const message = `Inventory shortfall ${needAsset}: need ${formatBalance(requiredAmount)}, have ${formatBalance(available)}.`;
    entries.forEach((entry) => {
      entry.inventoryLimited = true;
      entry.step.skip = false;
      entry.step.notes = appendNote(entry.step.notes, message);
    });
    inventoryNotes.add(message);
    return true;
  }

  return entries.some((entry) => entry.inventoryLimited);
}

export function buildInventorySteps({
  leg,
  inventory,
  openAsset,
  openAmount,
  inventoryNotes,
  closeVariants,
  chosenClose,
}: {
  leg: ArbLegs;
  inventory?: InventoryBalances;
  openAsset: AssetId;
  openAmount: number;
  inventoryNotes: Set<string>;
  closeVariants: ReturnType<typeof buildCloseVariants>;
  chosenClose: ReturnType<typeof buildCloseVariants>[number] | null;
}): ArbPlanStep[] {
  const steps: ArbPlanStep[] = [];
  const openEntries = buildInventoryEntries(new Map([[openAsset, openAmount]]), inventory, "Open leg");
  const openNotes = Array.from(inventoryNotes);
  if (!inventory) openNotes.push("Inventory snapshot unavailable.");
  steps.push({
    id: `${leg.asset}-${leg.direction}-inventory-open`,
    stage: "inventory",
    label: "Open leg",
    inventoryDetails: openEntries,
    notes: openNotes,
    blocked: openEntries.some((entry) => !entry.ok),
  });

  closeVariants.forEach((variant) => {
    const requirements = new Map<AssetId, number>();
    const needAsset = variant.semanticSteps[0]?.from as AssetId | undefined;
    if (needAsset) {
      requirements.set(needAsset, openAmount);
    }
    const entries = buildInventoryEntries(requirements, inventory, `Close (${variant.flavor})`);
    const notes: string[] = [];
    notes.push(variant === chosenClose ? "Selected close path." : "Alternative close path.");
    notes.push(...variant.blockReasons.map((reason) => `Blocked: ${reason}`));
    steps.push({
      id: `${leg.asset}-${leg.direction}-inventory-close-${variant.flavor}`,
      stage: "inventory",
      label: `Close leg (${variant.flavor})${variant === chosenClose ? " [selected]" : ""}`,
      inventoryDetails: entries,
      notes,
      blocked: entries.some((entry) => !entry.ok),
      flavor: variant.flavor,
    });
  });

  return steps;
}

export function buildInventoryEntries(
  requirements: Map<AssetId, number>,
  inventory: InventoryBalances | undefined,
  label?: string,
): InventoryRequirement[] {
  const entries: InventoryRequirement[] = [];
  for (const [asset, required] of requirements) {
    if (!Number.isFinite(required) || required <= 0) continue;
    const available = inventory?.[asset] ?? null;
    const remaining = available != null ? available - required : null;
    const ok = remaining == null ? available != null : remaining >= -1e-9;
    entries.push({
      asset,
      required,
      available,
      remaining,
      ok,
      label,
    });
  }
  return entries;
}
