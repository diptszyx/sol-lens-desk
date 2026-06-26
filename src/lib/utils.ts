export function truncateAddress(addr: string, lead = 4, tail = 4): string {
  return addr.length <= lead + tail ? addr : `${addr.slice(0, lead)}…${addr.slice(-tail)}`
}
