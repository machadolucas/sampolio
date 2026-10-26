'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type Ref,
} from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { passwordPolicySchema } from '@/lib/schemas/auth.schema';
import { cn } from './cn';

export function InputText({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      data-slot="input"
      className={cn('ui-input', className)}
      {...props}
    />
  );
}
export const Input = InputText;
export function InputTextarea({
  className,
  autoResize,
  ref,
  onChange,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  autoResize?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const input = useRef<HTMLTextAreaElement | null>(null);
  const resize = () => {
    if (autoResize && input.current) {
      input.current.style.height = 'auto';
      input.current.style.height = `${input.current.scrollHeight}px`;
    }
  };
  useLayoutEffect(resize, [autoResize, props.value]);
  return (
    <textarea
      {...props}
      ref={(node) => {
        input.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      data-slot="textarea"
      className={cn(
        'ui-input min-h-24',
        autoResize ? 'resize-none overflow-hidden' : 'resize-y',
        className,
      )}
      onChange={(event) => {
        onChange?.(event);
        resize();
      }}
    />
  );
}
export function Password({
  inputId,
  inputClassName,
  className,
  toggleMask,
  feedback = true,
  promptLabel = 'Choose a password',
  weakLabel = 'Password needs more variety',
  mediumLabel = 'Meets password requirements',
  strongLabel = 'Strong password',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  inputId?: string;
  inputClassName?: string;
  toggleMask?: boolean;
  feedback?: boolean;
  promptLabel?: string;
  weakLabel?: string;
  mediumLabel?: string;
  strongLabel?: string;
}) {
  const [show, setShow] = useState(false);
  const value = String(props.value ?? '');
  const valid = passwordPolicySchema.safeParse(value).success;
  const description = !value
    ? promptLabel
    : valid
      ? value.length >= 12
        ? strongLabel
        : mediumLabel
      : weakLabel;
  return (
    <span className={cn('block', className)}>
      <span className="relative block">
        <InputText
          {...props}
          id={inputId ?? props.id}
          type={show ? 'text' : 'password'}
          className={cn(toggleMask && 'pr-12', inputClassName)}
        />
        {toggleMask && (
          <button
            type="button"
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            className="absolute inset-y-0 right-0 flex min-w-11 items-center justify-center"
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </span>
      {feedback && (
        <small className="mt-1 block text-muted-foreground">
          {description}
        </small>
      )}
    </span>
  );
}
