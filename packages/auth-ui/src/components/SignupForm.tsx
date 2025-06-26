import { signupWithPassword } from 'modelence/client';
import React from 'react';
import { Button } from './ui/Button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/Card';
import { Input } from './ui/Input';
import { Label } from './ui/Label';

type LoginLinkRenderer = (props: { className: string; children: React.ReactNode }) => React.ReactElement;

interface TermsConsent {
  type: 'terms';
  url: string;
}

interface CustomConsent {
  type: 'custom';
  content: string | React.ReactElement;
  optional?: boolean;
}

type ConsentItem = TermsConsent | CustomConsent;

export interface SignupFormProps {
  renderLoginLink?: LoginLinkRenderer;
  onError?: (error: Error) => void;
  className?: string;
  cardClassName?: string;
  buttonClassName?: string;
  buttonVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  buttonSize?: "default" | "sm" | "lg" | "icon";
  inputClassName?: string;
  labelClassName?: string;
  consents?: ConsentItem[];
}

function ConsentCheckbox({ 
  consent, 
  index,
  labelClassName
}: { 
  consent: ConsentItem; 
  index: number; 
  labelClassName: string;
}) {
  const checkboxId = `consent-${index}`;
  const isRequired = consent.type === 'terms' || consent.optional !== true;
  
  const content = consent.type === 'terms' 
    ? <span>I accept the <a className="font-medium text-blue-600 dark:text-blue-400 hover:underline" href={consent.url} target="_blank">Terms and Conditions</a></span>
    : <span>{consent.content}</span>;

  return (
    <div className="flex items-start">
      <div className="flex items-center h-5">
        <input
          id={checkboxId}
          aria-describedby={checkboxId}
          type="checkbox"
          name={checkboxId}
          className="w-4 h-4 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-800 focus:ring-3 focus:ring-blue-300 dark:focus:ring-blue-600"
          required={isRequired}
        />
      </div>
      <div className="ml-3 text-sm">
        <Label htmlFor={checkboxId} className="text-gray-600 dark:text-gray-400">
          {content}
        </Label>
      </div>
    </div>
  );
}

export function SignupForm({ 
  renderLoginLink,
  onError = (error: Error) => { console.error(error); },
  className = "",
  cardClassName = "",
  buttonClassName = "",
  buttonVariant = "default",
  buttonSize = "default",
  inputClassName = "",
  labelClassName = "",
  consents
}: SignupFormProps) {
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    const email = String(formData.get('email'));
    const password = String(formData.get('password'));
    const confirmPassword = String(formData.get('confirmPassword'));
    
    if (password !== confirmPassword) {
      onError(new Error('Passwords do not match'));
      return;
    }
    
    await signupWithPassword({ email, password });
  };

  return (
    <Card className={`w-full max-w-md mx-auto bg-white dark:bg-gray-900 text-gray-900 dark:text-white ${cardClassName}`}>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          Create an account
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* <div className="space-y-3">
          <Button 
            variant="outline" 
            className="w-full flex items-center justify-center gap-3"
            type="button"
          >
            <GoogleIcon className="w-5 h-5" />
            <span className="font-medium">Sign up with Google</span>
          </Button>
        </div> */}

        {/* <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400">or</span>
          </div>
        </div> */}

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

          <div>
            <Label htmlFor="confirm-password" className={`block mb-2 ${labelClassName}`}>
              Confirm password
            </Label>
            <Input 
              type="password" 
              name="confirmPassword" 
              id="confirm-password" 
              className={inputClassName}
              required
            />
          </div>

          {consents?.map((consent, index) => {
            return <ConsentCheckbox key={index} consent={consent} index={index} labelClassName={labelClassName} />;
          })}

          <Button
            className={`w-full ${buttonClassName}`}
            variant={buttonVariant}
            size={buttonSize}
            type="submit"
          >
            Create account
          </Button>
        </form>
      </CardContent>

      {renderLoginLink && (
        <CardFooter className="justify-center">
          <p className="text-center text-sm text-gray-600 dark:text-gray-400">
            Already have an account?{' '}
            {renderLoginLink({ 
              className: 'text-gray-900 dark:text-white underline hover:no-underline font-medium', 
              children: 'Sign in here' 
            })}
          </p>
        </CardFooter>
      )}
    </Card>
  );
}