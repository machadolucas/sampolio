'use client';

import { useEffect, useState, useId } from 'react';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InputText } from '@/components/ui/input-text';
import { InputNumber } from '@/components/ui/input-number';
import { Dropdown } from '@/components/ui/dropdown';
import { SelectButton } from '@/components/ui/select-button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { MdSave, MdClose } from 'react-icons/md';
import { useToast } from '@/components/providers/toast-provider';
import { CURRENCIES } from '@/lib/constants';
import { createGoal, updateGoal } from '@/lib/actions/goals';
import { notifyDataChanged } from '@/lib/hooks/use-data-refresh';
import { goalSchema, type GoalFormData } from '@/lib/schemas/goal.schema';
import type { FinancialAccount, Goal } from '@/types';

const TRACKING_OPTIONS = [
  { label: 'Account balance', value: 'account-balance' },
  { label: 'Net worth', value: 'net-worth' },
  { label: 'Manual', value: 'manual' },
];

const GOAL_TYPE_OPTIONS = [
  { label: 'Keep as reserve', value: 'reserve' },
  { label: 'Spend at target', value: 'spend' },
];

const yearMonthToDate = (ym: string | undefined): Date | null =>
  ym && /^\d{4}-\d{2}$/.test(ym)
    ? new Date(parseInt(ym.slice(0, 4)), parseInt(ym.slice(5, 7)) - 1, 1)
    : null;
const dateToYearMonth = (d: Date | null | undefined): string =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';

export function GoalDialog({
  visible,
  goal,
  accounts,
  onHide,
  onSaved,
}: {
  visible: boolean;
  // null → create; set → edit.
  goal: Goal | null;
  accounts: FinancialAccount[];
  onHide: () => void;
  onSaved: () => void;
}) {
  const uid = useId();
  const toast = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<GoalFormData>({
    resolver: zodResolver(goalSchema),
    defaultValues: {
      name: '',
      description: '',
      targetAmount: 0,
      currency: 'EUR',
      targetDate: '',
      trackingMethod: 'account-balance',
      linkedAccountId: '',
      currentManualAmount: 0,
      goalType: 'reserve',
      priority: null,
      injectIntoCashflow: false,
    },
  });

  const trackingMethod = watch('trackingMethod');
  const goalType = watch('goalType');
  const targetDate = watch('targetDate');

  useEffect(() => {
    if (visible) {
      reset({
        name: goal?.name ?? '',
        description: goal?.description ?? '',
        targetAmount: goal?.targetAmount ?? 0,
        currency:
          goal?.currency ??
          accounts.find((a) => !a.isArchived)?.currency ??
          'EUR',
        targetDate: goal?.targetDate ?? '',
        trackingMethod: goal?.trackingMethod ?? 'account-balance',
        linkedAccountId: goal?.linkedAccountId ?? '',
        currentManualAmount: goal?.currentManualAmount ?? 0,
        goalType: goal?.goalType ?? 'reserve',
        priority: goal?.priority ?? null,
        injectIntoCashflow: goal?.injectIntoCashflow ?? false,
      });
    }
  }, [visible, goal, accounts, reset]);

  // The inject checkbox only applies to a spend goal, tracked against an
  // account balance, with a target date set — hide it otherwise so the form
  // never shows a control the schema would reject.
  const canInject =
    goalType === 'spend' &&
    trackingMethod === 'account-balance' &&
    !!targetDate;

  // Clear a hidden `injectIntoCashflow` as soon as its prerequisites stop
  // applying: the resolver validates before handleSave runs, so a stale `true`
  // on the hidden checkbox would otherwise block Save. Re-checked against the
  // live values so the reset-on-open (same commit) never clears a valid flag.
  useEffect(() => {
    if (canInject) return;
    const v = getValues();
    const applies =
      v.goalType === 'spend' &&
      v.trackingMethod === 'account-balance' &&
      !!v.targetDate;
    if (!applies && v.injectIntoCashflow)
      setValue('injectIntoCashflow', false, { shouldValidate: false });
  }, [canInject, getValues, setValue]);

  const accountOptions = accounts
    .filter((a) => !a.isArchived || a.id === goal?.linkedAccountId)
    .map((a) => ({
      label: a.isArchived ? `${a.name} (archived)` : a.name,
      value: a.id,
    }));

  const handleSave = async (data: GoalFormData) => {
    setIsSaving(true);
    try {
      const payload = {
        name: data.name,
        description: data.description || undefined,
        targetAmount: data.targetAmount,
        currency: data.currency,
        targetDate: data.targetDate || undefined,
        trackingMethod: data.trackingMethod,
        linkedAccountId:
          data.trackingMethod === 'account-balance'
            ? data.linkedAccountId || undefined
            : undefined,
        currentManualAmount:
          data.trackingMethod === 'manual'
            ? (data.currentManualAmount ?? 0)
            : undefined,
        goalType: data.goalType,
        // Explicit null (never undefined) so a cleared priority actually clears
        // the stored value — undefined is dropped by server-action serialization.
        priority: data.priority ?? null,
        injectIntoCashflow:
          data.goalType === 'spend' &&
          data.trackingMethod === 'account-balance' &&
          !!data.targetDate
            ? !!data.injectIntoCashflow
            : false,
      };
      const result = goal
        ? await updateGoal(goal.id, payload)
        : await createGoal(payload);
      if (result.success) {
        toast.success(goal ? 'Goal updated' : 'Goal created', data.name);
        notifyDataChanged();
        onSaved();
        onHide();
      } else {
        toast.error('Error', result.error || 'Failed to save goal');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Enter submits: the body is a <form>, and the footer's primary button is
  // tied to it through the `form` attribute (the footer renders outside it).
  const onFormSubmit = useFormSubmit(() => handleSubmit(handleSave)(), {
    disabled: isSaving,
  });

  const footer = (
    <div className="flex justify-end gap-2">
      <Button
        type="button"
        label="Cancel"
        icon={<MdClose />}
        severity="secondary"
        text
        onClick={onHide}
        disabled={isSaving}
      />
      <Button
        type="submit"
        form={`${uid}-form`}
        label={goal ? 'Save' : 'Create goal'}
        icon={<MdSave />}
        loading={isSaving}
      />
    </div>
  );

  return (
    <Dialog
      header={goal ? 'Edit goal' : 'New goal'}
      visible={visible}
      onHide={onHide}
      footer={footer}
      style={{ width: '30rem' }}
      modal
      closable
      draggable={false}
    >
      <form
        id={`${uid}-form`}
        className="space-y-4"
        onSubmit={onFormSubmit}
        noValidate
      >
        <div>
          <label
            htmlFor={`${uid}-goal-name`}
            className="block text-sm font-medium mb-1"
          >
            Name
          </label>
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <InputText
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? `${uid}-name-error` : undefined}
                id={`${uid}-goal-name`}
                value={field.value}
                onChange={(e) => field.onChange(e.target.value)}
                className="w-full"
                placeholder="e.g. Emergency fund"
              />
            )}
          />
          {errors.name && (
            <small
              id={`${uid}-name-error`}
              role="alert"
              className="text-red-500"
            >
              {errors.name.message}
            </small>
          )}
        </div>

        <div>
          <label
            htmlFor={`${uid}-goal-description`}
            className="block text-sm font-medium mb-1"
          >
            Description <span className="text-muted-foreground">(optional)</span>
          </label>
          <Controller
            name="description"
            control={control}
            render={({ field }) => (
              <InputText
                id={`${uid}-goal-description`}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(e.target.value)}
                className="w-full"
              />
            )}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor={`${uid}-goal-target`}
              className="block text-sm font-medium mb-1"
            >
              Target amount
            </label>
            <Controller
              name="targetAmount"
              control={control}
              render={({ field }) => (
                <InputNumber
                  aria-invalid={!!errors.targetAmount}
                  aria-describedby={
                    errors.targetAmount
                      ? `${uid}-targetAmount-error`
                      : undefined
                  }
                  inputId={`${uid}-goal-target`}
                  value={field.value}
                  onValueChange={(e) => field.onChange(e.value ?? 0)}
                  mode="decimal"
                  locale="fi-FI"
                  minFractionDigits={0}
                  maxFractionDigits={2}
                  className="w-full"
                />
              )}
            />
            {errors.targetAmount && (
              <small
                id={`${uid}-targetAmount-error`}
                role="alert"
                className="text-red-500"
              >
                {errors.targetAmount.message}
              </small>
            )}
          </div>
          <div>
            <label
              htmlFor={`${uid}-goal-currency`}
              className="block text-sm font-medium mb-1"
            >
              Currency
            </label>
            <Controller
              name="currency"
              control={control}
              render={({ field }) => (
                <Dropdown
                  inputId={`${uid}-goal-currency`}
                  value={field.value}
                  onChange={(e) => field.onChange(e.value)}
                  options={CURRENCIES.map((c) => ({
                    label: `${c.value} — ${c.label}`,
                    value: c.value,
                  }))}
                  className="w-full"
                />
              )}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor={`${uid}-goal-target-date`}
            className="block text-sm font-medium mb-1"
          >
            Target date <span className="text-muted-foreground">(optional)</span>
          </label>
          <Controller
            name="targetDate"
            control={control}
            render={({ field }) => (
              <Calendar
                inputId={`${uid}-goal-target-date`}
                value={yearMonthToDate(field.value)}
                onChange={(e) =>
                  field.onChange(dateToYearMonth(e.value as Date | null))
                }
                view="month"
                dateFormat="mm/yy"
                className="w-full"
                showButtonBar
              />
            )}
          />
        </div>

        <div>
          <label
            id={`${uid}-track-against`}
            className="block text-sm font-medium mb-1"
          >
            Track against
          </label>
          <Controller
            name="trackingMethod"
            control={control}
            render={({ field }) => (
              <SelectButton
                aria-labelledby={`${uid}-track-against`}
                value={field.value}
                onChange={(e) => {
                  if (e.value) field.onChange(e.value);
                }}
                options={TRACKING_OPTIONS}
                className="w-full"
              />
            )}
          />
        </div>

        <div>
          <label
            id={`${uid}-goal-type`}
            className="block text-sm font-medium mb-1"
          >
            Goal type
          </label>
          <Controller
            name="goalType"
            control={control}
            render={({ field }) => (
              <SelectButton
                aria-labelledby={`${uid}-goal-type`}
                value={field.value ?? 'reserve'}
                onChange={(e) => {
                  if (e.value) field.onChange(e.value);
                }}
                options={GOAL_TYPE_OPTIONS}
                className="w-full"
              />
            )}
          />
          <p className="text-xs text-muted-foreground mt-1">
            A reserve is money you set aside and keep; a spend goal is an amount
            you plan to actually spend at the target date.
          </p>
        </div>

        {trackingMethod === 'account-balance' && (
          <div>
            <label
              htmlFor={`${uid}-goal-account`}
              className="block text-sm font-medium mb-1"
            >
              Account
            </label>
            <Controller
              name="linkedAccountId"
              control={control}
              render={({ field }) => (
                <Dropdown
                  aria-invalid={!!errors.linkedAccountId}
                  aria-describedby={
                    errors.linkedAccountId
                      ? `${uid}-linkedAccountId-error`
                      : undefined
                  }
                  inputId={`${uid}-goal-account`}
                  value={field.value || null}
                  onChange={(e) => field.onChange(e.value ?? '')}
                  options={accountOptions}
                  placeholder="Select an account"
                  className="w-full"
                />
              )}
            />
            {errors.linkedAccountId && (
              <small
                id={`${uid}-linkedAccountId-error`}
                role="alert"
                className="text-red-500"
              >
                {errors.linkedAccountId.message}
              </small>
            )}
          </div>
        )}

        {canInject && (
          <div className="flex items-start gap-2">
            <Controller
              name="injectIntoCashflow"
              control={control}
              render={({ field }) => (
                <Checkbox
                  aria-invalid={!!errors.injectIntoCashflow}
                  aria-describedby={
                    errors.injectIntoCashflow
                      ? `${uid}-injectIntoCashflow-error`
                      : undefined
                  }
                  inputId={`${uid}-goal-inject`}
                  checked={!!field.value}
                  onChange={(e) => field.onChange(!!e.checked)}
                />
              )}
            />
            <label htmlFor={`${uid}-goal-inject`} className="text-sm">
              Add the target amount as a read-only expense in the linked
              account&apos;s cashflow at the target month.
            </label>
          </div>
        )}
        {/* Fallback: shown even when the checkbox is hidden, so a failed save is never silent. */}
        {errors.injectIntoCashflow && (
          <small
            id={`${uid}-injectIntoCashflow-error`}
            role="alert"
            className="block text-red-500"
          >
            {errors.injectIntoCashflow.message}
          </small>
        )}

        <div>
          <label
            htmlFor={`${uid}-goal-priority`}
            className="block text-sm font-medium mb-1"
          >
            Priority <span className="text-muted-foreground">(optional)</span>
          </label>
          <Controller
            name="priority"
            control={control}
            render={({ field }) => (
              <InputNumber
                aria-invalid={!!errors.priority}
                aria-describedby={
                  errors.priority ? `${uid}-priority-error` : undefined
                }
                inputId={`${uid}-goal-priority`}
                value={field.value ?? null}
                onValueChange={(e) => field.onChange(e.value ?? null)}
                mode="decimal"
                min={1}
                max={999}
                showButtons
                className="w-full"
              />
            )}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Lower = funded first; leave empty to order by target date.
          </p>
          {errors.priority && (
            <small
              id={`${uid}-priority-error`}
              role="alert"
              className="text-red-500"
            >
              {errors.priority.message}
            </small>
          )}
        </div>

        {trackingMethod === 'manual' && (
          <div>
            <label
              htmlFor={`${uid}-goal-manual`}
              className="block text-sm font-medium mb-1"
            >
              Current amount
            </label>
            <Controller
              name="currentManualAmount"
              control={control}
              render={({ field }) => (
                <InputNumber
                  inputId={`${uid}-goal-manual`}
                  value={field.value ?? 0}
                  onValueChange={(e) => field.onChange(e.value ?? 0)}
                  mode="decimal"
                  locale="fi-FI"
                  minFractionDigits={0}
                  maxFractionDigits={2}
                  className="w-full"
                />
              )}
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Progress is shown in the goal&apos;s currency; amounts from accounts
          in other currencies are not converted.
        </p>
      </form>
    </Dialog>
  );
}
