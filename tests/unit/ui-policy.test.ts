import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Sign Up UI presence', () => {
  it('exposes Sign Up on SignInForm for customer/driver/merchant flows', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'app/src/components/SignInForm.tsx'),
      'utf8',
    );
    expect(source).toContain('Sign Up');
    expect(source).toContain("expectedRole === 'CUSTOMER'");
    expect(source).toContain('SignUpForm');
    expect(source).not.toContain("expectedRole === 'ADMIN'");
  });

  it('does not offer public admin registration in SignUpForm', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'app/src/components/SignUpForm.tsx'),
      'utf8',
    );
    expect(source).toContain('Administrator registration is not available');
    expect(source).not.toMatch(/option value="ADMIN"/);
  });
});

describe('wallet access policy source', () => {
  it('requires customer or admin for wallet API', () => {
    const source = readFileSync(path.join(process.cwd(), 'app/api/wallet/route.ts'), 'utf8');
    expect(source).toContain("role !== 'CUSTOMER'");
    expect(source).toContain("requireUser(['CUSTOMER'])");
    expect(source).not.toMatch(/availableCents:\s*req\.body/);
  });

  it('guards admin wallet routes with withAdmin', () => {
    const source = readFileSync(path.join(process.cwd(), 'app/api/admin/wallet/route.ts'), 'utf8');
    expect(source).toContain('withAdmin');
    expect(source).toContain('reason');
  });
});
