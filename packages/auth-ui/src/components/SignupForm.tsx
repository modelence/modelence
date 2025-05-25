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
    <div className={`w-full max-w-md mx-auto bg-white rounded-lg shadow-sm border border-gray-200 p-8 ${cardClassName}`}>
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold text-gray-900">
            Create an account
          </h1>
        </div>

        <div className="space-y-3">
          <Button 
            variant="outline" 
            className="w-full h-10 flex items-center justify-center gap-3 border-gray-300 hover:bg-gray-50"
            type="button"
          >
            <GoogleIcon className="w-5 h-5" />
            <span className="font-medium">Sign up with Google</span>
          </Button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white text-gray-500">or</span>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email" className={`block text-sm font-medium text-gray-900 mb-2 ${labelClassName}`}>
              Email
            </label>
            <input 
              type="email" 
              name="email" 
              id="email" 
              className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${inputClassName}`}
              required
            />
          </div>
          
          <div>
            <label htmlFor="password" className={`block text-sm font-medium text-gray-900 mb-2 ${labelClassName}`}>
              Password
            </label>
            <input 
              type="password" 
              name="password" 
              id="password" 
              className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${inputClassName}`}
              required
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className={`block text-sm font-medium text-gray-900 mb-2 ${labelClassName}`}>
              Confirm password
            </label>
            <input 
              type="password" 
              name="confirmPassword" 
              id="confirm-password" 
              className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${inputClassName}`}
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
                className="w-4 h-4 border border-gray-300 rounded bg-gray-50 focus:ring-3 focus:ring-blue-300"
                required
              />
            </div>
            <div className="ml-3 text-sm">
              <label htmlFor="terms" className="text-gray-500">
                I accept the <a className="font-medium text-blue-600 hover:underline" href="#">Terms and Conditions</a>
              </label>
            </div>
          </div>

          <Button
            className={`w-full h-10 bg-gray-900 hover:bg-gray-800 text-white font-medium ${buttonClassName}`}
            type="submit"
          >
            Create account
          </Button>
        </form>

        {renderLoginLink && (
          <p className="text-center text-sm text-gray-600">
            Already have an account?{' '}
            {renderLoginLink({ 
              className: 'text-gray-900 underline hover:no-underline font-medium', 
              children: 'Login here' 
            })}
          </p>
        )}
      </div>
    </div>
  );
}
