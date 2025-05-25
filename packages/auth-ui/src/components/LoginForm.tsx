import React from 'react';
import { loginWithPassword } from 'modelence/client';
import { Button } from './Button';
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
    <div className={`w-full max-w-md mx-auto bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 ${cardClassName}`}>
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            Sign in to your account
          </h1>
        </div>

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
            <span className="px-4 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400">Or continue with</span>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email" className={`block text-sm font-medium text-gray-900 dark:text-white mb-2 ${labelClassName}`}>
              Email
            </label>
            <input 
              type="email" 
              name="email" 
              id="email" 
              placeholder="m@example.com"
              className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 ${inputClassName}`}
              required
            />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="password" className={`text-sm font-medium text-gray-900 dark:text-white ${labelClassName}`}>
                Password
              </label>
              <a href="#" className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
                Forgot your password?
              </a>
            </div>
            <input 
              type="password" 
              name="password" 
              id="password" 
              className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white ${inputClassName}`}
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

        {renderSignupLink && (
          <p className="text-center text-sm text-gray-600 dark:text-gray-400">
            Don't have an account?{' '}
            {renderSignupLink({ 
              className: 'text-gray-900 dark:text-white underline hover:no-underline font-medium', 
              children: 'Sign up' 
            })}
          </p>
        )}
      </div>
    </div>
  );
}
