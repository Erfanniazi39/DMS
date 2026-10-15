import { HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { LoginThrottle } from './login-throttle';

function setup(loginStatus: Record<string, unknown>) {
  const authService = {
    attemptLogin: jest.fn().mockResolvedValue(loginStatus),
    getPermissionNames: jest.fn().mockReturnValue([]),
    recordLogin: jest.fn(),
  };
  const audit = { log: jest.fn() };
  const throttle = new LoginThrottle();
  const controller = new AuthController(authService as never, audit as never, throttle, {} as never);
  const req = { ip: '5.5.5.5', session: {} } as never;
  return { controller, authService, audit, req };
}

describe('AuthController login throttling', () => {
  it('answers 429 after repeated failures — and does not even check the password then', async () => {
    const { controller, authService, req } = setup({ status: 'invalid_password' });
    for (let i = 0; i < 5; i++) await expect(controller.login({ username: 'ali', password: 'x' }, req)).rejects.toBeInstanceOf(UnauthorizedException);
    const blocked = controller.login({ username: 'ali', password: 'the-correct-one' }, req);
    await expect(blocked).rejects.toBeInstanceOf(HttpException);
    await blocked.catch((error: HttpException) => expect(error.getStatus()).toBe(429));
    expect(authService.attemptLogin).toHaveBeenCalledTimes(5);
  });

  it('writes one LOGIN_THROTTLED audit row when the lock starts', async () => {
    const { controller, audit, req } = setup({ status: 'not_found' });
    for (let i = 0; i < 5; i++) await controller.login({ username: 'ghost', password: 'x' }, req).catch(() => undefined);
    const throttled = audit.log.mock.calls.filter(([entry]) => entry.action === 'LOGIN_THROTTLED');
    expect(throttled).toHaveLength(1);
  });
});
