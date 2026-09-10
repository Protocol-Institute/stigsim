export const AUTHENTICATE_MESSAGE = "authenticate" as const;
export const AUTH_REQUIRED_CLOSE_CODE = 4003;

export interface OnlineIdentity {
  userId: string;
  email: string;
}

export type AuthenticateMessage = {
  type: typeof AUTHENTICATE_MESSAGE;
  token: string;
};
