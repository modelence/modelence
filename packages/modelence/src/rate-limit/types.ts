export type RateLimitType = 'ip' | 'user';

export type RateLimitRule = {
  /** Logical action being limited, e.g. "signup" */
  bucket: string;

  /** Identifier type of the actor this rule applies to */
  type: RateLimitType;

  /** Time window size in milliseconds */
  window: number;

  /** Maximum allowed hits within the window */
  limit: number;
};
