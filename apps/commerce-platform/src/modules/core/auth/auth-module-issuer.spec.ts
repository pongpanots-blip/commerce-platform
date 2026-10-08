import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from './auth.module';
import { COMMERCE_JWT_ISSUER } from '../../../shared-kernel/presentation/jwt-issuer';

// Every access token the module's JwtService signs (staff login, portal login, refresh) carries iss, which the
// winback guard uses to pick the commerce secret without trying josh's.
it('AuthModule signs with the commerce issuer', () => {
  const jwt = (Reflect.getMetadata('imports', AuthModule) as Array<{ module?: unknown; providers?: Array<{ provide?: unknown; useValue?: { signOptions?: { issuer?: string } } }> }>)
    .find(m => m?.module === JwtModule);
  const options = jwt?.providers?.find(p => p.useValue?.signOptions)?.useValue;
  expect(options?.signOptions?.issuer).toBe(COMMERCE_JWT_ISSUER);
});
