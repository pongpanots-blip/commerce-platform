import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Default webhook signature strategy: HMAC-SHA256 over the raw request body,
 * hex-encoded, constant-time compared. Per-connector strategies can replace
 * this later; the interface is `verify(secret, rawBody, signature)`.
 */
@Injectable()
export class SignatureVerifier {
  verify(secret: string | null, rawBody: string, signature: string | undefined): boolean {
    if (!secret || !signature) {
      return false;
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  /** Convenience for producers/tests: compute the signature for a body. */
  sign(secret: string, rawBody: string): string {
    return createHmac('sha256', secret).update(rawBody).digest('hex');
  }
}
