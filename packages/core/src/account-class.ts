/** FR-1: account class is one of three, immutable after creation. */
export const ACCOUNT_CLASSES = [
  "OPERATING",
  "CLIENT_MONEY",
  "OBLIGATION_RESERVE"
] as const;

export type AccountClass = (typeof ACCOUNT_CLASSES)[number];
