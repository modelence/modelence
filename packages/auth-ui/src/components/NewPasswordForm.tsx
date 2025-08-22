import { resetPassword } from 'modelence/client';
import React, { useCallback, useState } from 'react';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Link, LinkRenderer } from './ui/Link';

export interface NewPasswordFormProps {
  renderLoginLink?: LinkRenderer;
  onLogin?: () => void;
  token: string;
  // Styling overrides
  className?: string;
  cardClassName?: string;
  buttonClassName?: string;
  buttonVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  buttonSize?: "default" | "sm" | "lg" | "icon";
  inputClassName?: string;
  labelClassName?: string;
}

export function NewPasswordForm({ 
  onLogin,
  renderLoginLink,
  token,
  className = "",
  cardClassName = "",
  buttonClassName = "",
  buttonVariant = "default",
  buttonSize = "default",
  inputClassName = "",
  labelClassName = "",
}: NewPasswordFormProps) {
  const [isPasswordResetSuccess, setIsPasswordResetSuccess] = useState(false);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    const password = formData.get('password') as string;
    
    await resetPassword({ token, password });
    setIsPasswordResetSuccess(true);
  }, [token]);

  if (isPasswordResetSuccess) {
    return (
      <Card className={`w-full max-w-md mx-auto bg-white dark:bg-gray-900 text-gray-900 dark:text-white ${cardClassName}`}>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            Password reset successful
          </CardTitle>
        </CardHeader>
        
        <CardContent className="text-center space-y-4">
          <p className="text-gray-600 dark:text-gray-400">
            Your password has been successfully reset. You can now sign in with your new password.
          </p>
          <div className="text-center pt-2">
            <Link
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              onClick={onLogin}
              linkRenderer={renderLoginLink}
            >
              Go to login
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`w-full max-w-md mx-auto bg-white dark:bg-gray-900 text-gray-900 dark:text-white ${cardClassName}`}>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          Set a new password
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
