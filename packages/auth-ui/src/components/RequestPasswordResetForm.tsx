import { loginWithPassword } from 'modelence/client';
import React, { useCallback } from 'react';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Input } from './ui/Input';
import { Label } from './ui/Label';

export interface RequestPasswordResetFormProps {
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

export function RequestPasswordResetForm({ 
  onLogin,
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
            <a
              href="#"
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              onClick={onLogin}
            >
              Back to login
            </a>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
