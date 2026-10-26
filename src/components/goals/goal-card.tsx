"use client";

import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  MdFlag,
  MdEdit,
  MdArchive,
  MdUnarchive,
  MdDelete,
} from "react-icons/md";
import { formatCurrency, formatYearMonth } from "@/lib/constants";
import type { Goal } from "@/types";
import type { GoalProgress } from "@/lib/goal-utils";

const TRACKING_LABELS: Record<Goal["trackingMethod"], string> = {
  "account-balance": "Account balance",
  "net-worth": "Net worth",
  manual: "Manual",
};

function progressTag(
  goal: Goal,
  progress: GoalProgress,
): { value: string; severity: "success" | "warning" | "secondary" } {
  if (goal.isArchived) return { value: "Archived", severity: "secondary" };
  if (progress.percentComplete >= 100)
    return { value: "Achieved", severity: "success" };
  return progress.onTrack
    ? { value: "On track", severity: "success" }
    : { value: "Behind", severity: "warning" };
}

export function GoalCard({
  goal,
  progress,
  warning,
  plan,
  onEdit,
  onToggleArchive,
  onDelete,
}: {
  goal: Goal;
  progress: GoalProgress;
  // e.g. the linked account no longer exists — progress can't be computed.
  warning?: string;
  // Joint-plan context (active goals only) — omitted for archived goals.
  plan?: {
    competingGoalIds: string[];
    requiredMonthlySaving: number | null;
    targetDatePassed: boolean;
  };
  onEdit: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}) {
  const tag = progressTag(goal, progress);
  const percent = Math.round(progress.percentComplete);
  const goalType = goal.goalType ?? "reserve";
  const injects = goalType === "spend" && !!goal.injectIntoCashflow;

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        "border-border bg-card"
      } ${goal.isArchived ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MdFlag size={20} className="opacity-50 shrink-0" />
          <h3 className="text-base font-semibold truncate">{goal.name}</h3>
        </div>
        <Tag value={tag.value} severity={tag.severity} className="shrink-0" />
      </div>

      <div className="flex flex-wrap items-center gap-1 mt-1.5">
        <Tag
          value={goalType === "spend" ? "Spend" : "Reserve"}
          severity="secondary"
          className="text-xs !py-0.5 !px-1.5"
        />
        {injects && (
          <Tag
            value="In cashflow"
            severity="info"
            className="text-xs !py-0.5 !px-1.5"
          />
        )}
      </div>

      <p className="text-sm text-muted-foreground mt-1">
        {TRACKING_LABELS[goal.trackingMethod]}
        {goal.targetDate && <> · by {formatYearMonth(goal.targetDate)}</>}
      </p>
      {goal.description && (
        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
          {goal.description}
        </p>
      )}

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-sm mb-1">
          <span className="font-medium">
            {formatCurrency(progress.currentAmount, goal.currency)}
          </span>
          <span className="text-muted-foreground">
            of {formatCurrency(goal.targetAmount, goal.currency)} · {percent}%
          </span>
        </div>
        <ProgressBar
          value={Math.min(100, percent)}
          showValue={false}
          style={{ height: "0.5rem" }}
        />
      </div>

      {plan && plan.competingGoalIds.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          After {plan.competingGoalIds.length} other goal
          {plan.competingGoalIds.length > 1 ? "s" : ""}.
        </p>
      )}

      {warning ? (
        <p className="text-xs mt-2 text-amber-500">{warning}</p>
      ) : progress.projectedDate ? (
        <p className="text-xs text-muted-foreground mt-2">
          Projected to reach the target in{" "}
          {formatYearMonth(progress.projectedDate)}.
        </p>
      ) : goal.trackingMethod !== "manual" && progress.percentComplete < 100 ? (
        <p
          className={`text-xs mt-2 ${goal.targetDate && !progress.onTrack ? "text-amber-500" : "text-muted-foreground"}`}
        >
          Not reached within the projection horizon.
        </p>
      ) : null}

      {plan &&
        plan.requiredMonthlySaving !== null &&
        plan.requiredMonthlySaving > 0 &&
        goal.targetDate && (
          <p className="text-xs text-muted-foreground mt-1">
            Save ~{formatCurrency(plan.requiredMonthlySaving, goal.currency)}/mo
            to reach it by {formatYearMonth(goal.targetDate)}.
          </p>
        )}

      <div className="flex justify-end gap-1 mt-3">
        <Button
          icon={<MdEdit />}
          text
          rounded
          size="small"
          severity="secondary"
          aria-label="Edit goal"
          onClick={onEdit}
        />
        <Button
          icon={goal.isArchived ? <MdUnarchive /> : <MdArchive />}
          text
          rounded
          size="small"
          severity="secondary"
          aria-label={goal.isArchived ? "Unarchive goal" : "Archive goal"}
          onClick={onToggleArchive}
        />
        <Button
          icon={<MdDelete />}
          text
          rounded
          size="small"
          severity="danger"
          aria-label="Delete goal"
          onClick={onDelete}
        />
      </div>
    </div>
  );
}
