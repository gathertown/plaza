export const isProductionNodeEnv = (): boolean => process.env.NODE_ENV === "production"

export const isTestNodeEnv = (): boolean => process.env.NODE_ENV === "test"
