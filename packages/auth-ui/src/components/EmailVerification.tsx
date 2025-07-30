import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';

export interface EmailVerificationProps {
  status: 'success' | 'error';
  error?: string;
  className?: string;
  onDismiss?: () => void;
}

export function EmailVerification({ 
  status,
  error,
  className = '',
  onDismiss,
}: EmailVerificationProps) {
  if (status === 'error') {
    return (
      <Card className={cn('w-full max-w-md mx-auto bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', className)}>
        <CardHeader className="text-center pb-4">
          <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-800 rounded-full flex items-center justify-center mb-4">
            <svg 
              className="w-6 h-6 text-red-600 dark:text-red-400" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M6 18L18 6M6 6l12 12" 
              />
            </svg>
          </div>
          <CardTitle className="text-xl text-red-800 dark:text-red-200">
            Verification Failed
          </CardTitle>
        </CardHeader>
        
        <CardContent className="text-center space-y-4">
          <p className="text-red-700 dark:text-red-300">
            {error}
          </p>
          {onDismiss && (
            <Button
              onClick={onDismiss}
              variant="outline"
            >
              Go Back
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className={cn('w-full max-w-md mx-auto bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', className)}>
      <CardHeader className="text-center pb-4">
        <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-800 rounded-full flex items-center justify-center mb-4">
          <svg 
            className="w-6 h-6 text-green-600 dark:text-green-400" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path 
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <CardTitle className="text-xl text-green-800 dark:text-green-200">
          Email Verified Successfully
        </CardTitle>
      </CardHeader>
      
      <CardContent className="text-center space-y-4">
        <p className="text-green-700 dark:text-green-300">
          Your email address has been verified successfully.
        </p>
        <p className="text-sm text-green-600 dark:text-green-400">
          You can now access all features of your account.
        </p>
        {onDismiss && (
          <Button
            onClick={onDismiss}
          >
            Continue
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
