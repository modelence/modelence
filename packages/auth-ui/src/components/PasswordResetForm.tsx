import { loginWithPassword } from 'modelence/client';
import React, { useCallback } from 'react';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Link, LinkRenderer } from './ui/Link';

export interface PasswordResetFormProps {
  renderLoginLink?: LinkRenderer;
  onLogin?: () => void;
  // Styling overrides
  className?: string;
  cardClassName?: string;
  buttonClassName?: string;
  buttonVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  buttonSize?: "default" | "sm" | "lg" | "icon";
  inputClassName?: string;
  labelClassName?: string;
}

export function PasswordResetForm({ 
  onLogin,
  renderLoginLink,
  className = "",
  cardClassName = "",
  buttonClassName = "",
  buttonVariant = "default",
  buttonSize = "default",
  inputClassName = "",
  labelClassName = ""
}: RequestPasswordResetFormProps) {
  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    
    await loginWithPassword({ email, password });
  }, []);

  return (
    <Card className={`w-full max-w-md mx-auto bg-white dark:bg-gray-900 text-gray-900 dark:text-white ${cardClassName}`}>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          Reset password
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="password" className={`block mb-2 ${labelClassName}`}>
              Password
            </Label>
            <Input 
              type="password"
              name="password"
              id="password"
              className={inputClassName}
              required
            />
          </div>
          <Button
            className={`w-full ${buttonClassName}`}
            variant={buttonVariant}
            size={buttonSize}
            type="submit"
          >
            Submit
          </Button>
          <div className="text-center pt-2">
            <Link
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              onClick={onLogin}
              linkRenderer={renderLoginLink}
            >
              Back to login
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
