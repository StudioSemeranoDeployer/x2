
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
        uint256 multiplier;
        bool slashed;
    }

    IERC20 public usdcToken;
    Player[] public queue;
    uint256 public protocolVault;
    
    // Config
    uint256 public constant BASE_MULTIPLIER = 200; // 2.0x
    bool public dynamicDecayEnabled;
    bool public winnersTaxEnabled;
    
    // Timers
    uint256 public lastHourlyDrip;

    event Deposit(address indexed user, uint256 amount, uint256 target);
    event HourlyDrip(uint256 amount);

    constructor(address _usdcAddress) Ownable(msg.sender) {
        usdcToken = IERC20(_usdcAddress);
        // Initial Seed logic handled in deploy script
    }

    function deposit(uint256 amount) external {
        // ... Transfer and Fee logic (1%) ...
        
        uint256 mult = BASE_MULTIPLIER;
        
        // 1. Dynamic Decay Logic (Max 20% Reduction)
        if (dynamicDecayEnabled) {
            uint256 queueLen = queue.length - headIndex;
            uint256 reduction = (queueLen / 10) * 5; // -0.05 per 10 users
            
            // Cap reduction at 20% of base (e.g., 40 points if base is 200)
            uint256 maxRed = (BASE_MULTIPLIER * 20) / 100; 
            if (reduction > maxRed) reduction = maxRed;
            
            mult -= reduction;
        }

        uint256 target = (amount * mult) / 100;
        
        queue.push(Player({
            wallet: msg.sender,
            deposit: amount,
            collected: 0,
            target: target,
            timestamp: block.timestamp,
            multiplier: mult,
            slashed: false
        }));
        
        // Check for Drip
        if (block.timestamp > lastHourlyDrip + 1 hours) {
            _triggerHourlyDrip();
        }
    }

    function _triggerHourlyDrip() internal {
        if (protocolVault == 0) return;
        
        // Use 50% of vault
        uint256 drip = protocolVault / 2;
        protocolVault -= drip;
        
        // Distribute drip to queue (logic omitted for brevity)
        lastHourlyDrip = block.timestamp;
        emit HourlyDrip(drip);
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
            <span className="text-xs text-slate-400">Base Mainnet • v3.5 (Hourly Drip)</span>
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
