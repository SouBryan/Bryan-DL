// eslint-disable-next-line @typescript-eslint/no-require-imports
const prettierConfigStandard = require("prettier-config-standard");

/** @type {import("prettier").Config} */
const config = { ...prettierConfigStandard, printWidth: 120 };

module.exports = config;
