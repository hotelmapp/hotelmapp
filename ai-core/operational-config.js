// Operational routing is intentionally separate from guest-facing hotel facts.
// FRONT_DESK_EMAIL wins in every deployment. The legacy address is retained in
// one place only so existing deployments continue delivering during rollout.
export const LEGACY_FRONT_DESK_EMAIL = "hotel.mapp158@gmail.com";

export function frontDeskEmail(env = process.env) {
  return env.FRONT_DESK_EMAIL?.trim() || LEGACY_FRONT_DESK_EMAIL;
}
