const failOnConsole = require("jest-fail-on-console")

failOnConsole({
  shouldFailOnLog: process.env.CI ?? false,
  shouldFailOnWarn: process.env.CI ?? false,
  shouldFailOnError: process.env.CI ?? false,
})

const matchers = require("jest-extended")

expect.extend(matchers)
