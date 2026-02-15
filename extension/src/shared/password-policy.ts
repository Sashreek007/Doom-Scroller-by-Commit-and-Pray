export const STRONG_PASSWORD_REQUIREMENTS =
  'Use at least 10 characters, including uppercase, lowercase, a number, and a symbol.';

export interface PasswordValidationResult {
  valid: boolean;
  message: string;
}

export function validateStrongPassword(password: string): PasswordValidationResult {
  if (password.length < 10) {
    return {
      valid: false,
      message: 'Password must be at least 10 characters.',
    };
  }

  if (!/[A-Z]/.test(password)) {
    return {
      valid: false,
      message: 'Password must include at least one uppercase letter.',
    };
  }

  if (!/[a-z]/.test(password)) {
    return {
      valid: false,
      message: 'Password must include at least one lowercase letter.',
    };
  }

  if (!/[0-9]/.test(password)) {
    return {
      valid: false,
      message: 'Password must include at least one number.',
    };
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return {
      valid: false,
      message: 'Password must include at least one symbol.',
    };
  }

  return { valid: true, message: '' };
}
