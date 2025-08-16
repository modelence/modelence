import { sendResetPasswordToken } from 'modelence/client';
import React, { useCallback, useState } from 'react';
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
}: PasswordResetFormProps) {
  const [isResetRequestSuccess, setIsResetRequestSuccess] = useState(false);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    const email = formData.get('email') as string;
    
    await sendResetPasswordToken({ email });
    setIsResetRequestSuccess(true);
  }, []);

  if (isResetRequestSuccess) {
    return (
      <Card className={`w-full max-w-md mx-auto bg-white dark:bg-gray-900 text-gray-900 dark:text-white ${cardClassName}`}>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            Check your email
          </CardTitle>
        </CardHeader>
        
        <CardContent className="text-center space-y-4">
          <p className="text-gray-600 dark:text-gray-400">
            We've sent you a password reset link. Please check your inbox and click the link to reset your password.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Don't see the email? Check your spam folder.
          </p>
          <div className="text-center pt-2">
            <Link
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              onClick={onLogin}
              linkRenderer={renderLoginLink}
            >
              Back to login
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
          Reset password
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="email" className={`block mb-2 ${labelClassName}`}>
              Email
            </Label>
            <Input 
              type="email" 
              name="email" 
              id="email" 
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
