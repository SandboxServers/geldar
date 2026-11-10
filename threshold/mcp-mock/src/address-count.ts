/**
 * Open connections per client address, capped. One live count per address: `take` adds one
 * when a connection opens (false at the cap), `release` takes one away when it closes, and the
 * entry is dropped at zero so the map holds only addresses with a connection open.
 */
export class AddressConnections {
  private readonly cap: number;
  private readonly open = new Map<string, number>();

  constructor(cap: number) {
    this.cap = cap;
  }

  /** Counts one more open connection for the address; false when the address is at the cap. */
  take(address: string): boolean {
    const count = this.open.get(address) ?? 0;
    if (count >= this.cap) return false;
    this.open.set(address, count + 1);
    return true;
  }

  /** Counts one connection of the address as closed. */
  release(address: string): void {
    const count = this.open.get(address) ?? 0;
    if (count <= 1) this.open.delete(address);
    else this.open.set(address, count - 1);
  }

  /** The number of addresses with at least one open connection. */
  get size(): number {
    return this.open.size;
  }
}
