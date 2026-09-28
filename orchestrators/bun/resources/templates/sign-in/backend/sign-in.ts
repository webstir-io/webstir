import type { SignInOptions } from '@webstir-io/webstir-backend/sign-in';

const signIn: SignInOptions = {
  // Who may sign in. Anyone, by default: a first sign-in creates the user. An address this turns
  // away gets the same answer as any other, and no email.
  canSignIn: async () => true,

  // The email with the code and the link.
  email: ({ code, link, expiresInMinutes }) => ({
    subject: `Your sign-in code: ${code}`,
    text: `Your sign-in code is ${code}. It works for ${expiresInMinutes} minutes.\n\nOr sign in with this link:\n${link}\n\nIf you did not ask to sign in, you can ignore this email.\n`,
  }),
};

export default signIn;
