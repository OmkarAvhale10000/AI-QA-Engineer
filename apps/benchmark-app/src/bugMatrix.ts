// Bug Matrix: Toggle these to enable/disable planted defects
// These are read from localStorage so they persist across page refreshes

export interface BugFlags {
  bug1_doubleDiscount: boolean;    // Applying coupon applies discount twice
  bug2_negativeQuantity: boolean;  // Negative quantities reduce total price
  bug3_formCrash: boolean;         // Special chars in form cause unhandled crash
  bug4_modalTrap: boolean;         // Invisible overlay blocks checkout button
  bug5_stateLoss: boolean;         // Browser back clears cart session
  bug6_silentApiError: boolean;    // Order placement spins forever on error
}

const STORAGE_KEY = 'buggy_cart_flags';

export const DEFAULT_FLAGS: BugFlags = {
  bug1_doubleDiscount: false,
  bug2_negativeQuantity: false,
  bug3_formCrash: false,
  bug4_modalTrap: false,
  bug5_stateLoss: false,
  bug6_silentApiError: false,
};

export function getBugFlags(): BugFlags {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_FLAGS, ...JSON.parse(stored) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_FLAGS };
}

export function setBugFlags(flags: BugFlags) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
}

export function enableAllBugs() {
  const all: BugFlags = {
    bug1_doubleDiscount: true,
    bug2_negativeQuantity: true,
    bug3_formCrash: true,
    bug4_modalTrap: true,
    bug5_stateLoss: true,
    bug6_silentApiError: true,
  };
  setBugFlags(all);
  return all;
}

export function disableAllBugs() {
  setBugFlags({ ...DEFAULT_FLAGS });
  return { ...DEFAULT_FLAGS };
}
