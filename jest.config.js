const swcTypeScript = [
  "@swc/jest",
  {
    jsc: {
      parser: { syntax: "typescript", tsx: true, decorators: true, dynamicImport: true },
      transform: { decoratorVersion: "2022-03", react: { runtime: "automatic" } },
    },
  },
]

const swcJavaScript = [
  "@swc/jest",
  {
    jsc: { target: "es2022", parser: { syntax: "ecmascript" } },
    module: { type: "commonjs", importInterop: "node" },
  },
]

/** @type {import("jest").Config} */
module.exports = {
  displayName: "plaza",
  testEnvironment: "jsdom",
  clearMocks: true,
  restoreMocks: true,
  setupFilesAfterEnv: ["<rootDir>/testSetup.js"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  modulePathIgnorePatterns: ["<rootDir>/dist"],
  // MobX 7 and mobx-react-lite 5 ship ESM under some export conditions.
  transformIgnorePatterns: ["/node_modules/(?!(mobx|mobx-react-lite)/)"],
  transform: { "^.+\\.(c|m)js$": swcJavaScript, "^.+\\.(t|j)sx?$": swcTypeScript },
}
