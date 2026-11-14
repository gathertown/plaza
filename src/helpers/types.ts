/**
 * Plaza declares its own `VoidFunction` because the global one comes from the DOM lib. A Node
 * project without that lib couldn't read plaza's declarations otherwise.
 */
export type VoidFunction = () => void
