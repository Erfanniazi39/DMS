import { LoginThrottle } from './login-throttle';

function make() {
  let time = 1_000_000;
  const throttle = new LoginThrottle(undefined, () => time);
  return { throttle, advance: (ms: number) => (time += ms) };
}

describe('LoginThrottle', () => {
  it('lets the first failures through and blocks the 6th attempt for the same user and address', () => {
    const { throttle } = make();
    for (let i = 0; i < 5; i++) {
      expect(throttle.check('1.1.1.1', 'Ali')).toEqual({ blocked: false });
      throttle.recordFailure('1.1.1.1', 'Ali');
    }
    const decision = throttle.check('1.1.1.1', 'Ali');
    expect(decision.blocked).toBe(true);
    if (decision.blocked) expect(decision.retryAfterMs).toBeGreaterThan(14 * 60_000);
  });

  it('treats the username case-insensitively and counts names that do not exist', () => {
    const { throttle } = make();
    for (let i = 0; i < 5; i++) throttle.recordFailure('1.1.1.1', i % 2 ? 'ALI' : 'ali');
    expect(throttle.check('1.1.1.1', 'Ali').blocked).toBe(true);
  });

  it('does not block another user from the same address, nor the same user from another address', () => {
    const { throttle } = make();
    for (let i = 0; i < 5; i++) throttle.recordFailure('1.1.1.1', 'ali');
    expect(throttle.check('1.1.1.1', 'bob').blocked).toBe(false);
    expect(throttle.check('2.2.2.2', 'ali').blocked).toBe(false);
  });

  it('unblocks automatically once the window has passed', () => {
    const { throttle, advance } = make();
    for (let i = 0; i < 5; i++) throttle.recordFailure('1.1.1.1', 'ali');
    expect(throttle.check('1.1.1.1', 'ali').blocked).toBe(true);
    advance(15 * 60_000 + 1);
    expect(throttle.check('1.1.1.1', 'ali').blocked).toBe(false);
  });

  it('blocks an address that tries many different usernames, and a username attacked from many addresses', () => {
    const { throttle } = make();
    for (let i = 0; i < 30; i++) throttle.recordFailure('9.9.9.9', `user${i}`);
    expect(throttle.check('9.9.9.9', 'someone-new').blocked).toBe(true);
    const other = make().throttle;
    for (let i = 0; i < 20; i++) other.recordFailure(`10.0.0.${i}`, 'admin');
    expect(other.check('10.0.1.1', 'admin').blocked).toBe(true);
  });

  it('treats ::ffff:1.2.3.4 and 1.2.3.4 as the same address', () => {
    const { throttle } = make();
    for (let i = 0; i < 5; i++) throttle.recordFailure(i % 2 ? '::ffff:1.1.1.1' : '1.1.1.1', 'ali');
    expect(throttle.check('1.1.1.1', 'ali').blocked).toBe(true);
  });

  it('a successful login clears that user\'s counter from that address', () => {
    const { throttle } = make();
    for (let i = 0; i < 4; i++) throttle.recordFailure('1.1.1.1', 'ali');
    throttle.recordSuccess('1.1.1.1', 'ali');
    for (let i = 0; i < 4; i++) throttle.recordFailure('1.1.1.1', 'ali');
    expect(throttle.check('1.1.1.1', 'ali').blocked).toBe(false);
  });

  it('reports the failure that triggers a lock (for the audit log)', () => {
    const { throttle } = make();
    const results = Array.from({ length: 5 }, () => throttle.recordFailure('1.1.1.1', 'ali'));
    expect(results).toEqual([false, false, false, false, true]);
  });
});
