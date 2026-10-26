import { readFileSync } from 'node:fs';

export type NetworkCounters = { name: string; received: number; sent: number };
export function parseNetworkCounters(source: string): NetworkCounters[] {
  return source.split('\n').flatMap(line => {
    const match = /^\s*([^:]+):\s*(.*)$/.exec(line);
    if (!match || match[1] === 'lo') return [];
    const fields = match[2]!.trim().split(/\s+/).map(Number);
    const received = fields[0], sent = fields[8];
    return Number.isSafeInteger(received) && received! >= 0 && Number.isSafeInteger(sent) && sent! >= 0
      ? [{ name: match[1]!, received: received!, sent: sent! }] : [];
  });
}
type Point = { at: number; inbound: number; outbound: number };
/** Rates are bytes/second. Keep only a bounded in-memory window; never read payloads. */
export class RelayBandwidth {
  private previous: { at: number; counters: NetworkCounters[] } | undefined;
  private history: Point[] = [];
  private error: string | null = null;
  constructor(private interfaces: string[] = [], private capacityMbps: number | null = null,
    private read = () => readFileSync('/proc/net/dev', 'utf8'), private now = Date.now) {}
  sample() {
    try {
      const at = this.now();
      const counters = parseNetworkCounters(this.read()).filter(item => !this.interfaces.length || this.interfaces.includes(item.name));
      if (!counters.length) throw Error('没有可用网卡');
      if (this.interfaces.some(name => !counters.some(item => item.name === name))) throw Error('配置的网卡不可用');
      if (this.previous && at > this.previous.at) {
        let inbound = 0, outbound = 0;
        for (const item of counters) {
          const old = this.previous.counters.find(previous => previous.name === item.name);
          if (old && item.received >= old.received && item.sent >= old.sent) {
            inbound += item.received - old.received; outbound += item.sent - old.sent;
          }
        }
        const seconds = (at - this.previous.at) / 1000;
        this.history.push({ at, inbound: inbound / seconds, outbound: outbound / seconds });
        this.history = this.history.filter(point => point.at >= at - 30 * 60_000).slice(-360);
      }
      this.previous = { at, counters }; this.error = null;
    } catch { this.error = '无法读取服务器网卡指标，请确认 Linux 网卡配置'; this.previous = undefined; }
  }
  snapshot() {
    return { available: !this.error && !!this.previous, error: this.error, interfaces: this.previous?.counters.map(item => item.name) ?? [], capacityMbps: this.capacityMbps,
      sampledAt: this.previous?.at ?? null, intervalSeconds: 5, history: this.history, current: !this.error && this.history.at(-1)?.at === this.previous?.at ? this.history.at(-1) : null };
  }
}
