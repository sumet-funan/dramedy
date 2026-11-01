// Every figure is saved in USD, as Dime lists it. Baht is only a way of showing
// one at the latest market rate, so switching currency never touches saved data.

const CURRENCY_KEY = 'dramedy.currency';
const RATE_KEY = 'dramedy.usdThb';
// Markets move slowly enough that opening the app often needn't ask every time.
const RATE_KEEPS_MS = 60 * 60 * 1000;

export const CURRENCIES = ['USD', 'THB'];

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const thb = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'THB',
  currencyDisplay: 'narrowSymbol',
});

export const usdText = (cents) => usd.format(cents / 100);
export const bahtText = (cents, rate) => thb.format((cents / 100) * rate);
export const rateText = (rate) => rate.toLocaleString('en-US', { maximumFractionDigits: 4 });

export const rateNeedsCheck = (saved, now) => !saved
  || !(now - Date.parse(saved.checkedAt) < RATE_KEEPS_MS);

// What a browser kept can be old or edited, and a bad rate would show bad money.
export function parseSavedRate(text) {
  try {
    const { rate, at, checkedAt } = JSON.parse(text);
    return rate > 0 && Date.parse(at) > 0 && Date.parse(checkedAt) > 0
      ? { rate, at, checkedAt }
      : null;
  } catch {
    return null;
  }
}

function readSaved(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function keep(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice still lasts until the page closes.
  }
}

export const savedRate = () => parseSavedRate(readSaved(RATE_KEY));
export const saveRate = (rate) => keep(RATE_KEY, JSON.stringify(rate));

// Baht can't be shown without a rate to work it out from.
export const savedCurrency = () => (readSaved(CURRENCY_KEY) === 'THB' && savedRate() ? 'THB' : 'USD');
export const saveCurrency = (currency) => keep(CURRENCY_KEY, currency);
