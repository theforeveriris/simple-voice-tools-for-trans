import { describe, expect, it } from 'vitest';
import { decodeSdpFromQr, encodeSdpForQr } from './sdpCodec';

const SDP = JSON.stringify({
  type: 'offer',
  sdp: `v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n${'a=candidate:1 1 UDP 2122260223 192.168.1.2 50000 typ host\r\n'.repeat(30)}`,
});

describe('sdpCodec', () => {
  it('round-trips an SDP payload through the QR format', async () => {
    const payload = await encodeSdpForQr(SDP);
    expect(payload.startsWith('svt1.')).toBe(true);
    await expect(decodeSdpFromQr(payload)).resolves.toBe(SDP);
  });

  it('compresses repeated SDP lines substantially', async () => {
    const payload = await encodeSdpForQr(SDP);
    expect(payload.length).toBeLessThan(SDP.length / 2);
  });

  it('accepts raw SDP JSON without the prefix', async () => {
    await expect(decodeSdpFromQr(SDP)).resolves.toBe(SDP);
  });
});
