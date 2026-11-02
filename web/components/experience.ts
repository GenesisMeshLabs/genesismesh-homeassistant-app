import type { Member, Operation } from './models.js';

export function accessState(member: Member): string {
  if (member.connection?.state === 'needs_review') return 'Access needs review';
  if (!member.enabled || member.connection?.state === 'revoked') return 'Access revoked';
  if (Date.parse(member.expiresAt) <= Date.now() || member.connection?.state === 'expired') return 'Access expired';
  return 'Access valid';
}

export function usageLabel(member: Member): string {
  if (member.connection?.lastRequestAt) return `Last authenticated request ${new Date(member.connection.lastRequestAt).toLocaleString()}`;
  return member.nativeUser ? 'No requests through this app yet.' : 'Not connected yet. No authenticated client requests received.';
}

export function requestExplanation(operation: Operation): string {
  if (operation.commandState === 'observed') return 'This is a state snapshot. No device command was sent.';
  if (operation.commandState === 'accepted') return 'Home Assistant accepted this exact request. Check the device if you need to confirm its physical result.';
  if (operation.commandState === 'outcome_unknown') return 'Check the device and Activity before another control request. This request will not be repeated automatically.';
  const reasons: Record<string, string> = {
    operation_not_shared: 'This operation was not granted. Review this participant’s access if it needs a different role.',
    resource_not_shared: 'This resource was not shared with the participant. Review its selected resources.',
    profile_volume_limit: 'The requested volume exceeds this profile’s limit. Lower the volume or review its access limit.',
    volume_limit_exceeded: 'The requested volume exceeds this profile’s limit. Lower the volume or review its access limit.',
    unsupported_option: 'This device no longer supports the selected option. Refresh Devices and choose a current option.',
    unsupported_range: 'The value is outside this device’s supported range. Refresh Devices and choose a value within its limits.',
    unsupported_setpoint: 'The temperature is outside this device’s supported range. Choose a supported temperature.',
    unsupported_step: 'The value does not match the device’s supported steps. Choose one of the displayed increments.',
    unsupported_action: 'The device does not currently support that control. Refresh Devices to see available operations.',
    unsupported_unit: 'Temperature controls currently require Celsius. Other supported operations may still be available.',
    home_unavailable: 'The device could not be checked. Refresh Devices and confirm that Home Assistant can reach it.',
    observation_unavailable: 'A safe status snapshot could not be read. Refresh Devices before trying another observation.',
    policy_changed: 'An access rule changed. An administrator needs to review sharing before another request.',
    policy_unhealthy: 'The authority could not confirm healthy access rules. Wait for it to recover; no command was sent.',
    policy_expectations_missing: 'Sharing needs review after this update. Save the reviewed sharing selection before trying this operation.',
    authorization_stale: 'The request or access expired before it could run. Create a new request after reviewing access.',
    authority_unavailable_or_unverified: 'The authority could not safely verify this request. Check the app connection and access rules.',
    outcome_or_evidence_needs_review: 'The command result or signed record needs review. Check Activity and the device before another control request.',
    restart_before_dispatch: 'The app restarted before sending this request. Review its purpose before creating a new one.',
    restart_during_dispatch: 'The app restarted while sending the command. Check the device; do not repeat it automatically.',
  };
  if (operation.commandState === 'denied') {
    if (operation.policyFailures.some(value => /volume/i.test(value))) return 'The authority refused this request under a volume limit. Lower the value or review the profile’s limit.';
    if (operation.policyFailures.some(value => /temperature|minimum|maximum/i.test(value))) return 'The authority refused this request under a configured numeric limit. Review the value and the access limits.';
    return 'The authority refused this exact request. Review the participant’s resources, operations, expiry and configured limits.';
  }
  return reasons[operation.reason] ?? 'No command was sent. Review the selected operation, device availability and access before creating another request.';
}

export const recordLabel = (state: string) => ({
  acknowledged: 'Signed record received', pending: 'Signed record delivery pending',
  needs_attention: 'Signed record needs review', none: 'No signed execution record',
} as Record<string, string>)[state] ?? 'Record status unavailable';
