export const REFERRAL_LIMIT = 2;
export const REFERRAL_ACTIVE_LIMIT = 6;
export const REFERRAL_INVITE_LIFETIME_SECONDS = 3 * 24 * 60 * 60;

function addUtcMonths(timestampSeconds, months) {
  const source = new Date(timestampSeconds * 1000);
  const targetYear = source.getUTCFullYear() + Math.floor((source.getUTCMonth() + months) / 12);
  const targetMonth = ((source.getUTCMonth() + months) % 12 + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(source.getUTCDate(), lastDay),
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
  ) / 1000);
}

export function referralCycleFor(createdAtSeconds, nowSeconds) {
  let start = Number(createdAtSeconds);
  const now = Number(nowSeconds);
  if (!Number.isFinite(start) || !Number.isFinite(now) || start <= 0) {
    throw new Error("A valid account start time and server time are required.");
  }
  if (now < start) return { startedAt: start, endsAt: addUtcMonths(start, 6) };

  // Jump close to the current cycle, then correct around short/long months.
  const source = new Date(start * 1000);
  const current = new Date(now * 1000);
  const monthDistance =
    (current.getUTCFullYear() - source.getUTCFullYear()) * 12
    + current.getUTCMonth() - source.getUTCMonth();
  let cycles = Math.max(0, Math.floor(monthDistance / 6));
  let candidate = addUtcMonths(start, cycles * 6);
  while (candidate > now && cycles > 0) {
    cycles -= 1;
    candidate = addUtcMonths(start, cycles * 6);
  }
  let end = addUtcMonths(start, (cycles + 1) * 6);
  while (end <= now) {
    cycles += 1;
    candidate = end;
    end = addUtcMonths(start, (cycles + 1) * 6);
  }
  return { startedAt: candidate, endsAt: end };
}

export function referralAvailability(slots, networkSlots = []) {
  const used = slots.filter((slot) => slot.consumed_at != null).length;
  const active = slots.filter((slot) => slot.invite_id != null).length;
  const occupiedNetwork = networkSlots.filter((slot) => slot.invite_id != null).length;
  const allowanceAvailable = Math.max(0, REFERRAL_LIMIT - used - active);
  const networkAvailable = Math.max(0, REFERRAL_ACTIVE_LIMIT - occupiedNetwork);
  return {
    limit: REFERRAL_LIMIT,
    active_limit: REFERRAL_ACTIVE_LIMIT,
    used,
    active,
    occupied: occupiedNetwork,
    network_available: networkAvailable,
    available: Math.min(allowanceAvailable, networkAvailable),
  };
}

export function referralInviteExpiry(nowSeconds) {
  return Number(nowSeconds) + REFERRAL_INVITE_LIFETIME_SECONDS;
}
