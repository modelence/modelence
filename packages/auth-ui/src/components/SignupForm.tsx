export interface SignupFormProps {
  onSignup?: (data: { email: string; password: string; handle: string }) => void;
  loading?: boolean;
  error?: string;
}

export function SignupForm({ onSignup, loading, error }: SignupFormProps) {
  // TODO: Implement signup form
  return (
    <div>
      <h2>Signup Form</h2>
      <p>Signup form component - implementation to be added</p>
    </div>
  );
}
