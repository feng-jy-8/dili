export const FRP_VERSION = '0.68.0';
export const FRP_ARCHIVE_HASHES: Record<string, string> = {
  linux_amd64: '3cf934477f4fb1ee9e19e49c31fb33f5ffe3283300076f59afad8b8ccf1e1621',
  linux_arm64: '8855bd3537adf6f456b4073a1fb6f119885060f3c8b714fd56a842db42b4c097',
  darwin_amd64: '0ef747a7c31ef5c8bc70494bf2a9ec5a1c69d73bff684b4e8b2947c0d1e4f887',
  darwin_arm64: '9f344774971dfb9ae90ee1f633de68d1755c98510227a67289ec78081fc5c8fa',
};
export const frpArchive = (platform: string) => `frp_${FRP_VERSION}_${platform}.tar.gz`;
