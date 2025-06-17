import pThrottle, { Options } from 'p-throttle'
import { createTransport, http, HttpTransportConfig } from "viem";


export function throttledHttp(url?: string | undefined, config?: HttpTransportConfig<undefined, false> | undefined, throttle?: Options) { // TODO: type
  const baseTransport = http(url, config); // Use Viem's default HTTP transport
  if (!throttle) {
    return baseTransport
  }
  const _throttle = pThrottle(throttle);
  return (transportParams: any) => { // TODO: type
    const t = baseTransport(transportParams)
    return createTransport({
      ...baseTransport,
      key: 'limited http',
      name: 'Limited HTTP',
      request: _throttle((args: any, options: any) => t.request(args, options)) as any, // TODO: type
      type: 'custom',
    })
  }
}
