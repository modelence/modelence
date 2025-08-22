import { getConfig, loginWithPassword } from 'modelence/client';
import React, { useCallback, useMemo } from 'react';
import { GoogleIcon } from './icons/GoogleIcon';
import { Button } from './ui/Button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/Card';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Link, LinkRenderer } from './ui/Link';

export interface LoginFormProps {
  renderSignupLink?: LinkRenderer;
  renderForgotPasswordLink?: LinkRenderer;
  onForgotPassword?: () => void;
  onSignup?: () => void;
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
  renderForgotPasswordLink,
  onForgotPassword,
  onSignup,
  className = "",
  cardClassName = "",
  buttonClassName = "",
  buttonVariant = "default",
  buttonSize = "default",
  inputClassName = "",
  labelClassName = ""
}: LoginFormProps) {
  const isGoogleAuthEnabled = getConfig('_system.user.auth.google.enabled');

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    
    await loginWithPassword({ email, password });
  }, []);

  const openGoogleAuth = useCallback(() => {
    window.location.href = '/api/_internal/auth/google';
  }, []);

  const socialButtons = useMemo(() => {
    const buttons: JSX.Element[] = [];
    if (isGoogleAuthEnabled) {
      buttons.push(
        <Button 
          variant="outline" 
          className="w-full flex items-center justify-center gap-3"
          type="button"
          key="google"
          onClick={openGoogleAuth}
        >
          <GoogleIcon className="w-5 h-5" />
          <span className="font-medium">Sign in with Google</span>
        </Button>
      );
    }
    return buttons;
  }, []);

  return (
    <Card className={`w-full max-w-md mx-auto bg-white dark:bg-gray-900 text-gray-900 dark:text-white ${cardClassName}`}>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          Sign in to your account
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {socialButtons.length > 0 && (
          <>
            <div className="space-y-3">
              {socialButtons}
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
          </>
        )}
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
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="password" className={labelClassName}>
                Password
              </Label>
              <Link
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                linkRenderer={renderForgotPasswordLink}
                onClick={onForgotPassword}
              >
                Forgot your password?
              </Link>
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
            <Link
              className="text-gray-900 dark:text-white underline hover:no-underline font-medium"
              linkRenderer={renderSignupLink}
              onClick={onSignup}
            >
              Sign up
            </Link>
          </p>
        </CardFooter>
      )}
    </Card>
  );
}
