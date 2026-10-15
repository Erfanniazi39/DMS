// Brute-force protection for POST /auth/login (security review H2).
//
// Failed attempts are counted in three sliding windows; while any window is full
// the login is refused with 429 BEFORE the password is checked (so a correct
// password cannot be used to probe a locked name):
//   - same username from the same address  : 5 failures / 15 min
//   - same address, any username           : 30 failures / 15 min
//   - same username, any address           : 20 failures / 15 min  (distributed or address-spoofing guessing)
// The lock is temporary and automatic — it is NOT the permanent LOCKED account
// status, so an attacker cannot lock a colleague out for good. The username is
// counted whether or not it exists, so the limiter reveals nothing about accounts.
// The address comes from the proxy headers (see frontend/src/proxy.ts). Behind the
// HTTPS proxy (deploy/README.md) it cannot be forged; a client talking to the Next.js
// server directly could fake it to dodge the two address rules, which is why the
// per-username rule (any address) exists. State is in memory (one backend process).

export type ThrottleRule = { max: number; windowMs: number };
export type ThrottleOptions = { pairRule: ThrottleRule; ipRule: ThrottleRule; userRule: ThrottleRule };

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const DEFAULT_OPTIONS: ThrottleOptions = {
  pairRule: { max: 5, windowMs: FIFTEEN_MINUTES },
  ipRule: { max: 30, windowMs: FIFTEEN_MINUTES },
  userRule: { max: 20, windowMs: FIFTEEN_MINUTES },
};
const MAX_TRACKED_KEYS = 10_000;

export type ThrottleDecision = { blocked: false } | { blocked: true; retryAfterMs: number };

export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly options: ThrottleOptions = DEFAULT_OPTIONS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private keys(ip: string, username: string) {
    const name = username.trim().toLowerCase().slice(0, 100);
    const address = ip.replace(/^::ffff:/, ''); // IPv4-mapped IPv6 form of the same address
    return [
      { key: `pair|${address}|${name}`, rule: this.options.pairRule },
      { key: `ip|${address}`, rule: this.options.ipRule },
      { key: `user|${name}`, rule: this.options.userRule },
    ];
  }

  private recent(key: string, windowMs: number) {
    const cutoff = this.now() - windowMs;
    const list = (this.failures.get(key) ?? []).filter((time) => time > cutoff);
    if (list.length === 0) this.failures.delete(key);
    else this.failures.set(key, list);
    return list;
  }

  check(ip: string, username: string): ThrottleDecision {
    let retryAfterMs = 0;
    for (const { key, rule } of this.keys(ip, username)) {
      const list = this.recent(key, rule.windowMs);
      if (list.length >= rule.max) {
        // The lock ends when enough old failures have aged out of the window.
        retryAfterMs = Math.max(retryAfterMs, list[list.length - rule.max] + rule.windowMs - this.now());
      }
    }
    return retryAfterMs > 0 ? { blocked: true, retryAfterMs } : { blocked: false };
  }

  // Returns true when this failure just filled a window (the attempt that triggers a lock).
  recordFailure(ip: string, username: string): boolean {
    if (this.failures.size > MAX_TRACKED_KEYS) this.prune();
    let triggered = false;
    for (const { key, rule } of this.keys(ip, username)) {
      const list = this.recent(key, rule.windowMs);
      list.push(this.now());
      this.failures.set(key, list);
      if (list.length === rule.max) triggered = true;
    }
    return triggered;
  }

  // A good login clears the counters of that user from that address only.
  recordSuccess(ip: string, username: string) {
    const [pair] = this.keys(ip, username);
    this.failures.delete(pair.key);
  }

  private prune() {
    const longest = Math.max(this.options.pairRule.windowMs, this.options.ipRule.windowMs, this.options.userRule.windowMs);
    const cutoff = this.now() - longest;
    for (const [key, list] of this.failures) {
      if (list.every((time) => time <= cutoff)) this.failures.delete(key);
    }
    // Still huge (an attack with endless distinct names): drop everything rather than grow without bound.
    if (this.failures.size > MAX_TRACKED_KEYS) this.failures.clear();
  }
}

export function retryMinutes(retryAfterMs: number) {
  return Math.max(1, Math.ceil(retryAfterMs / 60_000));
}
