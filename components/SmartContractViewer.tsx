import React, { useState } from 'react';
import { Copy, Check, FileText } from 'lucide-react';

export const SmartContractViewer: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const solidityCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract X2GetherProtocol is Ownable {
    
    struct Player {
        address wallet;
        uint256 deposit;    
        uint256 collected;  
        uint256 target;     
        uint256 timestamp;
        bool slashed;
    }

    IERC20 public usdcToken;
    Player[] public queue;
    
    // Config
    uint256 public constant RESERVE_FLOOR = 1000 * 10**6; 
    bool public dynamicDecayEnabled;
    bool public winnersTaxEnabled;
    
    event Deposit(address indexed user, uint256 amount, uint256 target);
    event Exit(address indexed user, uint256 profit, uint256 taxPaid);

    constructor(address _usdcAddress) Ownable(msg.sender) {
        usdcToken = IERC20(_usdcAddress);
    }

    function toggleStrategies(bool _decay, bool _tax) external onlyOwner {
        dynamicDecayEnabled = _decay;
        winnersTaxEnabled = _tax;
    }

    function deposit(uint256 amount) external {
        // ... Transfer and Fee logic ...
        
        uint256 mult = 200; // 2.0x base
        
        // 1. Dynamic Decay Logic
        if (dynamicDecayEnabled) {
            uint256 queueLen = queue.length - headIndex;
            uint256 reduction = (queueLen / 10) * 5; // -0.05 per 10 users
            if (reduction < 90) mult -= reduction; 
            else mult = 110; // Min 1.1x
        }

        uint256 target = (amount * mult) / 100;
        
        queue.push(Player({
            wallet: msg.sender,
            deposit: amount,
            collected: 0,
            target: target,
            timestamp: block.timestamp,
            slashed: false
        }));
    }

    function _processExit(uint256 index) internal {
        Player storage p = queue[index];
        
        // 2. Winners Tax Logic (Fast Exit < 1 hour)
        if (winnersTaxEnabled && block.timestamp - p.timestamp < 1 hours) {
            uint256 profit = p.collected - p.deposit;
            if (profit > 0) {
                uint256 tax = (profit * 20) / 100;
                // Move tax to reserve logic...
                emit Exit(p.wallet, profit - tax, tax);
                return;
            }
        }
        emit Exit(p.wallet, p.collected - p.deposit, 0);
    }
}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(solidityCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
      <div className="flex justify-between items-center px-6 py-4 bg-slate-950/50 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="bg-blue-500/10 p-2 rounded-lg">
             <FileText className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wide">Solidity Contract</h2>
            <span className="text-xs text-slate-400">Base Mainnet • v3.0 (Strategies)</span>
          </div>
        </div>
        <button 
          onClick={handleCopy}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium text-white transition-colors border border-slate-700"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy Code'}
        </button>
      </div>
      <div className="relative">
        <pre className="p-6 text-xs md:text-sm font-mono text-slate-300 overflow-x-auto bg-[#0b0f19] min-h-[500px] leading-relaxed">
          <code>{solidityCode}</code>
        </pre>
      </div>
    </div>
  );
};