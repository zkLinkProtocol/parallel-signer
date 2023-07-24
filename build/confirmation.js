"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__setTimeoutConfig = exports.getTimeout = exports.getConfirmation = void 0;
const CONFIRMATION = {
    "1": 60,
    "4": 60, //goerli
};
const DEFAULT_CONFIRMATION = 200;
//second
const TIMEOUT = {
    "1": 60,
    "80001": 60, //polygon testnet
};
const DEFAULT_TIMEOUT = 60; //second
function getConfirmation(chainId) {
    var _a;
    if (chainId === undefined) {
        return DEFAULT_CONFIRMATION;
    }
    return (_a = CONFIRMATION[chainId.toString()]) !== null && _a !== void 0 ? _a : DEFAULT_CONFIRMATION;
}
exports.getConfirmation = getConfirmation;
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
