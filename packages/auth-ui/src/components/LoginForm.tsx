import React from 'react';
import { loginWithPassword } from 'modelence/client';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from './ui/Card';
import { GoogleIcon } from './icons/GoogleIcon';
import { AppleIcon } from './icons/AppleIcon';

type SignupLinkRenderer = (props: { className: string; children: React.ReactNode }) => React.ReactElement;

export interface LoginFormProps {
  renderSignupLink?: SignupLinkRenderer;
  // Styling overrides
  className?: string;
  cardClassName?: string;
  buttonClassName?: string;
  buttonVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  buttonSize?: "default" | "sm" | "lg" | "icon";
  inputClassName?: string;
  labelClassName?: string;
}

export function LoginForm({ 
  renderSignupLink,
  className = "",
  cardClassName = "",
  buttonClassName = "",
  buttonVariant = "default",
  buttonSize = "default",
  inputClassName = "",
  labelClassName = ""
}: LoginFormProps) {
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    
    await loginWithPassword({ email, password });
  };

  return (
    <Card className={`w-full max-w-md mx-auto bg-white dark:bg-gray-900 text-gray-900 dark:text-white ${cardClassName}`}>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          Sign in to your account
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-6">
        <div className="space-y-3">
          {/* <Button 
            variant="outline" 
            className="w-full h-12 flex items-center justify-center gap-3 border-gray-300 hover:bg-gray-50"
            type="button"
          >
            <AppleIcon className="w-5 h-5" />
            <span className="font-medium">Sign in with Apple</span>
          </Button> */}
          
          <Button 
            variant="outline" 
            className="w-full flex items-center justify-center gap-3"
            type="button"
          >
            <GoogleIcon className="w-5 h-5" />
            <span className="font-medium">Sign in with Google</span>
          </Button>
        </div>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400">or</span>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="email" className={`block mb-2 ${labelClassName}`}>
              Email
            </Label>
            <Input 
              type="email" 
              name="email" 
              id="email" 
              placeholder="m@example.com"
              className={inputClassName}
              required
            />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="password" className={labelClassName}>
                Password
              </Label>
              <a href="#" className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
                Forgot your password?
              </a>
            </div>
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
            Login
          </Button>
        </form>
      </CardContent>

      {renderSignupLink && (
        <CardFooter className="justify-center">
          <p className="text-center text-sm text-gray-600 dark:text-gray-400">
            Don't have an account?{' '}
            {renderSignupLink({ 
              className: 'text-gray-900 dark:text-white underline hover:no-underline font-medium', 
              children: 'Sign up' 
            })}
          </p>
        </CardFooter>
      )}
    </Card>
  );
}
