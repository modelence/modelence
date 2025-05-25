import React from 'react';
import { signupWithPassword } from 'modelence/client';
import { Button } from './Button';
import { GoogleIcon } from './icons/GoogleIcon';

type LoginLinkRenderer = (props: { className: string; children: React.ReactNode }) => React.ReactElement;

export interface SignupFormProps {
  renderLoginLink?: LoginLinkRenderer;
  onPasswordMismatch?: (message: string) => void;
  // Styling overrides
  className?: string;
  cardClassName?: string;
  buttonClassName?: string;
  buttonVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  buttonSize?: "default" | "sm" | "lg" | "icon";
  inputClassName?: string;
  labelClassName?: string;
}

export function SignupForm({ 
  renderLoginLink,
  onPasswordMismatch,
  className = "",
  cardClassName = "",
  buttonClassName = "",
  buttonVariant = "default",
  buttonSize = "default",
  inputClassName = "",
  labelClassName = ""
}: SignupFormProps) {
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    const email = String(formData.get('email'));
    const password = String(formData.get('password'));
    const confirmPassword = String(formData.get('confirmPassword'));
    
    if (password !== confirmPassword) {
      if (onPasswordMismatch) {
        onPasswordMismatch('Passwords do not match');
      } else {
        alert('Passwords do not match');
      }
      return;
    }
    
    await signupWithPassword({ email, password });
  };

  return (
    <div className={`w-full max-w-md mx-auto bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 ${cardClassName}`}>
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            Create an account
          </h1>
        </div>

        <div className="space-y-3">
          <Button 
            variant="outline" 
            className="w-full flex items-center justify-center gap-3"
            type="button"
          >
            <GoogleIcon className="w-5 h-5" />
            <span className="font-medium">Sign up with Google</span>
          </Button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400">or</span>
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
              className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 ${inputClassName}`}
              required
            />
          </div>
          
          <div>
            <label htmlFor="password" className={`block text-sm font-medium text-gray-900 dark:text-white mb-2 ${labelClassName}`}>
              Password
            </label>
            <input 
              type="password" 
              name="password" 
              id="password" 
              className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white ${inputClassName}`}
              required
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className={`block text-sm font-medium text-gray-900 dark:text-white mb-2 ${labelClassName}`}>
              Confirm password
            </label>
            <input 
              type="password" 
              name="confirmPassword" 
              id="confirm-password" 
              className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white ${inputClassName}`}
              required
            />
          </div>

          <div className="flex items-start">
            <div className="flex items-center h-5">
              <input
                id="terms"
                aria-describedby="terms"
                type="checkbox"
                name="terms"
                className="w-4 h-4 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-800 focus:ring-3 focus:ring-blue-300 dark:focus:ring-blue-600"
                required
              />
            </div>
            <div className="ml-3 text-sm">
              <label htmlFor="terms" className="text-gray-500 dark:text-gray-400">
                I accept the <a className="font-medium text-blue-600 dark:text-blue-400 hover:underline" href="#">Terms and Conditions</a>
              </label>
            </div>
          </div>

          <Button
            className={`w-full ${buttonClassName}`}
            variant={buttonVariant}
            size={buttonSize}
            type="submit"
          >
            Create account
          </Button>
        </form>

        {renderLoginLink && (
          <p className="text-center text-sm text-gray-600 dark:text-gray-400">
            Already have an account?{' '}
            {renderLoginLink({ 
              className: 'text-gray-900 dark:text-white underline hover:no-underline font-medium', 
              children: 'Login here' 
            })}
          </p>
        )}
      </div>
    </div>
  );
}
