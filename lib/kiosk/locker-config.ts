export type KioskLockerConfig = {
  label: string;
  street: string[];
  city: string;
  region: string | null;
  postcode: string;
  countryCode: string;
  telephone: string;
  carrierCode: "csslocker";
  methodCode: "locker";
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function getKioskLockerConfig(): KioskLockerConfig {
  const countryCode = required("KIOSK_LOCKER_COUNTRY_CODE").toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error("KIOSK_LOCKER_COUNTRY_CODE must be a two-letter country code.");
  }

  const street = [
    required("KIOSK_LOCKER_STREET_1"),
    process.env.KIOSK_LOCKER_STREET_2?.trim() || null,
  ].filter((line): line is string => Boolean(line));

  return {
    label: required("KIOSK_LOCKER_LABEL"),
    street,
    city: required("KIOSK_LOCKER_CITY"),
    region: process.env.KIOSK_LOCKER_REGION?.trim() || null,
    postcode: required("KIOSK_LOCKER_POSTCODE"),
    countryCode,
    telephone: required("KIOSK_LOCKER_TELEPHONE"),
    carrierCode: "csslocker",
    methodCode: "locker",
  };
}
