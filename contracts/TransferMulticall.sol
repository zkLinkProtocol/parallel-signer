// SPDX-License-Identifier: MIT OR Apache-2.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Multicall.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TransferMulticall is Multicall, ERC20 {
    constructor() ERC20("TEST", "TEST") {}

    uint256 public total = 0;

    function batchTrasnfer(uint256[] memory amount) external {
        for (uint8 i = 0; i < amount.length; ) {
            total += amount[i];
            i++;
        }
    }

    //multicall to address[] to
    function accept(address to, uint256 amount) external {
        //call other contract
        ERC20(0xa581b8E2b305D3A8A1EF2442159E4D46BC9FcC50).transfer(to, amount);
    }
}
