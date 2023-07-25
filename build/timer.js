"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__setTimeoutConfig = exports.getTimeout = void 0;
//second
const TIMEOUT = {
    "1": 60,
    "80001": 60, //polygon testnet
};
const DEFAULT_TIMEOUT = 60; //second
//return ms
function getTimeout(chainId) {
    var _a;
    let res;
    if (chainId === undefined) {
        res = DEFAULT_TIMEOUT;
    }
    else {
        res = (_a = TIMEOUT[chainId.toString()]) !== null && _a !== void 0 ? _a : DEFAULT_TIMEOUT;
    }
    return res * 1000;
}
exports.getTimeout = getTimeout;
function __setTimeoutConfig(chainId, time) {
    TIMEOUT[chainId] = time;
}
exports.__setTimeoutConfig = __setTimeoutConfig;
