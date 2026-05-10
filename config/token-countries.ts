import { getRandomToken } from '@/lib/qobuz-dl-server';

export type TokenCountry = {
    code: string;
    token: string;
};

// Country codes should follow ISO 3166-1 alpha-2 format (https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)
// If you fill this list, process.env.QOBUZ_AUTH_TOKENS will be ignored

export const tokenCountriesMap: TokenCountry[] = [
    { code: 'BR', token: 'Y7Uykti4HzZsm0xj58ma_l-Ms_iBd7vAw0ogGs1RTn7aWHezX9NLbGM3P2wON2_0gWB41vWbf81-omyEcErP8Q' },
    { code: 'BR', token: '3Da5QE8dzfBLt0vNL9taZXJvIRmzny77aAM0UpY7LTUoW16U0vhIlKiPfG0_zgDsuTyZnHuh6VqDTKbhNcXFSw' },
    { code: 'BR', token: 'pIZL6WFBF1EQ7DSaVQc8ig7Bjt8PjmLRquKPNqOMjwrZLz0TF5VsoshYLEikDM-DzPcflU_SHLvlXlpe0GzptA' },
    { code: 'US', token: '9FT2NCPUSq2cY3mJeLMlq0T8UowIcCkMCXV0jJXw0UUcu2fgIuit9qXOaAeYW33zahxhE-qEEhI00H3K7VAvqQ' },
    { code: 'FR', token: 'uvSQxGJbhlN0VJNfu4q7G2WMv2fJCano7V-9r4Kq7z3L-zrCvo1SNlM1n-GN2tOlsEQQb_c-cRLPZJXbXlVO6w' },
    { code: 'GB', token: 'y_QxCJOjz7CpiYDAZDVp-xNt-9C4MGP34TvqbAnyBMunSX-olDz7IJM-hEXYYdNMAcSg78bgqEHBQEq73eUWRg' },
];

export const getTokenForCountry = (country: string): string =>
    tokenCountriesMap.find((c) => c.code.toUpperCase() === country.toUpperCase())?.token || getRandomToken();
