//second
const TIMEOUT = {
  "1": 60, //ethereum mainnet
  "80001": 60, //polygon testnet
};
const DEFAULT_TIMEOUT = 60; //second

//return ms
export function getTimeout(chainId: number): number {
  let res: number;
  if (chainId === undefined) {
    res = DEFAULT_TIMEOUT;
  } else {
    res = TIMEOUT[chainId.toString()] ?? DEFAULT_TIMEOUT;
  }
  return res * 1000;
}

export function __setTimeoutConfig(chainId: number, time: number) {
  TIMEOUT[chainId] = time;
}
