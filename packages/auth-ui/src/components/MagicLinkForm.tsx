import { sendMagicLink } from "modelence/client";
import React, { useCallback, useState } from "react";
import { Button } from "./ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/Card";
import { Input } from "./ui/Input";
import { Label } from "./ui/Label";
import { Link, LinkRenderer } from "./ui/Link";

export interface MagicLinkFormProps {
  renderLoginLink?: LinkRenderer;
  onLogin?: () => void;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  // Styling overrides
  className?: string;
  cardClassName?: string;
  buttonClassName?: string;
  buttonVariant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  buttonSize?: "default" | "sm" | "lg" | "icon";
  inputClassName?: string;
  labelClassName?: string;
}

export function MagicLinkForm({
  renderLoginLink,
  onLogin,
  onSuccess,
  onError,
  className = "",
  cardClassName = "",
  buttonClassName = "",
  buttonVariant = "default",
  buttonSize = "default",
  inputClassName = "",
  labelClassName = "",
}: MagicLinkFormProps) {
  const [isSent, setIsSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const email = String(
        new FormData(event.currentTarget).get("email") ?? "",
      );

      setError(null);
      setIsSubmitting(true);

      try {
        await sendMagicLink({ email });
        setIsSent(true);
      } catch (cause) {
        const requestError =
          cause instanceof Error
            ? cause
            : new Error("Unable to send sign-in link");
        setError(requestError.message);
        onError?.(requestError);
        return;
      } finally {
        setIsSubmitting(false);
      }

      onSuccess?.();
    },
    [onError, onSuccess],
  );

  const loginLink = (onLogin || renderLoginLink) && (
    <div className="text-center pt-2">
      <Link
        className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        onClick={onLogin}
        linkRenderer={renderLoginLink}
      >
        Back to login
      </Link>
    </div>
  );

  if (isSent) {
    return (
      <div className={className}>
        <Card
          className={`w-full max-w-md mx-auto bg-white dark:bg-gray-900 text-gray-900 dark:text-white ${cardClassName}`}
        >
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Check your email</CardTitle>
          </CardHeader>

          <CardContent className="text-center space-y-4">
            <p className="text-gray-600 dark:text-gray-400">
              If your email is eligible, we&apos;ve sent a sign-in link.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500">
              Use the link in the email to finish signing in. Don&apos;t see it?
              Check your spam folder.
            </p>
            {loginLink}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={className}>
      <Card
        className={`w-full max-w-md mx-auto bg-white dark:bg-gray-900 text-gray-900 dark:text-white ${cardClassName}`}
      >
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Sign in with email</CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          <p className="text-center text-sm text-gray-600 dark:text-gray-400">
            We&apos;ll email you a secure sign-in link.
          </p>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <Label
                htmlFor="magic-link-email"
                className={`block mb-2 ${labelClassName}`}
              >
                Email
              </Label>
              <Input
                type="email"
                name="email"
                id="magic-link-email"
                autoComplete="email"
                className={inputClassName}
                required
              />
            </div>

            {error && (
              <p
                className="text-sm text-red-600 dark:text-red-400"
                role="alert"
              >
                {error}
              </p>
            )}

            <Button
              className={`w-full ${buttonClassName}`}
              variant={buttonVariant}
              size={buttonSize}
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Sending sign-in link…"
                : "Email me a sign-in link"}
            </Button>

            {loginLink}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
