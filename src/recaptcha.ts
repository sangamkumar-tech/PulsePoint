const RECAPTCHA_SITE_KEY = '6Ld6uSsuAAAAAC5N8hGgTb7tkQMWOdqWZaoGSnPk';

declare global {
  interface Window {
    grecaptcha?: {
      enterprise: {
        ready: (cb: () => void | Promise<void>) => void;
        execute: (siteKey: string, options: { action: string }) => Promise<string>;
      };
    };
  }
}

export interface RecaptchaVerificationResult {
  token: string;
  action: string;
  verifiedAtMs: number;
}

/**
 * Runs Google reCAPTCHA Enterprise before any sign-in, sign-up, or protected session access.
 * Ensures a valid token is generated before Firebase Auth proceeds.
 */
export async function executeRecaptchaEnterprise(
  action: 'LOGIN' | 'SIGNUP' | 'SESSION_VERIFY'
): Promise<RecaptchaVerificationResult> {
  if (typeof window === 'undefined') {
    throw new Error('reCAPTCHA Enterprise requires a browser environment.');
  }

  // Wait briefly if the script is still finishing initial load
  let attempts = 0;
  while (!window.grecaptcha?.enterprise && attempts < 20) {
    await new Promise((r) => setTimeout(r, 150));
    attempts += 1;
  }

  if (!window.grecaptcha?.enterprise) {
    throw new Error(
      'reCAPTCHA Enterprise failed to load. Please disable content blockers for google.com and reload.'
    );
  }

  return new Promise<RecaptchaVerificationResult>((resolve, reject) => {
    window.grecaptcha!.enterprise.ready(async () => {
      try {
        const token = await window.grecaptcha!.enterprise.execute(RECAPTCHA_SITE_KEY, {
          action,
        });
        if (!token || typeof token !== 'string' || token.trim().length === 0) {
          reject(new Error('reCAPTCHA Enterprise returned an empty verification token.'));
          return;
        }
        resolve({
          token,
          action,
          verifiedAtMs: Date.now(),
        });
      } catch (err) {
        reject(
          err instanceof Error
            ? err
            : new Error('reCAPTCHA Enterprise verification failed. Please try again.')
        );
      }
    });
  });
}
