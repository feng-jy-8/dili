import type { RelayPairing } from '../shared/pairing.ts';
import { decodeInvite, newSecret } from './invite.ts';

export interface PendingPairing { invite: string; claim: string; credential: string; name: string }
export function pendingPairing(invite: string, name: string): PendingPairing {
  decodeInvite(invite);
  if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('请填写 1–80 字的设备名称');
  return { invite: invite.trim(), claim: newSecret(), credential: newSecret(), name: name.trim() };
}
export async function redeemPairing(pending: PendingPairing): Promise<RelayPairing> {
  const { serverUrl, secret } = decodeInvite(pending.invite);
  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/redeem`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret, claim: pending.claim, credential: pending.credential, name: pending.name }) });
  } catch {
    throw new Error('中继服务器连接失败或超时，请检查网络后重试；使用同一邀请码重试不会重复创建设备');
  }
  const data = await response.json() as Partial<RelayPairing> & { error?: string };
  if (!response.ok) throw Object.assign(new Error(data.error || '服务器配对失败'), { status: response.status });
  if (typeof data.deviceId !== 'string' || !/^[a-z0-9]{16}$/.test(data.deviceId) || data.publicUrl !== `${serverUrl}/d/${data.deviceId}` || !Number.isInteger(data.serverPort) || data.serverPort! < 1024 || data.serverPort! > 65535 || typeof data.pairedAt !== 'string') throw new Error('中继服务器返回了无效的配对信息');
  return { deviceId: data.deviceId, name: pending.name, serverUrl, publicUrl: data.publicUrl, serverPort: data.serverPort!, pairedAt: data.pairedAt, credential: pending.credential };
}
export async function revokePairing(pair: RelayPairing) {
  const response = await fetch(`${pair.serverUrl}/api/devices/${pair.deviceId}/revoke`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${pair.credential}`, 'content-type': 'application/json' }, body: '{}' });
  if (!response.ok && response.status !== 401 && response.status !== 404) throw new Error('服务器暂时无法撤销配对，请先停用远程访问后重试');
}
